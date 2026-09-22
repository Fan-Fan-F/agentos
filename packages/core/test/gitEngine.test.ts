import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { beforeEach, describe, expect, it } from 'vitest';
import { GitEngine, defaultWorktreesDir, sanitizeRefPart } from '../src/git/engine.js';

let repoRoot = '';
const engine = new GitEngine();

beforeEach(async () => {
  // 真实临时 git 仓库（TESTING.md：Git 集成测试用真仓库，不 mock）
  repoRoot = path.join(mkdtempSync(path.join(tmpdir(), 'agentos-git-')), 'repo');
  mkdirSync(repoRoot, { recursive: true });
  const g = simpleGit(repoRoot);
  await g.init();
  await g.addConfig('user.name', 'agentos-test');
  await g.addConfig('user.email', 'test@agentos.local');
  writeFileSync(path.join(repoRoot, 'README.md'), '# demo\n');
  await g.add('.');
  await g.commit('init');
});

async function commitIn(dir: string, file: string, content: string, msg: string) {
  writeFileSync(path.join(dir, file), content);
  const g = simpleGit(dir);
  await g.add('.');
  await g.commit(msg);
}

describe('GitEngine（Git Workspace Engine）', () => {
  it('refuses to checkpoint an unresolved merge without changing its index', async () => {
    const wt = await engine.createWorktree(repoRoot, { taskId: 'conflict', agentId: 'claude' });
    const g = simpleGit(wt.path);
    await g.checkoutLocalBranch('conflicting-change');
    await commitIn(wt.path, 'README.md', 'side version\n', 'side');
    await g.checkout(wt.branch);
    await commitIn(wt.path, 'README.md', 'task version\n', 'task');
    await expect(g.merge(['conflicting-change'])).rejects.toThrow();
    const head = await g.revparse(['HEAD']);
    const index = await g.raw(['ls-files', '--unmerged']);
    const content = readFileSync(path.join(wt.path, 'README.md'), 'utf8');
    expect(index.length).toBeGreaterThan(0);
    await expect(engine.checkpoint(wt.path, 'must not resolve conflicts')).rejects.toThrow(/冲突/);
    expect(await g.revparse(['HEAD'])).toBe(head);
    expect(await g.raw(['ls-files', '--unmerged'])).toBe(index);
    expect(readFileSync(path.join(wt.path, 'README.md'), 'utf8')).toBe(content);
  });


  it('diff preserves literal Unicode paths and returns rename destinations', async () => {
    const wt = await engine.createWorktree(repoRoot, { taskId: 'unicode', agentId: 'claude' });
    const g = simpleGit(wt.path);
    // Exercise Git's default quoted-path output without changing any global configuration.
    await g.addConfig('core.quotepath', 'true');
    await g.addConfig('diff.renames', 'true');
    await commitIn(wt.path, '旧 文件.txt', 'rename this exact content\n', 'old file');
    const base = await engine.revParse(wt.path);
    await g.mv('旧 文件.txt', '新 文件.txt');
    await commitIn(wt.path, '新增 文件.txt', 'another file\n', 'rename and add');
    writeFileSync(path.join(wt.path, 'README.md'), 'updated\n');
    const diff = await engine.diffAgainstBase(wt.path, base);
    expect(diff.files).toEqual(expect.arrayContaining([
      { path: '新 文件.txt', previousPath: '旧 文件.txt', change: 'renamed' },
      { path: '新增 文件.txt', change: 'added' },
      { path: 'README.md', change: 'modified' },
    ]));
    expect(diff.files).toHaveLength(3);
    expect(readFileSync(path.join(repoRoot, 'README.md'), 'utf8')).toBe('# demo\n');
  });

  it('非 git 目录被拒绝', async () => {
    const notRepo = mkdtempSync(path.join(tmpdir(), 'agentos-nogit-'));
    await expect(engine.isRepo(notRepo)).resolves.toBe(false);
    await expect(
      engine.createWorktree(notRepo, { taskId: 't', agentId: 'claude' }),
    ).rejects.toThrow(/不是 git 仓库/);
  });

  it('createWorktree：独立分支 + 仓库外兄弟目录 + diff/checkpoint/commits 全链路', async () => {
    const base = await engine.revParse(repoRoot, 'HEAD');
    const wt = await engine.createWorktree(repoRoot, { taskId: 'task 01', agentId: 'Claude' });

    expect(wt.branch).toBe('agentos/task-01/claude');
    expect(wt.baseCommit).toBe(base);
    // ADR-007：worktree 在仓库外兄弟目录
    expect(defaultWorktreesDir(repoRoot)).toBe(path.join(path.dirname(repoRoot), '.agentos-worktrees', 'repo'));
    expect(wt.path.startsWith(path.join(repoRoot, '..'))).toBe(true);

    // 在 worktree 里改文件并 checkpoint
    await commitIn(wt.path, 'feature.txt', 'hello\n', 'add feature');
    const cp = await engine.checkpoint(wt.path, 'test');
    expect(cp.committed).toBe(false); // 刚提交过，无变更

    await commitIn(wt.path, 'feature2.txt', 'world\n', 'add feature2');
    const diff = await engine.diffAgainstBase(wt.path, base);
    const names = diff.files.map((f) => f.path).sort();
    expect(names).toEqual(['feature.txt', 'feature2.txt']);
    expect(diff.stat).toContain('feature.txt');

    const commits = await engine.commitsBetween(wt.path, base);
    expect(commits.map((c) => c.message)).toEqual(['add feature2', 'add feature']);

    const list = await engine.listWorktrees(repoRoot);
    expect(list.length).toBe(2); // 主 + 1
    expect(list.some((w) => w.branch === 'agentos/task-01/claude')).toBe(true);

    await engine.removeWorktree(repoRoot, wt.path);
    expect((await engine.listWorktrees(repoRoot)).length).toBe(1);
  });

  it('同名分支重跑幂等（分支已存在 → 直接 checkout）', async () => {
    const w1 = await engine.createWorktree(repoRoot, { taskId: 't', agentId: 'codex' });
    await engine.removeWorktree(repoRoot, w1.path, true);
    const w2 = await engine.createWorktree(repoRoot, { taskId: 't', agentId: 'codex' });
    expect(w2.branch).toBe(w1.branch);
    await engine.removeWorktree(repoRoot, w2.path, true);
  });

  it('reopening a worktree preserves staged, unstaged and untracked crash output', async () => {
    const first = await engine.createWorktree(repoRoot, { taskId: 'crash', agentId: 'codex' });
    writeFileSync(path.join(first.path, 'README.md'), 'staged work\n');
    await simpleGit(first.path).add('README.md');
    writeFileSync(path.join(first.path, 'README.md'), 'unstaged work\n');
    writeFileSync(path.join(first.path, 'draft.txt'), 'untracked work\n');
    const reopened = await engine.createWorktree(repoRoot, { taskId: 'crash', agentId: 'codex' });
    expect(reopened.path).toBe(first.path);
    expect(readFileSync(path.join(first.path, 'README.md'), 'utf8')).toBe('unstaged work\n');
    expect(readFileSync(path.join(first.path, 'draft.txt'), 'utf8')).toBe('untracked work\n');
    expect(await simpleGit(first.path).show([':README.md'])).toBe('staged work\n');
  });

  it('refuses an unregistered destination without deleting its contents', async () => {
    const destination = path.join(defaultWorktreesDir(repoRoot), 'collision-codex');
    mkdirSync(destination, { recursive: true });
    writeFileSync(path.join(destination, 'keep.txt'), 'user data');
    await expect(engine.createWorktree(repoRoot, { taskId: 'collision', agentId: 'codex' })).rejects.toThrow(/worktree/);
    expect(readFileSync(path.join(destination, 'keep.txt'), 'utf8')).toBe('user data');
  });

  it.skipIf(process.platform !== 'win32')('recognizes Windows path aliases without accepting the main checkout', async () => {
    const wt = await engine.createWorktree(repoRoot, { taskId: 'path-alias', agentId: 'codex' });
    writeFileSync(path.join(wt.path, 'draft.txt'), 'keep uncommitted output\n');
    // Windows resolves these spellings to the same directory; string equality does not.
    await expect(engine.assertWorktree(repoRoot, wt.path.toUpperCase(), wt.branch)).resolves.toBeUndefined();
    await expect(engine.assertWorktree(repoRoot, repoRoot.toUpperCase(), await engine.currentBranch(repoRoot)))
      .rejects.toThrow(/worktree/);
    expect(readFileSync(path.join(wt.path, 'draft.txt'), 'utf8')).toBe('keep uncommitted output\n');
    expect(readFileSync(path.join(repoRoot, 'README.md'), 'utf8')).toBe('# demo\n');
  });
  it('sanitizeRefPart 输出安全引用名', () => {
    expect(sanitizeRefPart('任务 测试/01')).toMatch(/^[a-z0-9._-]+$/);
  });
});
