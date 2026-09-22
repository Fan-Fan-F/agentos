import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

function hasCode(error: unknown, ...codes: string[]): boolean {
  return codes.includes((error as NodeJS.ErrnoException).code ?? '');
}

async function removeOwnEntry(directory: string, entry: string): Promise<void> {
  // Never recursively remove a lock: another contender may already own it.
  try { await fs.unlink(path.join(directory, entry)); }
  catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
  try { await fs.rmdir(directory); }
  catch (error) { if (!hasCode(error, 'ENOENT', 'ENOTEMPTY', 'EEXIST')) throw error; }
}

/** Local filesystem ownership. A published lock is always a populated directory. */
export async function acquireDataDirectoryLock(dataDir: string): Promise<() => Promise<void>> {
  await fs.mkdir(dataDir, { recursive: true });
  const root = await fs.realpath(dataDir);
  const lock = path.join(root, '.server.lock');
  const token = randomUUID();
  const entry = `${token}.json`;
  const staging = path.join(root, `.server-lock-${token}`);
  await fs.mkdir(staging);
  let published = false;
  try {
    await fs.writeFile(path.join(staging, entry), JSON.stringify({ pid: process.pid, hostname: os.hostname() }), { flag: 'wx' });
    for (let attempt = 0; attempt < 16; attempt++) {
      try {
        // Atomic publication avoids the empty mkdir / owner-file-write crash window.
        // An existing nonempty directory cannot be replaced by rename.
        await fs.rename(staging, lock);
        published = true;
        let released = false;
        return async () => {
          if (released) return;
          await removeOwnEntry(lock, entry);
          released = true;
        };
      } catch (error) {
        if (!hasCode(error, 'EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES')) throw error;
      }

      try {
        const stat = await fs.lstat(lock);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('服务锁不是普通目录，拒绝自动修改');
        const entries = await fs.readdir(lock);
        if (entries.length === 0) {
          // Only an empty directory can be removed; a newly published owner is safe.
          try { await fs.rmdir(lock); }
          catch (error) { if (!hasCode(error, 'ENOENT', 'ENOTEMPTY', 'EEXIST')) throw error; }
          continue;
        }
        if (entries.length !== 1 || !/^[a-f0-9-]{36}\.json$/.test(entries[0]!)) {
          throw new Error('服务锁内容无法确认，拒绝自动修改');
        }
        const oldEntry = entries[0]!;
        const owner = JSON.parse(await fs.readFile(path.join(lock, oldEntry), 'utf8')) as { pid?: number; hostname?: string };
        if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0 || owner.hostname !== os.hostname()) {
          throw new Error('服务锁所有者无法确认，拒绝自动修改');
        }
        let alive = true;
        try { process.kill(owner.pid!, 0); } // Existence check only; sends no signal.
        catch (error) { if (hasCode(error, 'ESRCH')) alive = false; else throw error; }
        if (alive) throw new Error(`数据目录已由另一个服务占用 (PID ${owner.pid}): ${root}`);
        // The UUID is essential: concurrent stale-lock cleanup cannot unlink a new owner.
        await removeOwnEntry(lock, oldEntry);
      } catch (error) {
        if (hasCode(error, 'ENOENT')) continue; // Another contender completed cleanup.
        throw error;
      }
    }
    throw new Error(`数据目录锁竞争未完成，请重试: ${root}`);
  } finally {
    if (!published) await removeOwnEntry(staging, entry);
  }
}
