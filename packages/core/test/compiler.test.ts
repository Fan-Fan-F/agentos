import { describe, expect, it } from 'vitest';
import { createCapsule } from '../src/capsule/capsule.js';
import { compileContext, CONTEXT_BUDGETS } from '../src/context/compiler.js';

function bigCapsule() {
  return createCapsule({
    task: {
      id: 't1',
      objective: '重构认证模块并补齐测试',
      constraints: ['保持 API 兼容', '不升级依赖'],
      userInstructions: ['所有提交用中文 message'],
    },
    status: 'in-progress',
    origin: { agentId: 'claude', sessionId: 's1' },
    progress: {
      completed: ['阅读 auth.ts', '拆分 token 工具'],
      remaining: ['补测试', '更新文档'],
      decisions: [
        { summary: '保留 /login 路由', rationale: '前端依赖' },
        { summary: 'token 放 httpOnly cookie', rationale: '安全' },
      ],
      rejectedApproaches: [{ approach: '重写整个模块', reason: '风险过大' }],
    },
    workspace: {
      repoRoot: 'D:/demo',
      branch: 'agentos/t1/claude',
      baseCommit: 'abc123',
      worktreePath: 'D:/demo-agentos-worktrees/demo/t1-claude',
      changedFiles: [{ path: 'src/auth.ts', change: 'modified' }, { path: 'src/token.ts', change: 'added' }],
      diffStat: ' src/auth.ts | 30 ++++++++---\n src/token.ts | 12 +++++\n 2 files changed',
      commits: [{ hash: '1111111', message: 'agentos: checkpoint' }],
    },
    verification: { tests: [{ command: 'npm test', passed: 8, failed: 1, summary: 'auth.spec 1 个失败' }] },
    handoff: { fromAgent: 'claude', summary: '主体完成，测试待补' },
    context: {
      keyFacts: Array.from({ length: 120 }, (_, i) => `关键事实 ${i}：auth 模块第 ${i} 号入口的调用方与副作用清单，保证内容足够长以测试预算裁剪行为`),
      environment: { platform: 'win32' },
    },
  });
}

describe('Context Compiler', () => {
  it('standard 级包含核心交接要素', () => {
    const out = compileContext(bigCapsule(), 'standard');
    expect(out.markdown).toContain('重构认证模块并补齐测试');
    expect(out.markdown).toContain('不要重做');
    expect(out.markdown).toContain('已否决方案');
    expect(out.markdown).toContain('重写整个模块');
    expect(out.markdown).toContain('agentos/t1/claude');
    expect(out.markdown).toContain('capsule=' + out.capsuleId);
    expect(out.droppedSections).toEqual([]);
    expect(out.usedChars).toBeLessThanOrEqual(CONTEXT_BUDGETS.standard);
  });

  it('预算裁剪：极小预算下低优先级段落被丢弃并记录', () => {
    const out = compileContext({ ...bigCapsule() }, 'standard');
    // 直接构造超小预算场景：用 minimal 也不够小，这里断言 minimal 丢掉了部分段落
    const mini = compileContext(bigCapsule(), 'minimal');
    expect(mini.budgetChars).toBe(CONTEXT_BUDGETS.minimal);
    expect(mini.includedSections).toContain('task-objective');
    // minimal 预算小，必然丢弃一些低优先级内容
    expect(mini.droppedSections.length).toBeGreaterThan(0);
    expect(out.includedSections.length).toBeGreaterThanOrEqual(mini.includedSections.length);
  });

  it('截断保护：超长目标不会撑爆预算（始终保留 objective 但截断到 4000）', () => {
    const c = bigCapsule();
    c.task.objective = 'x'.repeat(9000);
    const out = compileContext(c, 'minimal');
    expect(out.markdown.length).toBeLessThan(9000);
    expect(out.markdown).toContain('已截断');
  });
});
