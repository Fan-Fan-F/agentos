import { describe, expect, it } from 'vitest';
import { createCapsule, capsuleToMarkdown } from '../src/capsule/capsule.js';
import { compileContext } from '../src/context/compiler.js';

function capsule() {
  return createCapsule({
    task: { id: 'task', objective: '修复错误', constraints: ['不要修改主仓库'], userInstructions: ['不要访问用户凭据'] },
    origin: { agentId: 'agent-a' }, status: 'in-progress',
    progress: { completed: [], remaining: [] },
    workspace: { repoRoot: '/repo', worktreePath: '/isolated/task' },
    permissions: { expectations: ['只在隔离工作区写文件'] },
  });
}

describe('handoff context fidelity', () => {
  it('carries permission expectations in both human and compiled views', () => {
    const c = capsule();
    expect(compileContext(c, 'minimal').markdown).toContain('只在隔离工作区写文件');
    expect(capsuleToMarkdown(c)).toContain('只在隔离工作区写文件');
  });
  it('refuses a context that cannot fit its mandatory user instructions', () => {
    const c = capsule();
    c.task.userInstructions = ['重要约束'.repeat(2000)];
    expect(() => compileContext(c, 'minimal')).toThrow(/核心交接上下文/);
    expect(compileContext(c, 'standard').markdown).toContain(c.task.userInstructions[0]);
  });
  it('preserves workspace identity and failed test evidence ahead of large history', () => {
    const c = capsule();
    c.progress.completed = ['旧历史'.repeat(1300)];
    c.workspace.changedFiles = Array.from({ length: 1000 }, (_, i) => ({ path: `src/long-path-${i}.ts`, change: 'modified' as const }));
    c.verification.tests = [{ command: 'node --test', passed: 2, failed: 1, summary: '重要失败' }];
    const out = compileContext(c, 'minimal');
    expect(out.markdown).toContain('/isolated/task');
    expect(out.markdown).toContain('重要失败');
    expect(out.markdown).toContain('不要访问用户凭据');
    expect(out.markdown).toContain('以下段落因预算省略');
    expect(out.usedChars).toBeLessThanOrEqual(out.budgetChars);
  });
  it('explicitly distinguishes missing test evidence from passed tests', () => {
    expect(compileContext(capsule()).markdown).toContain('未记录测试结果');
    expect(capsuleToMarkdown(capsule())).toContain('未记录测试结果');
  });
});
