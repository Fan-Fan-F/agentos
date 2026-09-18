import type { AgentEvent, AgentAdapter, AgentProfile, AgentRunOptions, AgentRunResult } from './adapter.js';
import { nowIso } from '@agentos/core';

export interface StubScript {
  events?: Array<Omit<AgentEvent, 'agentId' | 'ts'>>;
  finalMessage?: string;
  sessionRef?: string;
  exitCode?: number;
}

export interface StubCall {
  prompt: string;
  sessionRefIn?: string;
  resumed: boolean;
  opts?: AgentRunOptions;
}

/**
 * StubAdapter：契约测试与无 agent 演示用。真实事件形状与 CLI 适配器一致。
 * 绝不用于冒充真实集成测试（见 TESTING.md）。
 */
export class StubAdapter implements AgentAdapter {
  readonly profile: AgentProfile;
  readonly calls: StubCall[] = [];

  constructor(
    readonly id: string,
    private readonly script: StubScript | ((prompt: string, resumed: boolean) => StubScript),
    profileOverrides?: Partial<AgentProfile>,
  ) {
    this.profile = {
      id,
      name: `Stub ${id}`,
      protocols: ['cli'],
      capabilities: { headless: true, resume: true, jsonStream: true, mcp: false, hooks: false },
      skills: { coding: 0.5, planning: 0.5, debugging: 0.5, review: 0.5, testing: 0.5 },
      ...profileOverrides,
    };
  }

  supportsResume(): boolean {
    return true;
  }

  async isAvailable(): Promise<{ available: boolean; binary?: string }> {
    return { available: true, binary: 'stub://' + this.id };
  }

  private emit(prompt: string, resumed: boolean, opts?: AgentRunOptions): StubScript {
    this.calls.push({ prompt, resumed, opts });
    const s = typeof this.script === 'function' ? this.script(prompt, resumed) : this.script;
    return {
      events: s.events ?? [],
      finalMessage: s.finalMessage ?? prompt.slice(0, 200),
      sessionRef: s.sessionRef ?? `stub-session-${this.calls.length}`,
      exitCode: s.exitCode ?? 0,
    };
  }

  async run(prompt: string, opts?: AgentRunOptions): Promise<AgentRunResult> {
    const s = this.emit(prompt, false, opts);
    return this.collect(s, opts);
  }

  async resume(sessionRef: string, prompt: string, opts?: AgentRunOptions): Promise<AgentRunResult> {
    const s = this.emit(prompt, true, opts);
    return this.collect(s, opts, sessionRef);
  }

  private async collect(s: StubScript, opts?: AgentRunOptions, resumedFrom?: string): Promise<AgentRunResult> {
    const events: AgentEvent[] = s.events!.map((e) => ({ ...e, agentId: this.id, ts: nowIso() }));
    for (const e of events) opts?.onEvent?.(e);
    return {
      sessionRef: s.sessionRef,
      finalMessage: s.finalMessage!,
      events,
      exitCode: s.exitCode!,
      timedOut: false,
      durationMs: 1,
      ...(resumedFrom ? { stderrTail: undefined } : {}),
    };
  }
}
