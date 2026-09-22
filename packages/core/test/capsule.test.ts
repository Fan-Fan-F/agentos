import { compileContext } from '../src/context/compiler.js';
import { describe, expect, it } from 'vitest';
import { createCapsule, parseCapsule, capsuleToMarkdown, CapsuleVersionError } from '../src/capsule/capsule.js';

describe('Universal Session Capsule v1', () => {
  it('创建 → 序列化 → 解析 往返无损', () => {
    const c = createCapsule({
      task: { id: 'task_x', objective: '实现登录', constraints: ['不引入新依赖'], userInstructions: ['用中文回复'] },
      status: 'in-progress',
      origin: { agentId: 'claude', sessionId: 's1' },
      progress: {
        completed: ['梳理了 auth 模块'],
        remaining: ['写测试'],
        decisions: [{ summary: '用 JWT', rationale: '无状态', byAgent: 'claude' }],
        rejectedApproaches: [{ approach: 'session 存 DB', reason: '引入状态' }],
      },
      workspace: {
        repoRoot: 'D:/demo',
        branch: 'agentos/task_x/claude',
        baseCommit: 'abcdef1234567890',
        changedFiles: [{ path: 'src/auth.ts', change: 'modified' }],
        commits: [{ hash: 'deadbeef', message: 'agentos: checkpoint' }],
      },
      handoff: { fromAgent: 'claude', summary: '完成主体实现' },
    });
    const round = parseCapsule(JSON.parse(JSON.stringify(c)));
    expect(round.id).toBe(c.id);
    expect(round.schemaVersion).toBe(1);
    expect(round.task.constraints).toEqual(['不引入新依赖']);
    expect(round.progress.decisions[0]!.summary).toBe('用 JWT');
    expect(round.workspace.changedFiles[0]!.path).toBe('src/auth.ts');
  });

  it('extensions 命名空间扩展位可往返保存（可扩展性）', () => {
    const c = createCapsule({
      task: { id: 't', objective: 'x' },
      status: 'in-progress',
      origin: { agentId: 'codex' },
      progress: {},
      workspace: { repoRoot: '/' },
      extensions: { 'agentos.acp.sessionId': 'acp-1', other: { nested: true } },
    });
    const round = parseCapsule(JSON.parse(JSON.stringify(c)));
    expect(round.extensions['agentos.acp.sessionId']).toBe('acp-1');
  });

  it('更高 schemaVersion 显式报错（版本前向策略，不猜测字段）', () => {
    expect(() => parseCapsule({ schemaVersion: 99, id: 'x' })).toThrow(CapsuleVersionError);
    try {
      parseCapsule({ schemaVersion: 99 });
    } catch (err) {
      expect((err as CapsuleVersionError).foundVersion).toBe(99);
    }
  });

  it('Markdown 视图包含交接关键信息（人可读）', () => {
    const c = createCapsule({
      task: { id: 't', objective: '修复竞态条件' },
      status: 'in-progress',
      origin: { agentId: 'gemini' },
      progress: {
        completed: ['定位到 race'],
        remaining: ['写修复'],
        decisions: [{ summary: '用队列串行化' }],
        rejectedApproaches: [{ approach: '加锁', reason: '死锁风险' }],
      },
      workspace: { repoRoot: '/r', branch: 'agentos/t/gemini', changedFiles: [{ path: 'a.ts', change: 'modified' }] },
      verification: { tests: [{ command: 'npm test', passed: 3, failed: 1 }] },
      handoff: { fromAgent: 'gemini', summary: '已定位' },
    });
    const md = capsuleToMarkdown(c);
    expect(md).toContain('# Session Capsule');
    expect(md).toContain('修复竞态条件');
    expect(md).toContain('已否决方案');
    expect(md).toContain('死锁风险');
    expect(md).toContain('npm test');
    expect(md).toContain('通过 3 / 失败 1');
    expect(md).toContain('交接摘要');
  });
});

it('keeps rename provenance in JSON, Markdown and compiled handoff context', () => {
  const capsule = createCapsule({
    task: { id: 'rename', objective: 'continue after rename' }, status: 'in-progress',
    origin: { agentId: 'claude' }, progress: {},
    workspace: { repoRoot: 'D:/test', changedFiles: [{ path: '新 文件.txt', previousPath: '旧 文件.txt', change: 'renamed' }] },
  });
  const parsed = parseCapsule(JSON.parse(JSON.stringify(capsule)));
  expect(parsed.workspace.changedFiles[0]!.previousPath).toBe('旧 文件.txt');
  expect(capsuleToMarkdown(parsed)).toContain('旧 文件.txt → 新 文件.txt');
  expect(compileContext(parsed, 'standard').markdown).toContain('旧 文件.txt → 新 文件.txt');
});
