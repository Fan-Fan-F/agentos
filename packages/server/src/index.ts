import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import {
  defaultDataDir,
  JsonStore,
  newId,
  nowIso,
  type DiscoveredAgent,
} from '@agentos/core';
import {
  createDefaultAdapters,
  executeInstall,
  listClaudeSessions,
  listCodexSessions,
  planInstall,
  scanAgents,
  TaskRunner,
  claudeSessionToCapsule,
  codexSessionToCapsule,
  defaultClaudeProjectsDir,
  defaultCodexSessionsDir,
  type AgentAdapter,
} from '@agentos/agents';

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface AgentOSServerOptions {
  dataDir?: string;
  webRoot?: string;
  adapters?: AgentAdapter[];
  scan?: typeof scanAgents;
}

export interface AgentOSServer {
  app: FastifyInstance;
  runner: TaskRunner;
  dataDir: string;
}

function resolveWebRoot(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (process.env.AGENTOS_WEB_ROOT) return process.env.AGENTOS_WEB_ROOT;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, '../../../apps/web');
  return fs.existsSync(candidate) ? candidate : undefined;
}

/**
 * 权限参数黑名单（SECURITY.md）：API 层拒绝 bypass 类 flag。
 * 确有需要时由用户显式设置 AGENTOS_ALLOW_BYPASS=1 启动服务并自担风险。
 */
const DANGEROUS_FLAG_RE = /dangerously|bypass|yolo/i;

function sanitizePermissionFlags(flags?: string[]): string[] | undefined {
  if (!flags?.length) return undefined;
  if (process.env.AGENTOS_ALLOW_BYPASS === '1') return flags;
  const bad = flags.filter((f) => DANGEROUS_FLAG_RE.test(f));
  if (bad.length) {
    throw new Error(`拒绝危险权限参数: ${bad.join(', ')}（平台策略禁止绕过 agent 权限；如确需请以 AGENTOS_ALLOW_BYPASS=1 启动并自担风险）`);
  }
  return flags;
}

