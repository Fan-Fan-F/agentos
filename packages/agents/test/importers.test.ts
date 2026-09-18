import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claudeSessionToCapsule,
  codexSessionToCapsule,
  listClaudeSessions,
  listCodexSessions,
} from '../src/importers.js';

/**
 * 导入器测试（只读）：自造 fixture JSONL（模拟官方/社区公开的会话文件结构），
 * 不触碰任何真实用户目录。解析必须容错（坏行跳过）。
 */

function writeFixture(dir: string, rel: string, lines: string[]): string {
  const file = path.join(dir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

describe('Claude Code 会话导入（只读）', () => {
  it('listClaudeSessions：发现会话、提取 cwd/首条用户消息/计数、按时间倒序', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agentos-imp-'));
    writeFixture(root, 'D--demo/s-1.jsonl', [
      '{"type":"user","sessionId":"s-1","cwd":"D:/demo","message":{"content":"帮我修复登录超时问题"}}',
      '{"type":"assistant","sessionId":"s-1","message":{"content":[{"type":"text","text":"我检查了 auth.ts 的超时配置"}]}}',
      '{"type":"user","sessionId":"s-1","isSidechain":true,"message":{"content":"子代理消息必须被忽略"}}',
      '{"type":"result","subtype":"success","session_id":"s-1","result":"done"}',
      '这不是 JSON 的坏行',
    ]);
    writeFileSync(path.join(root, 'D--demo', 'notes.txt'), '非 jsonl 忽略');

    const sessions = await listClaudeSessions(root);
    expect(sessions).toHaveLength(1);
    const s = sessions[0]!;
    expect(s.sessionId).toBe('s-1');
    expect(s.cwd).toBe('D:/demo');
    expect(s.preview).toContain('修复登录超时');
    expect(s.messageCount).toBe(2); // 子代理与坏行不计入
  });

  it('claudeSessionToCapsule：objective=首条用户消息，handoff 携带最近回复与来源追踪', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agentos-imp-'));
    const file = writeFixture(root, 'proj/s-2.jsonl', [
      '{"type":"user","sessionId":"s-2","cwd":"D:/demo","message":{"content":"重构导出模块"}}',
      '{"type":"assistant","sessionId":"s-2","message":{"content":[{"type":"text","text":"已完成 CSV 导出主体"}]}}',
    ]);
    const c = await claudeSessionToCapsule(file);
    expect(c.task.objective).toBe('重构导出模块');
    expect(c.origin.agentId).toBe('claude');
    expect(c.origin.sessionId).toBe('s-2');
    expect(c.workspace.repoRoot).toBe('D:/demo');
    expect(c.handoff.summary).toContain('已完成 CSV 导出主体');
    expect(c.extensions['agentos.import']).toBeTruthy();
  });

  it('空会话/缺失字段也能生成合法 Capsule（objective 兜底）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agentos-imp-'));
    const file = writeFixture(root, 'proj/s-3.jsonl', ['{"type":"result","session_id":"s-3"}']);
    const c = await claudeSessionToCapsule(file, { objective: '手动指定目标' });
    expect(c.task.objective).toBe('手动指定目标');
  });
});

describe('Codex 会话导入（只读）', () => {
  it('listCodexSessions + codexSessionToCapsule（rollout envelope 结构）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agentos-imp-'));
    writeFixture(root, '2026/09/18/rollout-2026-09-18-th7-abc.jsonl', [
      '{"timestamp":"2026-09-18T10:00:00Z","type":"session_meta","payload":{"id":"th-7","cwd":"D:/demo2","version":"1.0"}}',
      '{"timestamp":"2026-09-18T10:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"实现导出功能"}]}}',
      '{"timestamp":"2026-09-18T10:00:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"已完成导出并补了测试"}]}}',
      '{"timestamp":"2026-09-18T10:00:03Z","type":"turn.completed","payload":{"usage":{"input_tokens":10}}}',
    ]);

    const sessions = await listCodexSessions(root);
    expect(sessions).toHaveLength(1);
    const s = sessions[0]!;
    expect(s.sessionId).toBe('th-7');
    expect(s.cwd).toBe('D:/demo2');
    expect(s.preview).toContain('实现导出功能');

    const c = await codexSessionToCapsule(s.file);
    expect(c.task.objective).toBe('实现导出功能');
    expect(c.origin.agentId).toBe('codex');
    expect(c.origin.sessionId).toBe('th-7');
    expect(c.handoff.summary).toContain('已完成导出并补了测试');
  });
});
