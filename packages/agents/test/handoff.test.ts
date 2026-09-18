import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCapsule } from '@agentos/core';
import { buildHandoffPrompt, buildVerifyProbe, writeHandoffFile, CHECKPOINT_QUESTIONS, HANDOFF_FILE } from '../src/handoff.js';

describe('Handoff 管线（ADR-005）', () => {
  const capsule = createCapsule({
    task: { id: 't', objective: '实现导出功能', constraints: ['不加依赖'], userInstructions: [] },
    status: 'in-progress',
    origin: { agentId: 'claude', sessionId: 's1' },
    progress: {
      completed: ['数据模型'],
      remaining: ['导出 UI'],
      decisions: [{ summary: 'CSV 用 ; 分隔' }],
      rejectedApproaches: [{ approach: 'JSON 导出', reason: '用户要 CSV' }],
    },
    workspace: { repoRoot: 'D:/demo', branch: 'agentos/t/claude', baseCommit: 'abc' },
    handoff: { fromAgent: 'claude', summary: '模型层完成' },
  });

  it('交接 prompt 包含目标/决策/否决方案/HANDOFF 文件指引/七问', () => {
    const p = buildHandoffPrompt(capsule, 'codex', 'standard');
    expect(p.prompt).toContain('实现导出功能');
    expect(p.prompt).toContain('CSV 用 ; 分隔');
    expect(p.prompt).toContain('JSON 导出');
    expect(p.prompt).toContain('HANDOFF.md');
    expect(p.prompt).toContain('当前任务是什么');
    expect(p.prompt).toContain('你（codex）正在接管');
    expect(p.prompt).toContain('claude');
    // 上下文编译追踪
    expect(p.includedSections).toContain('task-objective');
    expect(p.handoffFilePath.replace(/\\/g, '/')).toBe('.agentos/HANDOFF.md');
  });

  it('七问探针固定可复现', () => {
    const probe = buildVerifyProbe();
    expect(CHECKPOINT_QUESTIONS).toHaveLength(7);
    CHECKPOINT_QUESTIONS.forEach((q) => expect(probe).toContain(q));
  });

  it('HANDOFF.md 写入 worktree 的 .agentos/ 目录', () => {
    const wt = mkdtempSync(path.join(tmpdir(), 'agentos-wt-'));
    const file = writeHandoffFile(wt, '# handoff content');
    expect(file).toBe(path.join(wt, '.agentos', HANDOFF_FILE));
    expect(file.startsWith(wt)).toBe(true);
  });
});
