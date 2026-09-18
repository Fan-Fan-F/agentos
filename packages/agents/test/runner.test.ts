import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { beforeEach, describe, expect, it } from 'vitest';
import { GitEngine } from '@agentos/core';
import { TaskRunner } from '../src/runner.js';
import { StubAdapter } from '../src/stub.js';

/**
 * 引擎闭环集成测试（真实临时 git 仓库 + Stub 适配器，见 TESTING.md 的真实性边界）。
 * 覆盖：solo 运行 → Capsule → Hot Swap（含七问探针）→ ask 协作 → Fork → 崩溃恢复 → Resume。
 */

let repoRoot = '';
let dataDir = '';

beforeEach(async () => {
  repoRoot = path.join(mkdtempSync(path.join(tmpdir(), 'agentos-run-')), 'repo');
  dataDir = mkdtempSync(path.join(tmpdir(), 'agentos-home-'));
  mkdirSync(repoRoot, { recursive: true });
  const g = simpleGit(repoRoot);
  await g.init();
  await g.addConfig('user.name', 'agentos-test');
  await g.addConfig('user.email', 'test@agentos.local');
  writeFileSync(path.join(repoRoot, 'README.md'), '# demo\n');
  await g.add('.');
  await g.commit('init');
});

function makeRunner(adapters = defaultAdapters()) {
  return new TaskRunner({ dataDir, adapters, git: new GitEngine() });
}

function defaultAdapters() {
  const claude = new StubAdapter('claude', (prompt, resumed) => ({
    events: [{ type: 'message', data: { text: resumed ? 'claude 续接中' : 'claude 工作中' } }],
    finalMessage: resumed
      ? '续接完成。任务是实现 X；已完成主体；下一步补测试。'
      : 'claude 完成了实现 X 的主体工作，还差测试。决策：用工厂函数构造客户端。',
    sessionRef: 'claude-s1',
  }));
  const codex = new StubAdapter('codex', (prompt, resumed) => ({
    events: [{ type: 'message', data: { text: resumed ? 'codex 续接' : 'codex 接管' } }],
    finalMessage: resumed
      ? '1.任务是实现X 2.已完成主体 3.已否决JSON导出 4.改了src/x.ts 5.通过2 6.失败0 7.补文档'
      : 'codex 已接管：确认任务是实现 X，将继续完成剩余工作。',
    sessionRef: 'codex-s1',
  }));
  const gemini = new StubAdapter('gemini', () => ({
    events: [],
    finalMessage: 'gemini 评审：实现整体正确，建议补充空值边界测试。',
    sessionRef: 'gemini-s1',
  }));
  return [claude, codex, gemini];
}

