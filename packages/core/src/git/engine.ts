import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { ChangedFile, FileChangeKind } from '../types.js';

/**
 * Git Workspace Engine（ADR-007）：
 * 每个并行 agent 一个独立 worktree，位于仓库外兄弟目录 `.agentos-worktrees/<repoName>/`。
 */

export interface WorktreeRef {
  path: string;
  branch: string;
  baseCommit: string;
}

export interface DiffSummary {
  files: ChangedFile[];
  stat: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
}

function git(root: string): SimpleGit {
  return simpleGit({ baseDir: root });
}

export function sanitizeRefPart(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

export function defaultWorktreesDir(repoRoot: string): string {
  return path.join(path.dirname(repoRoot), '.agentos-worktrees', sanitizeRefPart(path.basename(repoRoot)));
}

export class GitError extends Error {
  constructor(message: string, public readonly stderr?: string) {
    super(message);
    this.name = 'GitError';
  }
}

export class GitEngine {
  async isRepo(root: string): Promise<boolean> {
    try {
      return await git(root).checkIsRepo();
    } catch {
      return false;
    }
  }

  async currentBranch(root: string): Promise<string> {
    const s = await git(root).status();
    return s.current ?? 'HEAD';
  }

  async revParse(root: string, ref = 'HEAD'): Promise<string> {
    return (await git(root).revparse([ref])).trim();
  }

  /**
   * 创建 worktree + 独立分支。baseRef 缺省为当前 HEAD。
   * 分支已存在时改为直接 checkout 该分支（幂等重跑）。
   */
  async createWorktree(
    repoRoot: string,
    opts: { taskId: string; agentId: string; baseRef?: string; worktreesDir?: string },
  ): Promise<WorktreeRef> {
    if (!(await this.isRepo(repoRoot))) {
      throw new GitError(`不是 git 仓库: ${repoRoot}`);
    }
    const baseCommit = await this.revParse(repoRoot, opts.baseRef ?? 'HEAD');
    const branch = `agentos/${sanitizeRefPart(opts.taskId)}/${sanitizeRefPart(opts.agentId)}`;
    const dir = opts.worktreesDir ?? defaultWorktreesDir(repoRoot);
    const wtPath = path.join(dir, `${sanitizeRefPart(opts.taskId)}-${sanitizeRefPart(opts.agentId)}`);
    fs.mkdirSync(dir, { recursive: true });
    const g = git(repoRoot);
    // Recovery must never discard the index, working files, or untracked output.
    if (fs.existsSync(wtPath)) {
      await this.assertWorktree(repoRoot, wtPath, branch);
      return { path: wtPath, branch, baseCommit };
    }
    try {
      await g.raw(['worktree', 'add', '-b', branch, wtPath, baseCommit]);
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      if (/already exists/i.test(msg)) {
        // 分支已存在：直接用该分支建 worktree
        await g.raw(['worktree', 'add', wtPath, branch]);
      } else {
        throw new GitError(`创建 worktree 失败: ${msg}`, msg);
      }
    }
    return { path: wtPath, branch, baseCommit };
  }

  /** Refuse moved/replaced workspaces before staging files or launching an Agent. */
  async assertWorktree(repoRoot: string, wtPath: string, branch: string): Promise<void> {
    if (!fs.existsSync(wtPath)) throw new GitError('任务 worktree 不存在，已停止操作: ' + wtPath);
    const realDestination = fs.realpathSync(wtPath);
    const registered = (await this.listWorktrees(repoRoot)).find(entry =>
      fs.existsSync(entry.path) && fs.realpathSync(entry.path) === realDestination,
    );
    if (realDestination === fs.realpathSync(repoRoot) || !registered || registered.branch !== branch ||
        await this.currentBranch(wtPath) !== branch) {
      throw new GitError('已有目录不是预期的 worktree，已保留所有文件: ' + wtPath);
    }
  }

  async listWorktrees(repoRoot: string): Promise<Array<{ path: string; branch?: string; head: string }>> {
    const out = await git(repoRoot).raw(['worktree', 'list', '--porcelain']);
    const result: Array<{ path: string; branch?: string; head: string }> = [];
    let cur: { path: string; branch?: string; head: string } | undefined;
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (cur) result.push(cur);
        cur = { path: line.slice('worktree '.length), head: '' };
      } else if (line.startsWith('HEAD ')) {
        if (cur) cur.head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        if (cur) cur.branch = line.slice('branch '.length).replace('refs/heads/', '');
      }
    }
    if (cur) result.push(cur);
    return result;
  }

  async removeWorktree(repoRoot: string, wtPath: string, force = true): Promise<void> {
    const args = ['worktree', 'remove', wtPath];
    if (force) args.push('--force');
    await git(repoRoot).raw(args);
  }

  /** 把 worktree 内所有变更提交为 checkpoint（无变更则跳过）。 */
  async checkpoint(wtRoot: string, label: string): Promise<{ committed: boolean; hash?: string }> {
    const g = git(wtRoot);
    if ((await g.status()).conflicted.length) {
      throw new GitError('worktree 存在未解决的 Git 冲突，已保留索引与文件；请解决冲突后重试。');
    }
    await g.add('-A');
    const status = await g.status();
    const dirty =
      status.created.length + status.modified.length + status.deleted.length + status.renamed.length + status.staged.length > 0;
    if (!dirty) return { committed: false };
    const res = await g.commit(`agentos: checkpoint ${label}`);
    return { committed: true, hash: res.commit };
  }

  async diffAgainstBase(wtRoot: string, baseRef: string): Promise<DiffSummary> {
    const g = git(wtRoot);
    // NUL delimiters preserve literal paths regardless of core.quotepath or whitespace.
    const nameStatus = await g.raw(['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', baseRef, '--']);
    const records = nameStatus.split('\0');
    const files: ChangedFile[] = [];
    const changes: Record<string, FileChangeKind> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added' };
    for (let i = 0; i < records.length && records[i];) {
      const kind = records[i++]![0]!;
      // Rename/copy records contain source then destination; ChangedFile.path identifies the result.
      const previousPath = kind === 'R' || kind === 'C' ? records[i++] : undefined;
      const filePath = records[i++];
      if (!filePath) throw new GitError('Git diff returned an incomplete file record');
      files.push({ path: filePath, change: changes[kind] ?? 'modified', ...(previousPath ? { previousPath } : {}) });
    }
    let stat = '';
    try {
      stat = await g.raw(['diff', '--no-ext-diff', '--no-textconv', '--stat', baseRef, '--']);
    } catch {
      stat = '';
    }
    return { files, stat };
  }

  /** Read a single changed file as a bounded patch; never invoke repository diff helpers. */
  async filePatch(wtRoot: string, baseRef: string, filePath: string): Promise<{
    patch: string; limited: boolean; binary: boolean; note?: string;
  }> {
    if (!filePath || filePath.includes('\0') || filePath.length > 4096) throw new GitError('无效的文件路径');
    const summary = await this.diffAgainstBase(wtRoot, baseRef);
    const file = summary.files.find(entry => entry.path === filePath);
    if (!file) throw new GitError('该文件不在当前任务变更清单中，请刷新后重试');
    const paths = file.previousPath ? [file.previousPath, file.path] : [file.path];
    try {
      const { stdout } = await promisify(execFile)('git', [
        '--no-pager', '--literal-pathspecs', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false',
        'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', baseRef, '--', ...paths,
      ], { cwd: wtRoot, windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 512 * 1024 });
      return { patch: stdout, limited: false, binary: /^Binary files |^GIT binary patch/m.test(stdout) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        return { patch: '', limited: true, binary: false, note: '该文件差异超过 512 KiB，未加载正文。请在任务工作区使用本地 Git 工具审查。' };
      }
      throw new GitError('无法读取文件差异，请检查任务工作区后重试', String(error));
    }
  }

  async commitsBetween(wtRoot: string, baseRef: string): Promise<CommitInfo[]> {
    const g = git(wtRoot);
    try {
      const log = await g.log({ from: baseRef, to: 'HEAD' });
      return log.all.map((l) => ({ hash: l.hash.slice(0, 8), message: l.message }));
    } catch {
      return [];
    }
  }
}
