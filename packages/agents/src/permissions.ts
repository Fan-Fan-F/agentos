import type { PermissionProfile } from '@agentos/core';

/**
 * 统一权限档位 → 各 Agent 原生 flag 映射（ADR-010，任务书 §16）。
 * 核心原则：不绕过 Agent 本无法合法获得的权限；full 档即 bypass 类，
 * 由服务端 AGENTOS_ALLOW_BYPASS 门禁统一把关（SECURITY.md）。
 *
 * - safe：      不追加任何 flag，完全尊重各家默认安全档
 * - developer： 允许在**独立 worktree** 内读写文件与执行命令（隔离即第一道防线）
 * - full：      解除沙箱（bypass 类）—— 仅在用户显式解锁后可用
 */

export const PERMISSION_PROFILES: PermissionProfile[] = ['safe', 'developer', 'full'];

const MAPPING: Record<string, Record<Exclude<PermissionProfile, 'safe'>, string[]>> = {
  claude: {
    developer: ['--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Glob,Grep,Bash'],
    full: ['--permission-mode', 'bypassPermissions'],
  },
  codex: {
    developer: ['--sandbox', 'workspace-write'],
    full: ['--sandbox', 'danger-full-access'],
  },
  gemini: {
    developer: ['--approval-mode', 'auto_edit'],
    full: ['--approval-mode', 'yolo'],
  },
  // OpenCode 的 run 默认即在工作区执行，无对应 flag；如实映射为空
  opencode: {
    developer: [],
    full: [],
  },
};

/** 未收录的 agent（stub/自定义插件）：返回 [] 并由调用方决定是否提示 —— 绝不猜测 flag。 */
export function flagsForProfile(agentId: string, profile: PermissionProfile): string[] {
  if (profile === 'safe') return [];
  return [...(MAPPING[agentId]?.[profile] ?? [])];
}

const FLAG_RULES: Record<string, { agent: string; values?: readonly string[] }> = {
  '--sandbox': { agent: 'codex', values: ['read-only', 'workspace-write', 'danger-full-access'] },
  '--permission-mode': { agent: 'claude', values: ['default', 'plan', 'acceptEdits', 'bypassPermissions'] },
  '--approval-mode': { agent: 'gemini', values: ['default', 'auto_edit', 'yolo'] },
  '--allowedTools': { agent: 'claude' },
};

function validToolRule(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
    !value.startsWith('-') && !/[\r\n\0]/.test(value);
}

/** Validate before launching, including calls that do not pass through HTTP. */
export function validatePermissionSelection(
  selection: { profile?: unknown; permissionFlags?: unknown; allowedTools?: unknown },
  agentId?: string,
): void {
  const { profile, permissionFlags, allowedTools } = selection;
  if (profile !== undefined && !PERMISSION_PROFILES.includes(profile as PermissionProfile)) {
    throw new Error('未知权限档位');
  }
  const allowBypass = process.env.AGENTOS_ALLOW_BYPASS === '1';
  if (profile === 'full' && !allowBypass) throw new Error("权限档 'full' 需要显式启用 AGENTOS_ALLOW_BYPASS=1");
  if (allowedTools !== undefined && (!Array.isArray(allowedTools) || allowedTools.length > 64 || !allowedTools.every(validToolRule))) {
    throw new Error('allowedTools 必须为有效工具规则数组');
  }
  if (permissionFlags === undefined) return;
  if (!Array.isArray(permissionFlags) || permissionFlags.length > 32 || permissionFlags.length % 2 !== 0) {
    throw new Error('permissionFlags 必须为权限参数及值组成的数组');
  }
  const seen = new Set<string>();
  for (let i = 0; i < permissionFlags.length; i += 2) {
    const flag = permissionFlags[i];
    const value = permissionFlags[i + 1];
    const rule = typeof flag === 'string' && Object.hasOwn(FLAG_RULES, flag) ? FLAG_RULES[flag] : undefined;
    if (!rule || seen.has(flag) || (agentId && rule.agent !== agentId)) {
      throw new Error(`拒绝未知、重复或不适用的权限参数: ${String(flag)}`);
    }
    seen.add(flag);
    if (!validToolRule(value) || (rule.values && !rule.values.includes(value))) {
      throw new Error(`权限参数值无效: ${flag}`);
    }
    if (!allowBypass && ['danger-full-access', 'bypassPermissions', 'yolo'].includes(value)) {
      throw new Error(`拒绝危险权限参数: ${flag}`);
    }
  }
}

export interface PermissionSelection {
  profile?: PermissionProfile;
  permissionFlags?: string[];
}

/**
 * 解析一次运行的最终权限 flag。
 * 优先级：显式 permissionFlags > profile > safe（空）。
 */
export function resolveRunPermissions(agentId: string, sel: PermissionSelection = {}): string[] | undefined {
  validatePermissionSelection(sel, agentId);
  if (sel.permissionFlags?.length) return [...sel.permissionFlags];
  const profile = sel.profile ?? 'safe';
  const flags = flagsForProfile(agentId, profile);
  return flags.length ? flags : undefined;
}
