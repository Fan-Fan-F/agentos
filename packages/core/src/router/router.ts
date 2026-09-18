import type { AgentProfile, AgentSkill } from '../types.js';

/**
 * Agent Router（M1 基线版）：按能力评分 + 可用性选 agent。
 * 用户始终可用 preferred 显式覆盖（"用户始终可以关闭自动路由"）。
 */

export type TaskKind =
  | 'coding'
  | 'planning'
  | 'debugging'
  | 'review'
  | 'testing'
  | 'research'
  | 'generic';

export interface RoutableAgent {
  profile: AgentProfile;
  available: boolean;
  authed: boolean;
}

const KIND_WEIGHTS: Record<TaskKind, Partial<Record<AgentSkill, number>>> = {
  coding: { coding: 1, speed: 0.25, debugging: 0.2 },
  planning: { planning: 1, largeContext: 0.5 },
  debugging: { debugging: 1, coding: 0.5, review: 0.2 },
  review: { review: 1, coding: 0.4 },
  testing: { testing: 1, coding: 0.4 },
  research: { largeContext: 1, planning: 0.4, speed: 0.1 },
  generic: { coding: 0.6, planning: 0.4, review: 0.2 },
};

export function scoreAgent(agent: RoutableAgent, kind: TaskKind): number {
  if (!agent.available) return -Infinity;
  const weights = KIND_WEIGHTS[kind];
  let score = 0;
  for (const [skill, weight] of Object.entries(weights) as Array<[AgentSkill, number]>) {
    score += weight * (agent.profile.skills?.[skill] ?? 0.5);
  }
  score += 1.0; // 可用性基础分
  if (agent.authed) score += 0.5;
  return score;
}

export function pickAgent(
  agents: RoutableAgent[],
  kind: TaskKind = 'generic',
  opts: { preferred?: string } = {},
): RoutableAgent | undefined {
  if (opts.preferred) {
    const hit = agents.find((a) => a.profile.id === opts.preferred && a.available);
    if (hit) return hit;
  }
  let best: RoutableAgent | undefined;
  let bestScore = -Infinity;
  for (const a of agents) {
    const s = scoreAgent(a, kind);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best;
}
