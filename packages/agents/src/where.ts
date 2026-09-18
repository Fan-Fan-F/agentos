import fs from 'node:fs';
import path from 'node:path';
import { spawnCapture } from './spawn.js';

const WIN_EXTS = ['', '.exe', '.cmd', '.bat', '.ps1'];
const UNIX_EXTS = [''];

/** 在 PATH 中查找可执行文件（只读 stat，不执行）。 */
export function findInPath(name: string, pathEnv?: string): string[] {
  const dirs = (pathEnv ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? WIN_EXTS : UNIX_EXTS;
  const found: string[] = [];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        if (fs.statSync(p).isFile()) {
          found.push(p);
          break;
        }
      } catch {
        // 不存在，继续
      }
    }
  }
  return found;
}

export async function getNpmGlobalRoot(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  try {
    const res = await spawnCapture('npm', ['root', '-g'], { timeoutMs: 8000, env });
    const root = res.stdout.trim();
    return res.exitCode === 0 && root ? root : null;
  } catch {
    return null;
  }
}

/** 版本探测需要执行 agent 二进制 —— 只在用户显式触发（probe=true）时调用（ADR-006）。 */
export async function probeVersion(binary: string, timeoutMs = 8000): Promise<string | undefined> {
  try {
    const res = await spawnCapture(binary, ['--version'], { timeoutMs });
    const text = `${res.stdout}\n${res.stderr}`;
    const m = text.match(/v?(\d+\.[\w.+-]+)/);
    return m?.[1];
  } catch {
    return undefined;
  }
}
