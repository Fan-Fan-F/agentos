import type { AgentProfile } from '@agentos/core';

export type { AgentProfile };

/** 归一化后的 agent 事件（所有 adapter 输出的统一形状）。 */
export type AgentEventType = 'system' | 'message' | 'tool_call' | 'tool_result' | 'error' | 'result';

export interface AgentEvent {
  agentId: string;
  ts: string;
  type: AgentEventType;
  data: Record<string, unknown>;
}

export interface AgentRunOptions {
  cwd?: string;
  env?: Record<string, string>;
  allowedTools?: string[];
  /** AgentOS Permission Profile 映射出的各家权限 flag（MVP 为空 = 各家默认安全档） */
  permissionFlags?: string[];
  model?: string;
  extraArgs?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (evt: AgentEvent) => void;
}

export interface AgentRunResult {
  /** 原生会话引用（可 resume 的 session id / thread id） */
  sessionRef?: string;
  finalMessage: string;
  events: AgentEvent[];
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stderrTail?: string;
}

/**
 * AgentAdapter —— 所有 agent 接入的唯一接口（任务书 §3）。
 * ACP / CLI / PTY / SDK / API 均为实现该接口的不同 transport。
 */
export interface AgentAdapter {
  readonly id: string;
  readonly profile: AgentProfile;
  isAvailable(): Promise<{ available: boolean; binary?: string }>;
  run(prompt: string, opts?: AgentRunOptions): Promise<AgentRunResult>;
  /** 同 agent 原生续接；不支持时抛 AgentNotSupportedError */
  resume?(sessionRef: string, prompt: string, opts?: AgentRunOptions): Promise<AgentRunResult>;
  supportsResume(): boolean;
}

export class AgentNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentNotSupportedError';
  }
}