/** 构建本地 API 服务（依赖注入便于测试；ADR-001）。 */
export async function createAgentOSServer(opts: AgentOSServerOptions = {}): Promise<AgentOSServer> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const adapters = opts.adapters ?? createDefaultAdapters();
  const runner = new TaskRunner({ dataDir, adapters });
  const scan = opts.scan ?? scanAgents;
  const doScan = scan;

  const projects = new JsonStore<ProjectRecord>(path.join(dataDir, 'projects'));
  const imports = new JsonStore<Record<string, unknown> & { id: string }>(path.join(dataDir, 'imports'));
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });

  // 启动即恢复：把"上次运行中"的任务标记为 interrupted（任务书 §24）
  const recovered = await runner.recoverAll();
  if (recovered.length) app.log.warn({ recovered }, 'recovered interrupted tasks');

  app.get('/api/health', async () => ({ ok: true, name: 'agentos', version: '0.2.0' }));

  // ---------- Agents ----------
  let agentsCache: { at: number; data: DiscoveredAgent[] } | undefined;

  app.get('/api/agents', async (req, reply) => {
    const q = req.query as { refresh?: string; probe?: string };
    const fresh = q.refresh === '1';
    if (!agentsCache || fresh || Date.now() - agentsCache.at > 30_000) {
      // 只读扫描；probe=1 表示用户显式要求版本探测（会执行 --version）
      const data = await doScan({ probe: q.probe === '1' });
      agentsCache = { at: Date.now(), data };
    }
    return reply.send(agentsCache.data);
  });

  app.post('/api/agents/:id/install', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { execute?: boolean };
    const plan = planInstall(id);
    if (!plan) return reply.code(404).send({ error: `没有 ${id} 的官方安装方案` });
    if (!body.execute) return reply.send(plan);
    try {
      const result = await executeInstall(plan);
      return reply.send({ plan, result });
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // ---------- 会话导入（只读，用户显式触发） ----------
  app.get('/api/imports/:source', async (req, reply) => {
    const { source } = req.params as { source: string };
    const q = req.query as { dir?: string };
    try {
      if (source === 'claude') return await listClaudeSessions(q.dir || defaultClaudeProjectsDir());
      if (source === 'codex') return await listCodexSessions(q.dir || defaultCodexSessionsDir());
      return reply.code(400).send({ error: 'source 必须是 claude 或 codex' });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/imports/save', async (req, reply) => {
    const body = (req.body ?? {}) as { source?: string; file?: string; objective?: string };
    if (!body.file) return reply.code(400).send({ error: '缺少 file' });
    try {
      const capsule =
        body.source === 'codex'
          ? await codexSessionToCapsule(body.file, { objective: body.objective })
          : await claudeSessionToCapsule(body.file, { objective: body.objective });
      await imports.put(capsule as unknown as Record<string, unknown> & { id: string });
      return reply.code(201).send(capsule);
    } catch (err) {
      return reply.code(400).send({ error: `导入失败: ${(err as Error).message}` });
    }
  });

  // ---------- Projects ----------
  app.get('/api/projects', async () => projects.all());

  app.post('/api/projects', async (req, reply) => {
    const body = (req.body ?? {}) as { path?: string; name?: string };
    const p = body.path?.trim();
    if (!p || !fs.existsSync(p)) return reply.code(400).send({ error: `目录不存在: ${p}` });
    if (!(await runner.git.isRepo(p))) {
      return reply.code(400).send({ error: `${p} 不是 git 仓库（AgentOS 需要在 git 仓库上工作）` });
    }
    const record: ProjectRecord = {
      id: newId('proj'),
      name: body.name?.trim() || path.basename(p),
      path: p,
      createdAt: nowIso(),
    };
    await projects.put(record);
    return reply.code(201).send(record);
  });

  app.delete('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    await projects.delete(id);
    return { ok: true };
  });

  // ---------- Tasks ----------
  app.get('/api/tasks', async () => runner.listTasks());

  app.post('/api/tasks', async (req, reply) => {
    const body = (req.body ?? {}) as {
      repoRoot?: string;
      projectId?: string;
      objective?: string;
      constraints?: string[];
      userInstructions?: string[];
      /** 从已保存的导入 Capsule 创建任务（接管平台外历史会话） */
      capsuleId?: string;
    };
    let repoRoot = body.repoRoot;
    if (!repoRoot && body.projectId) {
      const proj = await projects.get(body.projectId);
      repoRoot = proj?.path;
    }
    if (!repoRoot) return reply.code(400).send({ error: '缺少 repoRoot 或 projectId' });

    let importedCapsule: Record<string, unknown> | undefined;
    if (body.capsuleId) {
      importedCapsule = await imports.get(body.capsuleId);
      if (!importedCapsule) return reply.code(404).send({ error: `导入 Capsule 不存在: ${body.capsuleId}` });
    }
    const taskCapsule = importedCapsule as
      | { task?: { objective?: string; constraints?: string[]; userInstructions?: string[] }; progress?: { completed?: string[]; remaining?: string[]; decisions?: unknown[]; rejectedApproaches?: unknown[] } }
      | undefined;
    const objective = body.objective?.trim() || taskCapsule?.task?.objective;
    if (!objective) return reply.code(400).send({ error: '缺少 objective（且未提供可用的导入 Capsule）' });
    try {
      const task = await runner.createTask({
        repoRoot,
        objective,
        constraints: body.constraints ?? taskCapsule?.task?.constraints ?? [],
        userInstructions: body.userInstructions ?? taskCapsule?.task?.userInstructions ?? [],
      });
      const prog = taskCapsule?.progress;
      if (prog && ((prog.completed?.length ?? 0) + (prog.remaining?.length ?? 0) > 0 || (prog.decisions?.length ?? 0) > 0)) {
        await runner.updateProgress(task.id, {
          completed: prog.completed ?? [],
          remaining: prog.remaining ?? [],
          decisions: (prog.decisions ?? []) as never,
          rejectedApproaches: (prog.rejectedApproaches ?? []) as never,
        });
      }
      return reply.code(201).send(task);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await runner.taskStore().getTask(id);
    if (!task) return reply.code(404).send({ error: '任务不存在' });
    const capsule = runner.latestCapsule(task);
    return { task, capsuleId: capsule?.id };
  });

  app.post('/api/tasks/:id/progress', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await runner.updateProgress(id, (req.body ?? {}) as never);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/tasks/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { agentId?: string; permissionFlags?: string[]; allowedTools?: string[]; timeoutMs?: number };
    try {
      return await runner.runTask(id, { ...body, permissionFlags: sanitizePermissionFlags(body.permissionFlags) });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/tasks/:id/swap', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { toAgentId?: string; level?: 'minimal' | 'standard' | 'full'; permissionFlags?: string[] };
    if (!body.toAgentId) return reply.code(400).send({ error: '缺少 toAgentId' });
    try {
      return await runner.swapAgent(id, { toAgentId: body.toAgentId, level: body.level, permissionFlags: sanitizePermissionFlags(body.permissionFlags) });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/tasks/:id/followup', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { message?: string; agentId?: string };
    if (!body.message?.trim()) return reply.code(400).send({ error: '缺少 message' });
    try {
      return await runner.followUp(id, { message: body.message.trim(), agentId: body.agentId });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/tasks/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { agentId?: string };
    try {
      return await runner.resumeTask(id, body);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/tasks/:id/ask', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { toAgentId?: string; question?: string };
    if (!body.toAgentId || !body.question) return reply.code(400).send({ error: '缺少 toAgentId 或 question' });
    try {
      return await runner.askAgent(id, body as { toAgentId: string; question: string });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/tasks/:id/fork', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { agentIds?: string[]; permissionFlags?: string[] };
    if (!body.agentIds?.length) return reply.code(400).send({ error: '缺少 agentIds' });
    try {
      return await runner.forkAll(id, { agentIds: body.agentIds, permissionFlags: sanitizePermissionFlags(body.permissionFlags) });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/tasks/:id/events', async (req) => {
    const { id } = req.params as { id: string };
    return runner.logFor(id).readAll();
  });

  app.get('/api/tasks/:id/capsule', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { format?: string };
    const task = await runner.taskStore().getTask(id);
    const capsule = task ? runner.latestCapsule(task) : undefined;
    if (!capsule) return reply.code(404).send({ error: '还没有 Capsule（先运行任务）' });
    if (q.format === 'md') {
      const { capsuleToMarkdown } = await import('@agentos/core');
      return reply.type('text/markdown; charset=utf-8').send(capsuleToMarkdown(capsule));
    }
    return capsule;
  });

  app.get('/api/tasks/:id/diff', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await runner.taskStore().getTask(id);
    if (!task) return reply.code(404).send({ error: '任务不存在' });
    const lastRun = [...task.runs].reverse().find((r) => r.worktreePath);
    if (!lastRun?.worktreePath) return { files: [], stat: '', note: '还没有运行记录' };
    try {
      const base = task.baseRef;
      const diff = await runner.git.diffAgainstBase(lastRun.worktreePath, base);
      return { branch: lastRun.branch, worktree: lastRun.worktreePath, ...diff };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // ---------- 静态 Web UI ----------
  const webRoot = resolveWebRoot(opts.webRoot);
  if (webRoot && fs.existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, prefix: '/' });
  }

  return { app, runner, dataDir };
}

export interface StartedServer extends AgentOSServer {
  url: string;
  port: number;
  wss: WebSocketServer;
  close(): Promise<void>;
}

/** 启动服务 + WebSocket（/ws?taskId=… 实时推送 Timeline）。 */
export async function startAgentOSServer(
  opts: AgentOSServerOptions & { port?: number; host?: string } = {},
): Promise<StartedServer> {
  const { app, runner, dataDir } = await createAgentOSServer(opts);
  const port = opts.port ?? Number(process.env.AGENTOS_PORT ?? 7333);
  const host = opts.host ?? '127.0.0.1';
  await app.listen({ port, host });

  const wss = new WebSocketServer({ server: app.server, path: '/ws' });
  wss.on('connection', (conn, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const taskId = url.searchParams.get('taskId');
    if (!taskId) {
      conn.close();
      return;
    }
    const log = runner.logFor(taskId);
    const unsub = log.subscribe((evt) => {
      if (conn.readyState === conn.OPEN) conn.send(JSON.stringify(evt));
    });
    conn.on('close', unsub);
    void log.readAll().then((events) => {
      if (conn.readyState === conn.OPEN) conn.send(JSON.stringify({ type: 'history', events }));
    });
  });

  return {
    app,
    runner,
    dataDir,
    port,
    url: `http://${host}:${port}`,
    wss,
    async close() {
      wss.close();
      await app.close();
    },
  };
}
