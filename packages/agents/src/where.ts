import fs from 'node:fs';
import path from 'node:path';
import { spawnCapture } from './spawn.js';

const WIN_EXTS = ['', '.exe', '.cmd', '.bat', '.ps1'];
const UNIX_EXTS = [''];

function isExecutable(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    if (process.platform === 'win32') return true;
    // POSIX：必须有可执行位（find(1) -perm -111 语义）
    return (fs.statSync(p).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** 在 PATH 中查找可执行文件（只读 stat，不执行）。 */
export function findInPath(name: string, pathEnv?: string): string[] {
  const dirs = (pathEnv ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? WIN_EXTS : UNIX_EXTS;
  const found: string[] = [];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (isExecutable(p)) {
        found.push(p);
        break;
      }
    }
  }
  return found;
}

let npmGlobalRootCache: string | null | undefined;

export function clearNpmGlobalRootCache(): void {
  npmGlobalRootCache = undefined;
}

/**
 * `npm root -g`。注意 Windows 上 npm 是 .cmd shim —— Node ≥20.12 直接 spawn 会 EINVAL
 * （CVE-2024-27980），因此 win32 经 cmd.exe 调起（参数固定无注入面）。
 */
export async function getNpmGlobalRoot(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (npmGlobalRootCache !== undefined) return npmGlobalRootCache;
  try {
    const res =
      process.platform === 'win32'
        ? await spawnCapture('cmd.exe', ['/d', '/s', '/c', 'npm', 'root', '-g'], { timeoutMs: 15000, env })
        : await spawnCapture('npm', ['root', '-g'], { timeoutMs: 15000, env });
    const root = res.stdout.trim();
    npmGlobalRootCache = res.exitCode === 0 && root ? root : null;
  } catch {
    npmGlobalRootCache = null;
  }
  return npmGlobalRootCache;
}

/**
 * 解析 npm 全局包的真实可执行 JS（绕过 .cmd shim）。
 * 返回 `<npm-global>/<pkg>/<bin>` 的绝对路径；找不到返回 null。只读，不执行。
 */
export async function resolveNpmGlobalBin(npmPackage: string): Promise<string | null> {
  const root = await getNpmGlobalRoot();
  if (!root) return null;
  const pkgDir = path.join(root, ...npmPackage.split('/'));
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as {
      bin?: string | Record<string, string>;
      type?: string;
    };
    let binRel: string | undefined;
    if (typeof pkg.bin === 'string') binRel = pkg.bin;
    else if (pkg.bin && typeof pkg.bin === 'object') {
      // 多 bin 包：优先与包名同名者，否则第一个
      const name = npmPackage.split('/').pop()!;
      binRel = pkg.bin[name] ?? Object.values(pkg.bin)[0];
    }
    if (!binRel) return null;
    const binPath = path.join(pkgDir, binRel);
    return fs.existsSync(binPath) ? binPath : null;
  } catch {
    return null;
  }
}

/** 进程启动器：cmd = 可执行文件，prefixArgs = 前置参数（如 node bin.js）。 */
export interface Launcher {
  cmd: string;
  prefixArgs: string[];
  /** 启动方式说明（用于诊断输出） */
  via: 'direct' | 'node' | 'cmd-shim' | 'unresolved';
}

const SHIM_EXTS = ['.cmd', '.bat'];

/** npm 包 bin 目标：.exe/.com 直接执行，否则（.js/.mjs/.cjs）用 node 启动。 */
async function launcherFromNpmBin(npmPackage: string): Promise<Launcher | null> {
  const bin = await resolveNpmGlobalBin(npmPackage);
  if (!bin) return null;
  const ext = path.extname(bin).toLowerCase();
  if (ext === '.exe' || ext === '.com') return { cmd: bin, prefixArgs: [], via: 'direct' };
  return { cmd: process.execPath, prefixArgs: [bin], via: 'node' };
}

/**
 * 把 PATH 上找到的命令解析为可安全 spawn 的启动器。
 *
 * - Windows 的 .cmd/.bat shim：Node ≥20.12 直接 spawn 抛 EINVAL（CVE-2024-27980）。
 *   首选解析 npm 全局包真实入口（原生 .exe 直接执行 / JS 用 `node` 启动；
 *   无 cmd.exe 8K 参数上限、无转义地狱）；兜底经 `cmd.exe /d /s /c`
 *   （仅限无空格参数，提示词一律走 stdin/文件通道）。
 * - POSIX：直接执行（findInPath 已校验可执行位）。
 */
export async function resolveLauncher(binaryName: string, npmPackage?: string, pathEnv?: string): Promise<Launcher | null> {
  const hits = findInPath(binaryName, pathEnv);
  if (!hits.length) return null;
  const hit = hits[0]!;
  const ext = path.extname(hit).toLowerCase();

  if (process.platform !== 'win32') {
    return { cmd: hit, prefixArgs: [], via: 'direct' };
  }
  if (ext === '.exe' || ext === '.com') {
    return { cmd: hit, prefixArgs: [], via: 'direct' };
  }
  if (SHIM_EXTS.includes(ext)) {
    if (npmPackage) {
      const viaBin = await launcherFromNpmBin(npmPackage);
      if (viaBin) return viaBin;
    }
    return { cmd: 'cmd.exe', prefixArgs: ['/d', '/s', '/c', hit], via: 'cmd-shim' };
  }
  // 无扩展名（Git Bash shim 等）：尝试 npm 解析，失败则原样
  if (npmPackage) {
    const viaBin = await launcherFromNpmBin(npmPackage);
    if (viaBin) return viaBin;
  }
  return { cmd: hit, prefixArgs: [], via: 'direct' };
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