describe('TaskRunner 引擎闭环', () => {
  it('非 git 目录拒绝创建任务', async () => {
    const runner = makeRunner();
    await expect(runner.createTask({ repoRoot: dataDir, objective: 'x' })).rejects.toThrow(/不是 git 仓库/);
  });

  it('solo 运行：worktree/分支/checkpoint/diff/capsule/timeline 全链路', async () => {
    const runner = makeRunner();
    const task = await runner.createTask({
      repoRoot,
      objective: '实现 X 功能',
      constraints: ['不加依赖'],
    });
    expect(task.baseRef).toBeTruthy();

    const outcome = await runner.runTask(task.id, { agentId: 'claude' });
    expect(outcome.branch).toMatch(/^agentos\//);
    expect(outcome.worktreePath).toContain('.agentos-worktrees');
    expect(outcome.capsule).toBeDefined();
    expect(outcome.capsule!.origin.agentId).toBe('claude');
    expect(outcome.capsule!.handoff.summary).toContain('实现 X');

    const after = await runner.getTask(task.id);
    expect(after.status).toBe('done');
    expect(after.latestCapsuleId).toBe(outcome.capsule!.id);
    expect(after.runs[0]!.sessionId).toBe('claude-s1');

    const events = await runner.logFor(task.id).readAll();
    const types = events.map((e) => e.type);
    expect(types).toContain('task.created');
    expect(types).toContain('agent.spawned');
    expect(types).toContain('worktree.created');
    expect(types).toContain('agent.message');
    expect(types).toContain('capsule.saved');
    expect(types).toContain('task.finished');

    // capsule JSON + MD 双文件落盘
    const { existsSync, readFileSync } = await import('node:fs');
    const capJson = runner.taskStore().capsuleFile(task.id, outcome.capsule!.id);
    expect(existsSync(capJson)).toBe(true);
    expect(readFileSync(capJson.replace(/\.json$/, '.md'), 'utf8')).toContain('# Session Capsule');
  });

  it('Hot Swap：Claude → Codex 无需用户重新解释（目标收到编译上下文+七问），capsule 链接成链', async () => {
    const runner = makeRunner();
    const claude = runner.adapterFor('claude') as StubAdapter;
    const codex = runner.adapterFor('codex') as StubAdapter;
    const task = await runner.createTask({ repoRoot, objective: '实现 X 功能', constraints: ['不加依赖'] });
    const r1 = await runner.runTask(task.id, { agentId: 'claude' });

    const r2 = await runner.swapAgent(task.id, { toAgentId: 'codex' });

    // 目标 agent 收到的 prompt 必须包含任务目标与交接要素（"不能要求用户重新解释项目"）
    const swapCall = codex.calls.find((c) => !c.resumed && c.prompt.includes('接管'))!;
    expect(swapCall).toBeDefined();
    expect(swapCall.prompt).toContain('实现 X 功能');
    expect(swapCall.prompt).toContain('不加依赖');
    expect(swapCall.prompt).toContain('HANDOFF.md');
    expect(swapCall.prompt).toContain('1. 当前任务是什么');
    // 接管发生在从源分支新建的 worktree（改动随分支带走）
    expect(r2.branch).not.toBe(r1.branch);
    expect(r2.worktreePath).not.toBe(r1.worktreePath);
    // HANDOFF.md 已写入接管 worktree
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path.join(r2.worktreePath!, '.agentos', 'HANDOFF.md'), 'utf8')).toContain('实现 X 功能');
    // capsule 链
    expect(r2.capsule!.origin.resumedFromCapsuleId).toBe(r1.capsule!.id);
    expect(r2.capsule!.handoff.fromAgent).toBe('claude');
    expect(r2.capsule!.handoff.toAgent).toBe('codex');
    // 七问探针通过原生 resume 发出（codex supportsResume）
    expect(codex.calls.some((c) => c.resumed && c.prompt.includes('当前任务是什么'))).toBe(true);
    // 探针回答入 Timeline
    const events = await runner.logFor(task.id).readAll();
    const reply = events.find((e) => e.type === 'agent.replied' && (e.payload as { kind?: string })?.kind === 'handoff-verify');
    expect(reply).toBeDefined();
    // claude 适配器未被打扰
    expect(claude.calls.every((c) => !c.prompt.includes('接管'))).toBe(true);
  });

  it('ask：跨 agent 请求评审，携带 minimal 上下文，回答入 Timeline', async () => {
    const runner = makeRunner();
    const task = await runner.createTask({ repoRoot, objective: '实现 X 功能' });
    await runner.runTask(task.id, { agentId: 'claude' });

    const { answer } = await runner.askAgent(task.id, { toAgentId: 'gemini', question: 'review 这个实现有没有边界问题' });
    expect(answer).toContain('评审');
    const gemini = runner.adapterFor('gemini') as StubAdapter;
    const askCall = gemini.calls.find((c) => c.prompt.includes('review 这个实现'))!;
    expect(askCall).toBeDefined();
    expect(askCall.prompt).toContain('实现 X 功能'); // 上下文已注入
    expect(askCall.opts?.cwd).toBeTruthy();

    const events = await runner.logFor(task.id).readAll();
    expect(events.some((e) => e.type === 'agent.asked' && e.actor === 'claude')).toBe(true);
    expect(events.some((e) => e.type === 'agent.replied' && e.actor === 'gemini')).toBe(true);
  });

  it('forkAll：相同起点并行，各得独立分支与 capsule，汇总可对比', async () => {
    const runner = makeRunner();
    const task = await runner.createTask({ repoRoot, objective: '实现 X 功能' });
    const outcomes = await runner.forkAll(task.id, { agentIds: ['claude', 'codex'] });

    expect(outcomes).toHaveLength(2);
    const branches = outcomes.map((o) => o.branch).sort();
    expect(new Set(branches).size).toBe(2);
    const bases = outcomes.map((o) => o.capsule!.workspace.baseCommit);
    expect(new Set(bases).size).toBe(1); // 相同起点
    expect(outcomes.every((o) => o.capsule!.task.objective === '实现 X 功能')).toBe(true);

    const taskAfter = await runner.getTask(task.id);
    expect(taskAfter.runs.length).toBe(2);
    const forkEvent = (await runner.logFor(task.id).readAll()).find((e) => e.type === 'fork.created');
    expect(forkEvent).toBeDefined();
  });

  it('崩溃恢复：重启后 recoverAll 标记 interrupted，resume 用 capsule 续接成新 capsule', async () => {
    const runner = makeRunner();
    const task = await runner.createTask({ repoRoot, objective: '实现 X 功能' });
    await runner.runTask(task.id, { agentId: 'claude' });

    // 模拟"运行中崩溃"残留
    const t = await runner.getTask(task.id);
    t.status = 'running';
    await runner.taskStore().saveTask(t);

    const recovered = await runner.recoverAll();
    expect(recovered).toContain(task.id);
    expect((await runner.getTask(task.id)).status).toBe('interrupted');

    const claude = runner.adapterFor('claude') as StubAdapter;
    const beforeResume = claude.calls.filter((c) => c.resumed).length;
    const r = await runner.resumeTask(task.id); // 同 agent → 原生 resume 通道
    expect(r.capsule!.origin.resumedFromCapsuleId).toBe(t.latestCapsuleId);
    expect(claude.calls.filter((c) => c.resumed).length).toBe(beforeResume + 1);
    expect((await runner.getTask(task.id)).status).toBe('done');
  });

  it('updateProgress 写入的进度会进入下一次 capsule', async () => {
    const runner = makeRunner();
    const task = await runner.createTask({ repoRoot, objective: '实现 X 功能' });
    await runner.updateProgress(task.id, {
      completed: ['调研完成'],
      remaining: ['实现'],
      decisions: [{ summary: '不用 iframe' }],
      rejectedApproaches: [{ approach: '方案 A', reason: '性能差' }],
    });
    const outcome = await runner.runTask(task.id, { agentId: 'codex' });
    expect(outcome.capsule!.progress.completed).toEqual(['调研完成']);
    expect(outcome.capsule!.progress.rejectedApproaches[0]!.approach).toBe('方案 A');
  });

  it('followUp：同会话续聊走原生 resume，产生链式 Capsule 并入 Timeline', async () => {
    const runner = makeRunner();
    const claude = runner.adapterFor('claude') as StubAdapter;
    const task = await runner.createTask({ repoRoot, objective: '实现 X 功能' });
    await runner.runTask(task.id, { agentId: 'claude' });
    const resumedBefore = claude.calls.filter((c) => c.resumed).length;

    const r = await runner.followUp(task.id, { message: '把日志改成英文并重跑测试' });
    expect(claude.calls.filter((c) => c.resumed).length).toBe(resumedBefore + 1);
    expect(claude.calls.at(-1)!.prompt).toContain('把日志改成英文');
    expect(r.capsule!.origin.resumedFromCapsuleId).toBeTruthy();
    expect(r.capsule!.origin.agentId).toBe('claude');
    const after = await runner.getTask(task.id);
    expect(after.status).toBe('done');
    expect(after.runs.at(-1)!.mode).toBe('resume');
    const events = await runner.logFor(task.id).readAll();
    expect(events.some((e) => e.type === 'agent.followup')).toBe(true);
  });

  it('并发守卫：同一任务不允许同时运行两次', async () => {
    const runner = makeRunner();
    const task = await runner.createTask({ repoRoot, objective: '实现 X 功能' });
    // stub 立即返回，用 Promise 竞态模拟并发：第二次调用必须被拒
    const p1 = runner.runTask(task.id, { agentId: 'claude' });
    await expect(runner.runTask(task.id, { agentId: 'codex' })).rejects.toThrow(/已在运行/);
    await p1;
  });

  it('swap 时向不存在的 capsule 拒绝', async () => {
    const runner = makeRunner();
    const task = await runner.createTask({ repoRoot, objective: 'x' });
    await expect(runner.swapAgent(task.id, { toAgentId: 'codex' })).rejects.toThrow(/没有可交接的 Capsule/);
  });
});
