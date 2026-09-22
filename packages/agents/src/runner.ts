import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  createCapsule,
  parseCapsule,
  capsuleToMarkdown,
  atomicWriteJson,
  compileContext,
  EventLog,
  GitEngine,
  newId,
  assertStorageId,
  nowIso,
  pickAgent,
  MessageBus,
  type Capsule,
  type ContextLevel,
  type GitEngine as GitEngineT,
  type SessionRun,
  type TaskRecord,
  type TimelineEvent,
  type RoutableAgent,
} from '@agentos/core';
import type { AgentAdapter, AgentRunOptions, AgentRunResult } from './adapter.js';
import { diagnoseFailure } from './diagnose.js';
import { resolveRunPermissions, validatePermissionSelection } from './permissions.js';
import { profileFor } from './catalog.js';
import { buildHandoffPrompt, buildVerifyProbe, writeHandoffFile } from './handoff.js';
import type { WorktreeRef } from '@agentos/core';

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…（截断）`;
}

/** 任务持久化：<dataDir>/tasks/<taskId>/{task.json, events.jsonl, capsules/} */
export class TaskStore {
  constructor(readonly dataDir: string) {}

  taskDir(taskId: string): string {
    return path.join(this.dataDir, 'tasks', assertStorageId(taskId));
  }

  capsulesDir(taskId: string): string {
    return path.join(this.taskDir(taskId), 'capsules');
  }

  capsuleFile(taskId: string, capsuleId: string, ext = 'json'): string {
    return path.join(this.capsulesDir(taskId), `${assertStorageId(capsuleId)}.${assertStorageId(ext)}`);
  }

  eventsFile(taskId: string): string {
    return path.join(this.taskDir(taskId), 'events.jsonl');
  }

  async saveTask(task: TaskRecord): Promise<void> {
    await atomicWriteJson(path.join(this.taskDir(task.id), 'task.json'), task);
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    try {
      const raw = await fsp.readFile(path.join(this.taskDir(taskId), 'task.json'), 'utf8');
      return JSON.parse(raw) as TaskRecord;
    } catch {
      return undefined;
    }
  }

  async listTasks(): Promise<TaskRecord[]> {
    let names: string[];
    try {
      names = await fsp.readdir(path.join(this.dataDir, 'tasks'));
    } catch {
      return [];
    }
    const out: TaskRecord[] = [];
    for (const name of names) {
      const t = await this.getTask(name);
      if (t) out.push(t);
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async saveCapsule(taskId: string, capsule: Capsule): Promise<{ jsonPath: string; mdPath: string }> {
    fs.mkdirSync(this.capsulesDir(taskId), { recursive: true });
    const jsonPath = this.capsuleFile(taskId, capsule.id);
    const mdPath = this.capsuleFile(taskId, capsule.id, 'md');
    await atomicWriteJson(jsonPath, capsule);
    await fsp.writeFile(mdPath, capsuleToMarkdown(capsule), 'utf8');
    return { jsonPath, mdPath };
  }

  async getCapsule(taskId: string, capsuleId: string): Promise<Capsule | undefined> {
    try {
      const raw = await fsp.readFile(this.capsuleFile(taskId, capsuleId), 'utf8');
      return parseCapsule(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
}

export interface RunnerOptions {
  dataDir: string;
  adapters: AgentAdapter[];
  git?: GitEngineT;
  defaultTimeoutMs?: number;
}

export interface RunOnceOptions {
  agentId: string;
  mode?: SessionRun['mode'];
  baseRef?: string;
  prompt?: string;
  /** 统一权限档位（ADR-010）；与 permissionFlags 二选一，显式 flags 优先 */
  profile?: 'safe' | 'developer' | 'full';
  permissionFlags?: string[];
  allowedTools?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  makeCapsule?: boolean;
  /** worktree 建好之后、agent 启动之前（用于写 HANDOFF.md 等交接准备） */
  onWorktree?: (wt: WorktreeRef) => Promise<void>;
}

export interface RunOutcome {
  run: SessionRun;
  capsule?: Capsule;
  worktreePath?: string;
  branch?: string;
  diffFiles: number;
  diffStat: string;
}

export class TaskRunner {
  readonly bus = new MessageBus();
  readonly git: GitEngineT;
  private readonly store: TaskStore;
  private readonly adapters = new Map<string, AgentAdapter>();
  private readonly logs = new Map<string, EventLog>();
  /** 进程内运行守卫：同一任务不允许并发 run/swap/fork（跨进程由 status 字段兜底） */
  private readonly runningTasks = new Set<string>();
  private readonly defaultTimeoutMs: number;

  constructor(opts: RunnerOptions) {
    this.store = new TaskStore(opts.dataDir);
    this.git = opts.git ?? new GitEngine();
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 20 * 60_000;
    for (const a of opts.adapters) this.adapters.set(a.id, a);
  }

  get dataDir(): string {
    return this.store.dataDir;
  }

  logFor(taskId: string): EventLog {
    let log = this.logs.get(taskId);
    if (!log) {
      log = new EventLog(this.store.eventsFile(taskId));
      this.logs.set(taskId, log);
    }
    return log;
  }

  adapterFor(agentId: string): AgentAdapter | undefined {
    return this.adapters.get(agentId);
  }

  adapterIds(): string[] {
    return [...this.adapters.keys()];
  }

  private async resolveAgent(agentId: string | undefined, kind: 'generic' = 'generic'): Promise<AgentAdapter> {
    if (agentId && agentId !== 'auto') {
      const a = this.adapters.get(agentId);
      if (!a) throw new Error(`未注册的 agent: ${agentId}`);
      return a;
    }
    const routable: RoutableAgent[] = [];
    for (const a of this.adapters.values()) {
      const avail = await a.isAvailable();
      routable.push({ profile: a.profile, available: avail.available, authed: true });
    }
    const best = pickAgent(routable, kind);
    if (!best) throw new Error('没有可用 agent（请检查 agentos doctor）');
    const adapter = this.adapters.get(best.profile.id);
    if (!adapter) throw new Error('路由结果与适配器表不一致');
    return adapter;
  }

  async createTask(input: {
    repoRoot: string;
    objective: string;
    constraints?: string[];
    userInstructions?: string[];
    baseRef?: string;
  }): Promise<TaskRecord> {
    if (!(await this.git.isRepo(input.repoRoot))) {
      throw new Error(`不是 git 仓库: ${input.repoRoot}（AgentOS 在独立 worktree/分支上工作，需要 git）`);
    }
    const baseRef = input.baseRef ?? (await this.git.revParse(input.repoRoot, 'HEAD'));
    const now = nowIso();
    const task: TaskRecord = {
      id: newId('task'),
      objective: input.objective,
      constraints: input.constraints ?? [],
      userInstructions: input.userInstructions ?? [],
      repoRoot: input.repoRoot,
      baseRef,
      status: 'created',
      createdAt: now,
      updatedAt: now,
      progress: { completed: [], remaining: [], decisions: [], rejectedApproaches: [] },
      runs: [],
    };
    await this.store.saveTask(task);
    await this.logFor(task.id).append(task.id, 'system', 'task.created', { objective: task.objective, repoRoot: task.repoRoot });
    return task;
  }

  async getTask(taskId: string): Promise<TaskRecord> {
    const task = await this.store.getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    return task;
  }

  async updateProgress(
    taskId: string,
    patch: Partial<Pick<TaskRecord['progress'], 'completed' | 'remaining' | 'decisions' | 'rejectedApproaches'>> & {
      userInstructions?: string[];
    },
  ): Promise<TaskRecord> {
    const task = await this.getTask(taskId);
    if (patch.completed) task.progress.completed = patch.completed;
    if (patch.remaining) task.progress.remaining = patch.remaining;
    if (patch.decisions) task.progress.decisions = patch.decisions;
    if (patch.rejectedApproaches) task.progress.rejectedApproaches = patch.rejectedApproaches;
    if (patch.userInstructions) task.userInstructions = patch.userInstructions;
    task.updatedAt = nowIso();
    await this.store.saveTask(task);
    await this.logFor(taskId).append(taskId, 'user', 'task.progress-updated', {
      completed: task.progress.completed.length,
      remaining: task.progress.remaining.length,
      decisions: task.progress.decisions.length,
    });
    return task;
  }

  async listTasks(): Promise<TaskRecord[]> {
    return this.store.listTasks();
  }

  latestCapsule(task: TaskRecord): Capsule | undefined {
    if (!task.latestCapsuleId) return undefined;
    // 同步读取（capsule 已在保存时校验过）；缺失时返回 undefined
    try {
      const raw = fs.readFileSync(this.store.capsuleFile(task.id, task.latestCapsuleId), 'utf8');
      return parseCapsule(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  /** 核心执行单元：不负责 task.json 状态机（由外层 runTask/forkAll 管）。 */
  private async runOnce(task: TaskRecord, opts: RunOnceOptions): Promise<RunOutcome> {
    const agentId = opts.agentId;
    const adapter = await this.resolveAgent(agentId);
    validatePermissionSelection(opts, adapter.id);
    const mode = opts.mode ?? 'run';
    const log = this.logFor(task.id);

    await log.append(task.id, 'user', 'agent.spawned', { agentId: adapter.id, mode });
    const wt = await this.git.createWorktree(task.repoRoot, {
      taskId: task.id,
      agentId: mode === 'swap' ? `${adapter.id}-${newId('handoff')}` : adapter.id,
      baseRef: opts.baseRef ?? task.baseRef,
    });
    await log.append(task.id, 'system', 'worktree.created', { path: wt.path, branch: wt.branch, base: wt.baseCommit, agentId: adapter.id });
    if (opts.onWorktree) await opts.onWorktree(wt);

    const runId = newId('run');
    const startedAt = nowIso();
    const runOpts: AgentRunOptions = {
      cwd: wt.path,
      // 权限解析：显式 flags > 档位映射（ADR-010）> safe（不追加）
      permissionFlags: resolveRunPermissions(adapter.id, { profile: opts.profile, permissionFlags: opts.permissionFlags }),
      allowedTools: opts.allowedTools,
      timeoutMs: opts.timeoutMs ?? this.defaultTimeoutMs,
      signal: opts.signal,
      onEvent: (evt) => {
        void log.append(task.id, adapter.id, `agent.${evt.type}`, evt.data);
      },
    };

    let result: AgentRunResult;
    try {
      result = await adapter.run(opts.prompt ?? this.buildTaskPrompt(task), runOpts);
    } catch (err) {
      const message = (err as Error).message;
      await log.append(task.id, adapter.id, 'agent.error', { message });
      const run: SessionRun = {
        id: runId,
        agentId: adapter.id,
        mode,
        branch: wt.branch,
        worktreePath: wt.path,
        exitCode: null,
        startedAt,
        finishedAt: nowIso(),
        error: message,
      };
      return { run, worktreePath: wt.path, branch: wt.branch, diffFiles: 0, diffStat: '' };
    }

    await log.append(task.id, adapter.id, 'agent.result', {
      sessionRef: result.sessionRef,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    });

    // 故障诊断：失败必须有"发生了什么 + 该怎么办"，而不是把 402/JSONL 原样丢给用户
    let diagnosisHint: string | undefined;
    if (result.exitCode !== 0 || result.timedOut) {
      const d = diagnoseFailure({ finalMessage: result.finalMessage, stderrTail: result.stderrTail, exitCode: result.exitCode });
      if (d) {
        diagnosisHint = `[${d.kind}] ${d.hint}`;
        await log.append(task.id, adapter.id, 'agent.error', { kind: d.kind, hint: d.hint, matched: d.matched });
      } else if (result.timedOut) {
        diagnosisHint = '[timeout] Agent 运行超时被强制终止。可在调用时调大超时，或拆小任务后重试。';
        await log.append(task.id, adapter.id, 'agent.error', { kind: 'timeout', hint: diagnosisHint });
      }
    }

    const cp = await this.git.checkpoint(wt.path, `${task.id} ${adapter.id}`);
    if (cp.committed) {
      await log.append(task.id, 'system', 'git.checkpoint', { worktree: wt.path, hash: cp.hash });
    }
    const diff = await this.git.diffAgainstBase(wt.path, wt.baseCommit);
    const commits = await this.git.commitsBetween(wt.path, wt.baseCommit);

    let capsule: Capsule | undefined;
    if (opts.makeCapsule !== false) {
      capsule = createCapsule({
        task: { id: task.id, objective: task.objective, constraints: task.constraints, userInstructions: task.userInstructions },
        status: result.exitCode === 0 ? 'in-progress' : 'failed',
        origin: { agentId: adapter.id, sessionId: result.sessionRef },
        progress: {
          completed: task.progress.completed,
          remaining: task.progress.remaining,
          decisions: task.progress.decisions,
          rejectedApproaches: task.progress.rejectedApproaches,
        },
        workspace: {
          repoRoot: task.repoRoot,
          baseCommit: wt.baseCommit,
          branch: wt.branch,
          worktreePath: wt.path,
          changedFiles: diff.files,
          diffStat: diff.stat,
          commits,
        },
        handoff: { fromAgent: adapter.id, summary: truncate(result.finalMessage, 2000) },
        context: {
          keyFacts: [],
          environment: { platform: process.platform, node: process.version },
        },
      });
      const saved = await this.store.saveCapsule(task.id, capsule);
      await log.append(task.id, 'system', 'capsule.saved', { capsuleId: capsule.id, jsonPath: saved.jsonPath, mdPath: saved.mdPath });
    }

    const run: SessionRun = {
      id: runId,
      agentId: adapter.id,
      mode,
      sessionId: result.sessionRef,
      branch: wt.branch,
      worktreePath: wt.path,
      capsuleId: capsule?.id,
      exitCode: result.exitCode,
      startedAt,
      finishedAt: nowIso(),
      finalMessage: truncate(result.finalMessage, 2000),
      durationMs: result.durationMs,
      error: result.timedOut && !diagnosisHint ? 'timed out' : diagnosisHint,
    };
    return { run, capsule, worktreePath: wt.path, branch: wt.branch, diffFiles: diff.files.length, diffStat: diff.stat };
  }

  private async withTaskLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    if (this.runningTasks.has(taskId)) throw new Error('任务已在运行中');
    this.runningTasks.add(taskId);
    try {
      if ((await this.getTask(taskId)).status === 'running') throw new Error('任务已在运行中');
      try {
        return await operation();
      } catch (err) {
        const task = await this.getTask(taskId);
        if (task.status === 'running') {
          task.status = 'failed';
          task.updatedAt = nowIso();
          await this.store.saveTask(task);
          await this.logFor(taskId).append(taskId, 'system', 'task.failed', { message: String(err) });
        }
        throw err;
      }
    } finally {
      this.runningTasks.delete(taskId);
    }
  }

  async runTask(
    taskId: string,
    opts: { agentId?: string; profile?: 'safe' | 'developer' | 'full'; permissionFlags?: string[]; allowedTools?: string[]; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<RunOutcome> {
    return this.withTaskLock(taskId, async () => {
      let task = await this.getTask(taskId);
      if (task.status === 'running') throw new Error('任务已在运行中');
      task.status = 'running';
      task.updatedAt = nowIso();
      await this.store.saveTask(task);
      await this.logFor(taskId).append(taskId, 'user', 'task.started', { objective: task.objective });

      const outcome = await this.runOnce(task, {
        agentId: opts.agentId ?? 'auto',
        mode: 'run',
        profile: opts.profile,
        permissionFlags: opts.permissionFlags,
        allowedTools: opts.allowedTools,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
      });

      task = await this.getTask(taskId);
      task.runs.push(outcome.run);
      if (outcome.capsule) task.latestCapsuleId = outcome.capsule.id;
      task.status = outcome.run.exitCode === 0 && !outcome.run.error ? 'waiting' : 'failed';
      task.updatedAt = nowIso();
      await this.store.saveTask(task);
      await this.logFor(taskId).append(taskId, 'system', 'task.finished', { status: task.status, exitCode: outcome.run.exitCode });
      return outcome;
    });
  }

  /** Agent Hot Swap：任意 → 任意（ADR-005）。新 worktree 基于源分支，改动随分支带走。 */
  async swapAgent(
    taskId: string,
    opts: { toAgentId: string; level?: ContextLevel; profile?: 'safe' | 'developer' | 'full'; permissionFlags?: string[]; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<RunOutcome> {
    return this.withTaskLock(taskId, async () => {
      return await this.swapAgentInner(taskId, opts);
    });
  }

  private async swapAgentInner(
    taskId: string,
    opts: { toAgentId: string; level?: ContextLevel; profile?: 'safe' | 'developer' | 'full'; permissionFlags?: string[]; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<RunOutcome> {
    let task = await this.getTask(taskId);
    const sourceCapsule = this.latestCapsule(task);
    if (!sourceCapsule) throw new Error('没有可交接的 Capsule（先运行任务）');
    const sourceRun = task.runs.at(-1);
    if (!sourceRun?.worktreePath || !sourceRun.branch) throw new Error('缺少可交接的任务 worktree');
    await this.git.assertWorktree(task.repoRoot, sourceRun.worktreePath, sourceRun.branch);
    const toAdapter = await this.resolveAgent(opts.toAgentId);
    validatePermissionSelection(opts, toAdapter.id);
    const fromAgent = sourceRun.agentId;
    const sourceCheckpoint = await this.git.checkpoint(sourceRun.worktreePath, taskId + ' before handoff');
    if (sourceCheckpoint.committed) {
      await this.logFor(taskId).append(taskId, 'system', 'git.checkpoint', { worktree: sourceRun.worktreePath, hash: sourceCheckpoint.hash });
    }
    // Pin the source commit, including crash output, before creating a new worktree.
    const sourceBranch = await this.git.revParse(sourceRun.worktreePath);
    const currentDiff = await this.git.diffAgainstBase(sourceRun.worktreePath, task.baseRef);
    const handoffSource = parseCapsule({
      ...sourceCapsule,
      task: { id: task.id, objective: task.objective, constraints: task.constraints, userInstructions: task.userInstructions },
      progress: { ...task.progress },
      origin: { ...sourceCapsule.origin, agentId: fromAgent, sessionId: sourceRun.sessionId },
      workspace: {
        ...sourceCapsule.workspace, repoRoot: task.repoRoot, baseCommit: task.baseRef,
        branch: sourceRun.branch, worktreePath: sourceRun.worktreePath,
        changedFiles: currentDiff.files, diffStat: currentDiff.stat,
        commits: await this.git.commitsBetween(sourceRun.worktreePath, task.baseRef),
      },
      verification: sourceCheckpoint.committed ? { tests: sourceCapsule.verification.tests.map(test => ({
        ...test, summary: '历史测试记录；交接前工作区已变化，需重新验证。 ' + (test.summary ?? ''),
      })) } : sourceCapsule.verification,
    });

    task.status = 'running';
    task.updatedAt = nowIso();
    await this.store.saveTask(task);

    const log = this.logFor(taskId);
    await log.append(taskId, 'user', 'handoff.created', { from: fromAgent, to: opts.toAgentId, capsuleId: sourceCapsule.id });
    this.bus.publish({ from: fromAgent, to: opts.toAgentId, type: 'delegate', taskId, payload: { capsuleId: sourceCapsule.id } });
    const handoff = buildHandoffPrompt(handoffSource, opts.toAgentId, opts.level ?? 'standard');

    const outcome = await this.runOnce(task, {
      agentId: opts.toAgentId,
      mode: 'swap',
      baseRef: sourceBranch,
      prompt: handoff.prompt,
      profile: opts.profile,
      permissionFlags: opts.permissionFlags,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      makeCapsule: false, // capsule 由本方法构造（链接源 capsule）
      onWorktree: async (wt) => {
        writeHandoffFile(wt.path, handoff.handoffMd);
      },
    });

    // 七问验证探针：优先原生 resume 同会话，否则新开一次只读问答。
    // 目标 agent 本身运行失败时跳过探针（省一次注定失败的调用，避免噪音）。
    let probeAnswer = '';
    if (outcome.run.exitCode !== 0 || outcome.run.error) {
      await log.append(taskId, opts.toAgentId, 'agent.error', {
        kind: 'probe-skipped',
        hint: '接管运行已失败，跳过七问验证探针。请先根据上方诊断解决该 Agent 的问题（如充值/升级/登录）。',
      });
    } else {
      try {
        const probe = buildVerifyProbe();
        const probeOpts: AgentRunOptions = { cwd: outcome.worktreePath, timeoutMs: 120_000, signal: opts.signal };
        const probeResult =
          outcome.run.sessionId && toAdapter.supportsResume() && toAdapter.resume
            ? await toAdapter.resume(outcome.run.sessionId, probe, probeOpts)
            : await toAdapter.run(handoff.contextMd + '\n\n' + probe, probeOpts);
        if (probeResult.exitCode !== 0 || probeResult.timedOut) throw new Error('验证调用未成功完成');
        probeAnswer = probeResult.finalMessage;
        await log.append(taskId, opts.toAgentId, 'agent.replied', { kind: 'handoff-verify', answer: truncate(probeAnswer, 4000) });
        this.bus.publish({ from: opts.toAgentId, to: fromAgent, type: 'return-task', taskId, payload: { probeAnswer: truncate(probeAnswer, 2000) } });
      } catch (err) {
        await log.append(taskId, opts.toAgentId, 'agent.error', { message: `交接验证探针失败: ${(err as Error).message}` });
      }
    }

    const baseCommit = await this.git.revParse(task.repoRoot, task.baseRef);
    const wtPath = outcome.worktreePath!;
    const diff = await this.git.diffAgainstBase(wtPath, baseCommit);
    const commits = await this.git.commitsBetween(wtPath, baseCommit);
    const capsule = createCapsule({
      task: { id: task.id, objective: task.objective, constraints: task.constraints, userInstructions: task.userInstructions },
      status: outcome.run.exitCode === 0 ? 'in-progress' : 'failed',
      origin: { agentId: toAdapter.id, sessionId: outcome.run.sessionId, resumedFromCapsuleId: sourceCapsule.id },
      progress: {
        completed: task.progress.completed,
        remaining: task.progress.remaining,
        decisions: task.progress.decisions,
        rejectedApproaches: task.progress.rejectedApproaches,
      },
      workspace: {
        repoRoot: task.repoRoot,
        baseCommit,
        branch: outcome.branch,
        worktreePath: outcome.worktreePath,
        changedFiles: diff.files,
        diffStat: diff.stat,
        commits,
      },
      handoff: { fromAgent, toAgent: toAdapter.id, summary: truncate(outcome.run.finalMessage ?? '', 2000) },
      context: { keyFacts: [], environment: { platform: process.platform, node: process.version } },
    });
    const saved = await this.store.saveCapsule(taskId, capsule);
    await log.append(taskId, 'system', 'capsule.saved', { capsuleId: capsule.id, jsonPath: saved.jsonPath, mdPath: saved.mdPath });

    task = await this.getTask(taskId);
    outcome.run.capsuleId = capsule.id;
    task.runs.push(outcome.run);
    task.latestCapsuleId = capsule.id;
    task.status = outcome.run.exitCode === 0 && !outcome.run.error ? 'waiting' : 'failed';
    task.updatedAt = nowIso();
    await this.store.saveTask(task);
    await this.logFor(taskId).append(taskId, 'system', 'task.finished', { status: task.status, swap: true });

    return { ...outcome, capsule, diffFiles: diff.files.length, diffStat: diff.stat };
  }

  /** agent 间求助：@codex review …（M1 由用户触发；bus 语义与 A2A 对齐）。 */
  async askAgent(
    taskId: string,
    opts: { toAgentId: string; question: string; level?: ContextLevel; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<{ answer: string }> {
    const task = await this.getTask(taskId);
    const capsule = this.latestCapsule(task);
    const toAdapter = await this.resolveAgent(opts.toAgentId);
    const log = this.logFor(taskId);
    const fromAgent = capsule?.origin.agentId ?? 'user';

    const contextMd = capsule ? compileContext(capsule, opts.level ?? 'minimal').markdown : '';
    // Never fall back to the main checkout or an older workspace. This cwd check is not a read-only sandbox.
    const lastRun = task.runs.at(-1);
    const lastWorktree = lastRun?.worktreePath;
    if (!lastWorktree || !lastRun?.branch) {
      throw new Error('没有可用于求助的任务 worktree；请先运行任务或恢复最近一次工作区，不能回退到主工作区。');
    }
    await this.git.assertWorktree(task.repoRoot, lastWorktree, lastRun.branch);

    const prompt = [
      `另一个 AI agent（${fromAgent}）请求你的帮助。请直接回答，不要修改任何文件。`,
      contextMd ? `\n=== 当前任务上下文 ===\n${contextMd}=== 上下文结束 ===\n` : '',
      `## 请求`,
      opts.question,
    ].join('\n');

    const msg = this.bus.publish({ from: fromAgent, to: toAdapter.id, type: 'ask', taskId, payload: { question: opts.question } });
    await log.append(taskId, fromAgent, 'agent.asked', { to: toAdapter.id, question: opts.question });

    const result = await toAdapter.run(prompt, { cwd: lastWorktree, timeoutMs: opts.timeoutMs ?? 180_000, signal: opts.signal });
    // ask 的失败绝不当作"回答"返回（曾把 402 错误当成评审结论交回给用户）
    if (result.exitCode !== 0 || result.timedOut) {
      const d = diagnoseFailure({ finalMessage: result.finalMessage, stderrTail: result.stderrTail, exitCode: result.exitCode });
      const hint = d ? `[${d.kind}] ${d.hint}` : `Agent ${toAdapter.id} 返回失败（exit=${result.exitCode}），请查看时间线详情。`;
      await log.append(taskId, toAdapter.id, 'agent.error', { kind: 'ask-failed', hint });
      throw new Error(hint);
    }
    this.bus.recordReply(msg.id, truncate(result.finalMessage, 4000));
    await log.append(taskId, toAdapter.id, 'agent.replied', { kind: 'ask', answer: truncate(result.finalMessage, 4000) });
    return { answer: result.finalMessage };
  }

  /**
   * 同会话跟进（vibe-kanban 验证过的高频需求）：向该任务最近一次运行的 agent 发送新指令。
   * 优先恢复当前 Agent 的原生会话；工作区缺失时拒绝执行，保护主工作区。
   */
  async followUp(
    taskId: string,
    opts: { message: string; agentId?: string; profile?: 'safe' | 'developer' | 'full'; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<RunOutcome> {
    return this.withTaskLock(taskId, async () => {
      return await this.followUpInner(taskId, opts);
    });
  }

  private async followUpInner(
    taskId: string,
    opts: { message: string; agentId?: string; profile?: 'safe' | 'developer' | 'full'; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<RunOutcome> {
    const task = await this.getTask(taskId);
    if (task.status === 'running') throw new Error('任务已在运行中');
    const lastRun = [...task.runs].reverse().find((r) => r.agentId);
    const agentId = opts.agentId ?? lastRun?.agentId;
    if (!agentId) throw new Error('没有可跟进的历史运行（先运行任务）');
    const adapter = await this.resolveAgent(agentId);
    const log = this.logFor(taskId);
    await log.append(taskId, 'user', 'agent.followup', { agentId, message: truncate(opts.message, 500) });

    const lastWorktree = lastRun?.worktreePath;
    if (!lastWorktree || !fs.existsSync(lastWorktree)) {
      throw new Error('任务 worktree 不存在；请恢复该目录后重试，不能回退到主工作区。');
    }
    if (!lastRun?.branch) throw new Error('任务 worktree 缺少分支记录，已停止操作');
    await this.git.assertWorktree(task.repoRoot, lastWorktree, lastRun.branch);
    const cwd = lastWorktree;
    // Resolve the baseline before launching; a missing base is not evidence of zero changes.
    const baseCommit = await this.git.revParse(cwd, task.baseRef);
    const lastSession = lastRun?.agentId === agentId ? lastRun : undefined;
    const runOpts: AgentRunOptions = {
      cwd,
      permissionFlags: resolveRunPermissions(agentId, { profile: opts.profile }),
      timeoutMs: opts.timeoutMs ?? this.defaultTimeoutMs,
      signal: opts.signal,
      onEvent: (evt) => {
        void log.append(taskId, agentId, `agent.${evt.type}`, evt.data);
      },
    };

    task.status = 'running';
    task.updatedAt = nowIso();
    await this.store.saveTask(task);

    let result: AgentRunResult;
    if (adapter.supportsResume() && adapter.resume && lastSession?.sessionId) {
      result = await adapter.resume(lastSession.sessionId, opts.message, runOpts);
    } else {
      const capsule = this.latestCapsule(task);
      const contextMd = capsule ? compileContext(capsule, 'minimal').markdown : '';
      result = await adapter.run(
        `${contextMd ? `=== 任务上下文 ===\n${contextMd}=== 上下文结束 ===\n\n` : ''}## 用户新指令\n${opts.message}`,
        runOpts,
      );
    }

    await log.append(taskId, agentId, 'agent.result', { followup: true, exitCode: result.exitCode });
    let followupHint: string | undefined;
    if (result.exitCode !== 0 || result.timedOut) {
      const d = diagnoseFailure({ finalMessage: result.finalMessage, stderrTail: result.stderrTail, exitCode: result.exitCode });
      followupHint = d ? `[${d.kind}] ${d.hint}` : `Agent 运行失败（exit=${result.exitCode}），详情见时间线。`;
      await log.append(taskId, agentId, 'agent.error', { kind: d?.kind ?? 'unknown', hint: followupHint });
    }
    const committed = await this.git.checkpoint(cwd, `${taskId} followup ${agentId}`);
    if (committed.committed) await log.append(taskId, 'system', 'git.checkpoint', { worktree: lastWorktree, hash: committed.hash });

    const branch = lastRun.branch;
    const diff = await this.git.diffAgainstBase(cwd, baseCommit);

    const capsule = createCapsule({
      task: { id: task.id, objective: task.objective, constraints: task.constraints, userInstructions: task.userInstructions },
      status: result.exitCode === 0 ? 'in-progress' : 'failed',
      origin: { agentId, sessionId: result.sessionRef, resumedFromCapsuleId: task.latestCapsuleId },
      progress: {
        completed: task.progress.completed,
        remaining: task.progress.remaining,
        decisions: task.progress.decisions,
        rejectedApproaches: task.progress.rejectedApproaches,
      },
      workspace: {
        repoRoot: task.repoRoot,
        baseCommit,
        branch,
        worktreePath: lastWorktree,
        changedFiles: diff.files,
        diffStat: diff.stat,
        commits: await this.git.commitsBetween(cwd, baseCommit),
      },
      handoff: { fromAgent: agentId, summary: truncate(result.finalMessage, 2000) },
      context: { keyFacts: [], environment: { platform: process.platform, node: process.version } },
    });
    await this.store.saveCapsule(taskId, capsule);

    const fresh = await this.getTask(taskId);
    const run: SessionRun = {
      id: newId('run'),
      agentId,
      mode: 'resume',
      sessionId: result.sessionRef,
      branch,
      worktreePath: lastWorktree,
      capsuleId: capsule.id,
      exitCode: result.exitCode,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      finalMessage: truncate(result.finalMessage, 2000),
      durationMs: result.durationMs,
      error: followupHint,
    };
    fresh.runs.push(run);
    fresh.latestCapsuleId = capsule.id;
    fresh.status = result.exitCode === 0 && !result.timedOut ? 'waiting' : 'failed';
    fresh.updatedAt = nowIso();
    await this.store.saveTask(fresh);
    await log.append(taskId, 'system', 'capsule.saved', { capsuleId: capsule.id });
    return { run, capsule, worktreePath: lastWorktree, branch, diffFiles: diff.files.length, diffStat: diff.stat };
  }

  /** Session Fork：相同起点（同一 base commit + 相同目标），各自独立 worktree 并行。 */
  async forkAll(
    taskId: string,
    opts: { agentIds: string[]; profile?: 'safe' | 'developer' | 'full'; permissionFlags?: string[]; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<Array<RunOutcome & { agentId: string }>> {
    return this.withTaskLock(taskId, async () => {
      return await this.forkAllInner(taskId, opts);
    });
  }

  private async forkAllInner(
    taskId: string,
    opts: { agentIds: string[]; profile?: 'safe' | 'developer' | 'full'; permissionFlags?: string[]; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<Array<RunOutcome & { agentId: string }>> {
    if (!opts.agentIds.length || new Set(opts.agentIds).size !== opts.agentIds.length) {
      throw new Error('Fork 需要非空且不重复的 Agent 列表');
    }
    let task = await this.getTask(taskId);
    if (task.status === 'running') throw new Error('任务已在运行中');
    task.status = 'running';
    task.updatedAt = nowIso();
    await this.store.saveTask(task);
    const log = this.logFor(taskId);
    await log.append(taskId, 'user', 'fork.created', { agents: opts.agentIds, baseRef: task.baseRef });

    const settled = await Promise.allSettled(
      opts.agentIds.map((agentId) =>
        this.runOnce(task, {
          agentId,
          mode: 'fork',
          baseRef: task.baseRef,
          profile: opts.profile,
          permissionFlags: opts.permissionFlags,
          timeoutMs: opts.timeoutMs,
          signal: opts.signal,
        }),
      ),
    );

    const outcomes: RunOutcome[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') outcomes.push(result.value);
      else await log.append(taskId, 'system', 'agent.error', { kind: 'fork-failed', message: String(result.reason) });
    }
    task = await this.getTask(taskId);
    for (const o of outcomes) {
      task.runs.push(o.run);
      if (o.capsule) task.latestCapsuleId = o.capsule.id;
    }
    const anyOk = outcomes.some((o) => o.run.exitCode === 0 && !o.run.error);
    task.status = anyOk ? 'waiting' : 'failed';
    task.updatedAt = nowIso();
    await this.store.saveTask(task);
    await this.logFor(taskId).append(taskId, 'system', 'task.finished', { status: task.status, fork: true, agents: opts.agentIds });
    return outcomes.map((o) => ({ ...o, agentId: o.run.agentId }));
  }

  /** 崩溃恢复：同 agent（或指定 agent）基于最新 capsule 续接。 */
  async resumeTask(taskId: string, opts: { agentId?: string; level?: ContextLevel } = {}): Promise<RunOutcome> {
    const task = await this.getTask(taskId);
    const lastAgent = [...task.runs].reverse().find((r) => r.agentId)?.agentId;
    const agentId = opts.agentId ?? lastAgent;
    if (!agentId) throw new Error('无法确定续接的 agent（任务没有运行记录），请用 swapAgent 指定');
    if (agentId === lastAgent) {
      return this.followUp(taskId, {
        agentId,
        message: this.buildTaskPrompt(task) + '\n\n（续接：请继续完成剩余工作）',
      });
    }
    // 跨 agent 或不支持原生 resume → swap 通道（capsule 注入）
    return this.swapAgent(taskId, { toAgentId: agentId, level: opts.level });
  }

  /** 服务重启后调用：running 状态的任务标记为 interrupted（进程已不在）。 */
  async recoverAll(): Promise<string[]> {
    const tasks = await this.store.listTasks();
    const recovered: string[] = [];
    for (const task of tasks) {
      if (task.status === 'running') {
        // worktree.created is durable before the adapter starts. Reconstruct runs
        // lost when the server exited before writing the completion record.
        const events = await this.logFor(task.id).readAll();
        for (const event of events) {
          if (event.type !== 'worktree.created') continue;
          const workspace = event.payload as { path?: string; branch?: string; agentId?: string } | undefined;
          if (!workspace || typeof workspace.path !== 'string' || typeof workspace.branch !== 'string' ||
              typeof workspace.agentId !== 'string' || !fs.existsSync(workspace.path) ||
              task.runs.some(run => run.worktreePath === workspace.path)) continue;
          task.runs.push({
            id: newId('run'), agentId: workspace.agentId, mode: 'run',
            branch: workspace.branch, worktreePath: workspace.path,
            startedAt: event.ts, exitCode: null, error: 'Interrupted before completion was saved',
          });
        }
        task.status = 'interrupted';
        task.updatedAt = nowIso();
        await this.store.saveTask(task);
        await this.logFor(task.id).append(task.id, 'system', 'task.recovered', { note: '进程不存在，标记为 interrupted；可 resume/swap 接续' });
        recovered.push(task.id);
      }
    }
    return recovered;
  }

  /** 删除任务：清理其 worktree（尽力而为）并移除任务目录。长期使用的数据管理能力。 */
  async deleteTask(taskId: string): Promise<{ worktreesRemoved: number }> {
    if (this.runningTasks.has(taskId)) throw new Error('任务正在运行中，无法删除');
    const task = await this.getTask(taskId);
    let worktreesRemoved = 0;
    for (const run of task.runs) {
      if (!run.worktreePath || !fs.existsSync(run.worktreePath)) continue;
      try {
        await this.git.removeWorktree(task.repoRoot, run.worktreePath, true);
        worktreesRemoved++;
      } catch {
        // worktree 可能已被用户手动移除；继续
      }
    }
    fs.rmSync(this.store.taskDir(taskId), { recursive: true, force: true });
    this.logs.delete(taskId);
    return { worktreesRemoved };
  }

  buildTaskPrompt(task: TaskRecord): string {
    const parts = [`# 任务\n${task.objective}`];
    if (task.constraints.length) parts.push(`## 约束\n${task.constraints.map((c) => `- ${c}`).join('\n')}`);
    if (task.userInstructions.length) parts.push(`## 用户指令\n${task.userInstructions.map((c) => `- ${c}`).join('\n')}`);
    parts.push('完成后请给出一段简明总结：完成了什么、剩余什么、关键决策（该总结会进入 Session Capsule 供后续 agent 交接）。');
    return parts.join('\n\n');
  }

  taskStore(): TaskStore {
    return this.store;
  }
}

export { profileFor };
