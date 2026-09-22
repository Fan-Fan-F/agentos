import { spawn } from 'node:child_process';

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface SpawnCaptureOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 写入子进程 stdin 并关闭（提示词通道，避免命令行长度/转义问题） */
  stdin?: string;
  /** 每行 stdout 回调（用于流式解析 JSONL） */
  onLine?: (line: string) => void;
}

function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      killer.once('error', () => child.kill());
      killer.once('exit', code => { if (code !== 0 && child.exitCode === null && child.signalCode === null) child.kill(); });
    } catch {
      child.kill();
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/** 无头子进程捕获（MVP 不用 PTY，见 ADR-003）。超时/中止时杀整棵进程树。 */
export function spawnCapture(cmd: string, args: string[], opts: SpawnCaptureOptions = {}): Promise<SpawnResult> {
  if (opts.signal?.aborted) {
    return Promise.resolve({ stdout: '', stderr: '', exitCode: null, timedOut: true });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      windowsHide: true,
      shell: false,
      // POSIX kill(-pid) must target a process group created for this child.
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let stdoutRest = '';
    let timedOut = false;
    const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const onAbort = () => {
      timedOut = true;
      killTree(child);
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    if (typeof opts.stdin === 'string') {
      child.stdin?.on('error', () => {
        /* 子进程提前退出导致 EPIPE：忽略 */
      });
      child.stdin?.end(opts.stdin);
    } else {
      // 不写 stdin 也必须关闭，避免等 stdin 的 CLI（codex exec）挂起
      child.stdin?.end();
    }
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      stdoutRest += chunk;
      const lines = stdoutRest.split('\n');
      stdoutRest = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (t) opts.onLine?.(t);
      }
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      const tail = stdoutRest.trim();
      if (tail) opts.onLine?.(tail);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}
