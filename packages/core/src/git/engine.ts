import path from 'node:path';
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
    // 幂等：同 taskId+agentId 重跑时先清掉残留 worktree（该目录完全归 AgentOS 所有）
    if (fs.existsSync(wtPath)) {
      try {
        await g.raw(['worktree', 'remove', '--force', wtPath]);
      } catch {
        // 未注册的目录：直接删
      }
      fs.rmSync(wtPath, { recursive: true, force: true });
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
    const nameStatus = await g.raw(['diff', '--name-status', baseRef]);
    const files: ChangedFile[] = [];
    for (const line of nameStatus.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const [status, ...rest] = t.split('\t');
      const kind = (status?.[0] ?? 'M') as string;
      const map: Record<string, FileChangeKind> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' };
      files.push({ path: rest.join('\t'), change: map[kind] ?? 'modified' });
    }
    let stat = '';
    try {
      stat = await g.raw(['diff', '--stat', baseRef]);
    } catch {
      stat = '';
    }
    return { files, stat };
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
