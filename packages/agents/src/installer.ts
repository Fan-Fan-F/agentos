import { catalogEntry } from './catalog.js';
import { spawnCapture } from './spawn.js';

/**
 * Agent 安装中心（任务书 §5）：
 * 只提供官方源的命令预览；真实安装必须由用户显式确认后执行。
 * 绝不从第三方镜像下载二进制。
 */

export interface InstallPlan {
  agentId: string;
  source: 'official npm registry' | 'official installer';
  command: string;
  note: string;
  docsUrl: string;
  requiresConfirmation: true;
}

export function planInstall(agentId: string): InstallPlan | undefined {
  const entry = catalogEntry(agentId);
  if (!entry?.install) return undefined;
  const viaNpm = entry.install.command.includes('npm install');
  return {
    agentId,
    source: viaNpm ? 'official npm registry' : 'official installer',
    command: entry.install.command,
    note: entry.install.note,
    docsUrl: entry.docsUrl,
    requiresConfirmation: true,
  };
}

export interface InstallResult {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

/** 执行安装（调用方必须已向用户展示 plan 并获得确认）。 */
export async function executeInstall(
  plan: InstallPlan,
  opts: { timeoutMs?: number; signal?: AbortSignal; onOutput?: (chunk: string) => void } = {},
): Promise<InstallResult> {
  if (!plan.command.includes('npm install')) {
    throw new Error(`该 agent 需要官方安装器，请在终端手动执行：${plan.command}`);
  }
  // npm 通过 shell 解析（命令含全局安装参数），限制超时
  const isWin = process.platform === 'win32';
  const res = await spawnCapture(isWin ? 'npm.cmd' : 'npm', plan.command.replace(/^npm\s+/, '').split(/\s+/), {
    timeoutMs: opts.timeoutMs ?? 10 * 60_000,
    signal: opts.signal,
  });
  const output = `${res.stdout}\n${res.stderr}`.trim();
  opts.onOutput?.(output);
  return { exitCode: res.exitCode, timedOut: res.timedOut, output };
}
