import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAgentOSServer, type AgentOSServer } from '../src/index.js';
import { StubAdapter } from '@agentos/agents';

let server: AgentOSServer;
let repo: string;
let taskId: string;
let worktree: string;
const get = (file?: string) => server.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/diff${file === undefined ? '' : '?file=' + encodeURIComponent(file)}` });

beforeAll(async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agentos-diff-review-'));
  repo = path.join(root, 'repo');
  mkdirSync(repo);
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig('user.name', 'agentos-test');
  await g.addConfig('user.email', 'test@agentos.local');
  writeFileSync(path.join(repo, 'README.md'), 'before\n');
  writeFileSync(path.join(repo, '旧 文件.txt'), 'rename content\n');
  writeFileSync(path.join(repo, 'binary.dat'), Buffer.from([0, 1, 2]));
  await g.add('.');
  await g.commit('baseline');
  server = await createAgentOSServer({ dataDir: path.join(root, 'data'), adapters: [new StubAdapter('claude', {})], scan: async () => [] });
  const task = await server.runner.createTask({ repoRoot: repo, objective: 'review actual changes' });
  taskId = task.id;
  worktree = (await server.runner.runTask(taskId, { agentId: 'claude' })).worktreePath!;
  const wg = simpleGit(worktree);
  await wg.mv('旧 文件.txt', '新 文件.txt');
  writeFileSync(path.join(worktree, 'report[1].txt'), 'literal selected file\n');
  writeFileSync(path.join(worktree, 'report1.txt'), 'must not be in selected patch\n');
  writeFileSync(path.join(worktree, 'binary.dat'), Buffer.from([0, 3, 4]));
  writeFileSync(path.join(worktree, 'large.txt'), 'large line'.repeat(70_000));
  await wg.add('.');
  writeFileSync(path.join(worktree, 'README.md'), 'after <script>not HTML</script>\n');
});
afterAll(async () => { await server?.app.close(); });

describe('real Git review API (Stub only creates the task)', () => {
  it('returns actual unstaged line changes without touching the main checkout', async () => {
    const res = await get('README.md');
    expect(res.statusCode).toBe(200);
    expect(res.json().patch).toContain('-before');
    expect(res.json().patch).toContain('+after <script>not HTML</script>');
    expect(res.json().limited).toBe(false);
    expect(readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe('before\n');
  });
  it('preserves rename source and destination in the summary and patch', async () => {
    expect((await get()).json().files).toContainEqual({ path: '新 文件.txt', previousPath: '旧 文件.txt', change: 'renamed' });
    const res = await get('新 文件.txt');
    expect(res.statusCode).toBe(200);
    expect(res.json().patch).toContain('rename from');
    expect(res.json().patch).toContain('rename to');
  });
  it('treats special path characters literally and rejects unlisted paths', async () => {
    const selected = (await get('report[1].txt')).json();
    expect(selected.patch).toContain('literal selected file');
    expect(selected.patch).not.toContain('must not be in selected patch');
    for (const invalid of ['../outside.txt', ':(glob)**', repo, 'unknown.txt', '']) {
      expect((await get(invalid)).statusCode).toBe(400);
    }
  });
  it('reports binary and oversized patches explicitly', async () => {
    const binary = (await get('binary.dat')).json();
    expect(binary.binary).toBe(true);
    const large = (await get('large.txt')).json();
    expect(large.limited).toBe(true);
    expect(large.patch).toBe('');
    expect(large.note).toBeTruthy();
  });
  it('never executes configured external diff or text conversion commands', async () => {
    const g = simpleGit(worktree);
    execFileSync('git', ['config', '--local', 'diff.external', 'agentos-should-never-execute-this'], { cwd: worktree, windowsHide: true });
    execFileSync('git', ['config', '--local', 'diff.agentos.textconv', 'agentos-should-never-execute-this'], { cwd: worktree, windowsHide: true });
    writeFileSync(path.join(worktree, '.gitattributes'), 'README.md diff=agentos\n');
    try {
      const res = await get('README.md');
      expect(res.statusCode).toBe(200);
      expect(res.json().patch).toContain('-before');
    } finally {
      execFileSync('git', ['config', '--local', '--unset', 'diff.external'], { cwd: worktree, windowsHide: true });
      execFileSync('git', ['config', '--local', '--unset', 'diff.agentos.textconv'], { cwd: worktree, windowsHide: true });
    }
  });
  it('rejects a replaced current workspace instead of showing another branch', async () => {
    const task = await server.runner.createTask({ repoRoot: repo, objective: 'protect review ownership' });
    const run = await server.runner.runTask(task.id, { agentId: 'claude' });
    await simpleGit(run.worktreePath!).checkoutLocalBranch('user-owned-review-test');
    const res = await server.app.inject({ method: 'GET', url: `/api/tasks/${task.id}/diff` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('worktree');
  });
});
