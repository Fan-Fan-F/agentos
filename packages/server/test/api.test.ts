import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAgentOSServer, type AgentOSServer } from '../src/index.js';
import { StubAdapter } from '@agentos/agents';
import type { DiscoveredAgent } from '@agentos/core';

let server: AgentOSServer;
let repoRoot = '';
let dataDir = '';

const fakeScan = async (): Promise<DiscoveredAgent[]> => [
  {
    id: 'claude',
    name: 'Claude Code',
    status: 'installed',
    binaries: ['C:/fake/claude.cmd'],
    version: '1.2.3',
    installSource: 'npm',
    npmPackage: '@anthropic-ai/claude-code',
    auth: 'ok',
    protocols: ['cli', 'acp'],
    capabilities: { headless: true, resume: true, jsonStream: true, mcp: true, hooks: true },
    homeMarkersFound: ['.claude.json'],
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    status: 'not-installed',
    binaries: [],
    npmPackage: '@openai/codex',
    auth: 'unknown',
    protocols: ['cli'],
    capabilities: { headless: true, resume: true, jsonStream: true, mcp: true, hooks: false },
    homeMarkersFound: [],
  },
];

beforeAll(async () => {
  repoRoot = path.join(mkdtempSync(path.join(tmpdir(), 'agentos-api-')), 'repo');
  dataDir = mkdtempSync(path.join(tmpdir(), 'agentos-apihome-'));
  mkdirSync(repoRoot, { recursive: true });
  const g = simpleGit(repoRoot);
  await g.init();
  await g.addConfig('user.name', 'agentos-test');
  await g.addConfig('user.email', 'test@agentos.local');
  writeFileSync(path.join(repoRoot, 'README.md'), '# demo\n');
  await g.add('.');
  await g.commit('init');

  server = await createAgentOSServer({
    dataDir,
    adapters: [
      new StubAdapter('claude', () => ({
        events: [{ type: 'message', data: { text: 'claude 运行' } }],
        finalMessage: 'claude 完成了工作：实现 X。剩余：测试。',
        sessionRef: 'claude-s1',
      })),
      new StubAdapter('codex', (_p, resumed) => ({
        events: [],
        finalMessage: resumed ? '1.实现X 2.主体完成 3.无否决 4.src/x.ts 5.通过 6.无 7.收尾' : 'codex 接管完成。',
        sessionRef: 'codex-s1',
      })),
    ],
    scan: fakeScan,
  });
  await server.app.ready();
});

afterAll(async () => {
  await server.app.close();
});

describe('AgentOS REST API', () => {
  it('GET /api/health', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, name: 'agentos' });
  });

  it('GET /api/agents（注入的只读扫描）', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(200);
    const agents = res.json() as DiscoveredAgent[];
    expect(agents).toHaveLength(2);
    expect(agents[0]!.status).toBe('installed');
  });

  it('项目登记：非 git 目录 400，git 目录 201', async () => {
    const bad = await server.app.inject({ method: 'POST', url: '/api/projects', payload: { path: dataDir } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/git 仓库/);

    const good = await server.app.inject({ method: 'POST', url: '/api/projects', payload: { path: repoRoot } });
    expect(good.statusCode).toBe(201);
    expect(good.json()).toMatchObject({ name: 'repo' });
  });

  it('任务全流程：创建 → 运行 → capsule → swap → events → diff', async () => {
    const projects = await server.app.inject({ method: 'GET', url: '/api/projects' });
    const projectId = (projects.json() as Array<{ id: string }>)[0]!.id;

    const created = await server.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { projectId, objective: '实现 X 功能', constraints: ['不加依赖'] },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id as string;

    // 缺 objective 400
    const bad = await server.app.inject({ method: 'POST', url: '/api/tasks', payload: { projectId } });
    expect(bad.statusCode).toBe(400);

    const run = await server.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/run`, payload: { agentId: 'claude' } });
    expect(run.statusCode).toBe(200);
    const runBody = run.json() as { run: { exitCode: number }; capsule?: { id: string }; diffFiles: number };
    expect(runBody.run.exitCode).toBe(0);
    expect(runBody.capsule).toBeDefined();

    const capsule = await server.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/capsule` });
    expect(capsule.statusCode).toBe(200);
    expect(capsule.json().task.objective).toBe('实现 X 功能');

    const capsuleMd = await server.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/capsule?format=md` });
    expect(capsuleMd.body).toContain('# Session Capsule');
    expect(capsuleMd.headers['content-type']).toContain('text/markdown');

    const swap = await server.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/swap`, payload: { toAgentId: 'codex' } });
    expect(swap.statusCode).toBe(200);
    const swapBody = swap.json() as { capsule?: { origin: { resumedFromCapsuleId?: string } } };
    expect(swapBody.capsule!.origin.resumedFromCapsuleId).toBe(runBody.capsule!.id);

    const events = await server.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/events` });
    const eventTypes = (events.json() as Array<{ type: string }>).map((e) => e.type);
    expect(eventTypes).toContain('handoff.created');
    expect(eventTypes).toContain('agent.replied'); // 七问探针回答

    const diff = await server.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/diff` });
    expect(diff.statusCode).toBe(200);
    expect(diff.json()).toHaveProperty('files');

    const taskView = await server.app.inject({ method: 'GET', url: `/api/tasks/${taskId}` });
    expect(taskView.statusCode).toBe(200);
    expect(taskView.json().task.status).toBe('done');
  });

  it('ask / fork / resume / 进度更新 / 安装计划 dry-run', async () => {
    const tasks = await server.app.inject({ method: 'GET', url: '/api/tasks' });
    const taskId = (tasks.json() as Array<{ id: string }>)[0]!.id;

    const progress = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/progress`,
      payload: { completed: ['A'], remaining: ['B'] },
    });
    expect(progress.statusCode).toBe(200);

    const ask = await server.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/ask`, payload: { toAgentId: 'claude', question: '还有风险吗' } });
    expect(ask.statusCode).toBe(200);
    expect((ask.json() as { answer: string }).answer.length).toBeGreaterThan(0);

    const askBad = await server.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/ask`, payload: { toAgentId: 'claude' } });
    expect(askBad.statusCode).toBe(400);

    const fork = await server.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/fork`, payload: { agentIds: ['claude', 'codex'] } });
    expect(fork.statusCode).toBe(200);
    expect((fork.json() as unknown[]).length).toBe(2);

    const installPlan = await server.app.inject({ method: 'POST', url: '/api/agents/codex/install', payload: {} });
    expect(installPlan.statusCode).toBe(200);
    expect(installPlan.json().requiresConfirmation).toBe(true);
    expect((installPlan.json() as { command: string }).command).toContain('npm install');

    const installUnknown = await server.app.inject({ method: 'POST', url: '/api/agents/nope/install', payload: {} });
    expect(installUnknown.statusCode).toBe(404);
  });
});
