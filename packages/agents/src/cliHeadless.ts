import type { AgentProfile } from '@agentos/core';
import { nowIso } from '@agentos/core';
import { spawnCapture } from './spawn.js';
import { findInPath } from './where.js';
import { AgentNotSupportedError, type AgentAdapter, type AgentEvent, type AgentEventType, type AgentRunOptions, type AgentRunResult } from './adapter.js';

export interface ParseContext {
  events: AgentEvent[];
  sessionRef?: string;
  push(type: AgentEventType, data: Record<string, unknown>): void;
}

/** 每个 CLI agent 的差异点全部收敛在这个定义里（docs/research/04-agent-clis.md）。 */
export interface CliAgentDefinition {
  id: string;
  profile: AgentProfile;
  binary: string;
  buildRunArgs(prompt: string, opts?: AgentRunOptions): string[];
  /** 返回 null/undefined = 不支持原生 resume */
  buildResumeArgs?(sessionRef: string, prompt: string, opts?: AgentRunOptions): string[] | null;
  /** 逐行 JSONL 解析（必须容错：未知行直接忽略） */
  parseLine?(line: string, ctx: ParseContext): void;
  /** 整体输出兜底解析（非 JSONL 的单块 JSON / 纯文本） */
  parseBuffer?(stdout: string, ctx: ParseContext): void;
  finalFrom?(stdout: string, events: AgentEvent[]): string;
}

function lastEventText(events: AgentEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    const text = e.data['text'];
    if (typeof text === 'string' && text.trim()) return text;
  }
  return undefined;
}

/**
 * 无头 CLI 适配器基类（ADR-003）：spawn → stdout JSONL/文本归一化 → AgentEvent。
 * 私有 schema 漂移容错：任何解析异常都只忽略该行，绝不让整次运行崩溃。
 */
export class CliHeadlessAdapter implements AgentAdapter {
  readonly id: string;
  readonly profile: AgentProfile;

  constructor(readonly def: CliAgentDefinition) {
    this.id = def.id;
    this.profile = def.profile;
  }

  supportsResume(): boolean {
    return typeof this.def.buildResumeArgs === 'function';
  }

  async isAvailable(): Promise<{ available: boolean; binary?: string }> {
    const hits = findInPath(this.def.binary);
    return { available: hits.length > 0, binary: hits[0] };
  }

  async run(prompt: string, opts: AgentRunOptions = {}): Promise<AgentRunResult> {
    const avail = await this.isAvailable();
    if (!avail.available) {
      throw new Error(`未找到 ${this.def.binary} 可执行文件。请先安装或在 PATH 中提供（可运行 \`agentos doctor\` 检查）。`);
    }
    return this.execute(this.def.buildRunArgs(prompt, opts), opts);
  }

  async resume(sessionRef: string, prompt: string, opts: AgentRunOptions = {}): Promise<AgentRunResult> {
    if (!this.def.buildResumeArgs) {
      throw new AgentNotSupportedError(`${this.id} 不支持原生会话恢复；AgentOS 将走 Capsule 交接通道。`);
    }
    const args = this.def.buildResumeArgs(sessionRef, prompt, opts);
    if (!args) throw new AgentNotSupportedError(`${this.id} 不支持原生会话恢复；AgentOS 将走 Capsule 交接通道。`);
    return this.execute(args, opts);
  }

  private async execute(args: string[], opts: AgentRunOptions): Promise<AgentRunResult> {
    const started = Date.now();
    const ctx: ParseContext = {
      events: [],
      sessionRef: undefined,
      push: () => {},
    };
    ctx.push = (type, data) => {
      const evt: AgentEvent = { agentId: this.id, ts: nowIso(), type, data };
      ctx.events.push(evt);
      opts.onEvent?.(evt);
    };

    const res = await spawnCapture(this.def.binary, args, {
      cwd: opts.cwd,
      env: opts.env,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      onLine: (line) => {
        try {
          this.def.parseLine?.(line, ctx);
        } catch {
          // 私有 schema 漂移容错：单行解析失败只忽略该行
        }
      },
    });

    if (!ctx.sessionRef && this.def.parseBuffer) {
      try {
        this.def.parseBuffer(res.stdout, ctx);
      } catch {
        // 兜底解析同样容错
      }
    }

    const finalMessage =
      this.def.finalFrom?.(res.stdout, ctx.events) ?? lastEventText(ctx.events) ?? res.stdout.trim().slice(-4000);

    return {
      sessionRef: ctx.sessionRef,
      finalMessage,
      events: ctx.events,
      exitCode: res.exitCode,
      timedOut: res.timedOut,
      durationMs: Date.now() - started,
      stderrTail: res.stderr ? res.stderr.split('\n').slice(-10).join('\n').slice(-2000) : undefined,
    };
  }
}

export { lastEventText };

/** 测试用：构造可收集事件的解析上下文。 */
export function createParseContext(agentId = 'test'): ParseContext {
  const ctx: ParseContext = { events: [], sessionRef: undefined, push: () => {} };
  ctx.push = (type, data) => {
    ctx.events.push({ agentId, ts: nowIso(), type, data });
  };
  return ctx;
}
