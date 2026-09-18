import { describe, expect, it } from 'vitest';
import { pickAgent, scoreAgent, type RoutableAgent } from '../src/router/router.js';

function agent(id: string, skills: Record<string, number>, available = true, authed = true): RoutableAgent {
  return { profile: { id, name: id, protocols: ['cli'], capabilities: { headless: true, resume: false, jsonStream: false, mcp: false, hooks: false }, skills }, available, authed };
}

describe('Agent Router（M1 基线）', () => {
  const agents: RoutableAgent[] = [
    agent('claude', { planning: 0.9, coding: 0.95, review: 0.9 }),
    agent('codex', { coding: 0.9, debugging: 0.85 }),
    agent('gemini', { largeContext: 1.0, coding: 0.8 }, false), // 不可用
  ];

  it('按任务类型选最强能力', () => {
    expect(pickAgent(agents, 'planning')!.profile.id).toBe('claude');
    expect(pickAgent(agents, 'debugging')!.profile.id).toBe('codex');
  });

  it('不可用 agent 永远不会被选中', () => {
    const r = pickAgent(agents, 'research')!;
    expect(r.profile.id).not.toBe('gemini');
  });

  it('preferred 显式指定优先（用户可关闭自动路由）', () => {
    expect(pickAgent(agents, 'planning', { preferred: 'codex' })!.profile.id).toBe('codex');
    // preferred 不可用时回退自动
    expect(pickAgent(agents, 'planning', { preferred: 'gemini' })!.profile.id).toBe('claude');
  });

  it('评分：不可用为 -Infinity，已登录加分', () => {
    expect(scoreAgent(agents[2]!, 'coding')).toBe(-Infinity);
    const a = agent('x', { coding: 0.5 }, true, true);
    const b = agent('y', { coding: 0.5 }, true, false);
    expect(scoreAgent(a, 'coding')).toBeGreaterThan(scoreAgent(b, 'coding'));
  });
});
