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
  return MAPPING[agentId]?.[profile] ?? [];
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
  if (sel.permissionFlags?.length) return sel.permissionFlags;
  const profile = sel.profile ?? 'safe';
  const flags = flagsForProfile(agentId, profile);
  return flags.length ? flags : undefined;
}
