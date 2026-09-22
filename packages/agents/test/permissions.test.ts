import { describe, expect, it } from 'vitest';
import { PERMISSION_PROFILES, flagsForProfile, resolveRunPermissions } from '../src/permissions.js';

describe('统一权限档位映射（ADR-010）', () => {
  it('映射表与官方文档一致（docs/research/04）', () => {
    expect(flagsForProfile('claude', 'safe')).toEqual([]);
    expect(flagsForProfile('claude', 'developer')).toEqual([
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Read,Edit,Write,Glob,Grep,Bash',
    ]);
    expect(flagsForProfile('claude', 'full')).toEqual(['--permission-mode', 'bypassPermissions']);
    expect(flagsForProfile('codex', 'developer')).toEqual(['--sandbox', 'workspace-write']);
    expect(flagsForProfile('codex', 'full')).toEqual(['--sandbox', 'danger-full-access']);
    expect(flagsForProfile('gemini', 'developer')).toEqual(['--approval-mode', 'auto_edit']);
    expect(flagsForProfile('gemini', 'full')).toEqual(['--approval-mode', 'yolo']);
    // OpenCode 无对应 flag：如实为空（run 默认在工作区执行）
    expect(flagsForProfile('opencode', 'developer')).toEqual([]);
  });

  it('未收录的 agent 绝不猜测 flag（返回空）', () => {
    expect(flagsForProfile('custom-plugin-agent', 'developer')).toEqual([]);
    expect(flagsForProfile('custom-plugin-agent', 'full')).toEqual([]);
  });

  it('优先级：显式 permissionFlags > profile > safe', () => {
    expect(resolveRunPermissions('claude', { permissionFlags: ['--permission-mode', 'plan'], profile: 'developer' })).toEqual(['--permission-mode', 'plan']);
    expect(resolveRunPermissions('claude', { profile: 'developer' })).toEqual(flagsForProfile('claude', 'developer'));
    expect(resolveRunPermissions('claude', {})).toBeUndefined();
    expect(resolveRunPermissions('opencode', { profile: 'developer' })).toBeUndefined(); // 空 → undefined（不追加）
  });

  it('档位枚举完整', () => {
    expect(PERMISSION_PROFILES).toEqual(['safe', 'developer', 'full']);
  });
});
