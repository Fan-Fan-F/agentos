import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile } from '@agentos/core';
import { nowIso } from '@agentos/core';
import { spawnCapture } from './spawn.js';
import { resolveLauncher, type Launcher } from './where.js';
import { AgentNotSupportedError, type AgentAdapter, type AgentEvent, type AgentEventType, type AgentRunOptions, type AgentRunResult } from './adapter.js';

export interface ParseContext {
  events: AgentEvent[];
  sessionRef?: string;
  push(type: AgentEventType, data: Record<string, unknown>): void;
}

/**
 * 提示词投递通道：
 * - stdin：写 stdin 并关闭（claude/codex/opencode 官方模式；`codex exec` 不关 stdin 会挂起）
 * - filePrompt：写入 `<cwd>/.agentos/PROMPT.md` 后由 args 中的 @file 引用（gemini 模式）
 * - 位置参数：短提示词直接进 argv
 */
export interface PromptInvocation {
  args: string[];
  stdin?: string;
  filePrompt?: string;
}

/** 每个 CLI agent 的差异点全部收敛在这个定义里（docs/research/04-agent-clis.md）。 */
export interface CliAgentDefinition {
  id: string;
  profile: AgentProfile;
  binary: string;
  /** npm 包名：Windows .cmd shim 解析成 node + 真实 bin.js 用（CVE-2024-27980 规避） */
  npmPackage?: string;
  buildRunArgs(prompt: string, opts?: AgentRunOptions): PromptInvocation;
  buildResumeArgs?(sessionRef: string, prompt: string, opts?: AgentRunOptions): PromptInvocation | null;
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
 * 无头 CLI 适配器基类（ADR-003）：launcher 解析 → spawn → stdout JSONL/文本归一化 → AgentEvent。
 * 私有 schema 漂移容错：任何解析异常都只忽略该行，绝不让整次运行崩溃。
 */
export class CliHeadlessAdapter implements AgentAdapter {
  readonly id: string;
  readonly profile: AgentProfile;
  private launcherPromise?: Promise<Launcher | null>;

  constructor(readonly def: CliAgentDefinition) {
    this.id = def.id;
    this.profile = def.profile;
  }

  supportsResume(): boolean {
    return typeof this.def.buildResumeArgs === 'function';
  }

  async isAvailable(): Promise<{ available: boolean; binary?: string }> {
    const launcher = await this.launcher();
    return { available: !!launcher, binary: launcher?.via === 'node' ? launcher.prefixArgs[0] : launcher?.cmd };
  }

  private async launcher(): Promise<Launcher | null> {
    if (!this.launcherPromise) {
      this.launcherPromise = resolveLauncher(this.def.binary, this.def.npmPackage);
    }
    return this.launcherPromise;
  }

  async run(prompt: string, opts: AgentRunOptions = {}): Promise<AgentRunResult> {
    const launcher = await this.launcher();
    if (!launcher) {
      throw new Error(`未找到 ${this.def.binary} 可执行文件。请先安装或在 PATH 中提供（可运行 \`agentos doctor\` 检查）。`);
    }
    return this.execute(launcher, this.def.buildRunArgs(prompt, opts), opts);
  }

  async resume(sessionRef: string, prompt: string, opts: AgentRunOptions = {}): Promise<AgentRunResult> {
    if (!this.def.buildResumeArgs) {
      throw new AgentNotSupportedError(`${this.id} 不支持原生会话恢复；AgentOS 将走 Capsule 交接通道。`);
    }
    const invocation = this.def.buildResumeArgs(sessionRef, prompt, opts);
    if (!invocation) throw new AgentNotSupportedError(`${this.id} 不支持原生会话恢复；AgentOS 将走 Capsule 交接通道。`);
    const launcher = await this.launcher();
    if (!launcher) throw new Error(`未找到 ${this.def.binary} 可执行文件。`);
    return this.execute(launcher, invocation, opts);
  }

  private async execute(launcher: Launcher, invocation: PromptInvocation, opts: AgentRunOptions): Promise<AgentRunResult> {
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

    // 文件通道：长提示词落盘到 worktree 内 .agentos/PROMPT.md（gemini @file 引用）
    let fileCleanup: string | undefined;
    if (invocation.filePrompt) {
      if (!opts.cwd) throw new Error('文件通道需要 cwd（worktree）');
      const dir = path.join(opts.cwd, '.agentos');
      fs.mkdirSync(dir, { recursive: true });
      fileCleanup = path.join(dir, 'PROMPT.md');
      fs.writeFileSync(fileCleanup, invocation.filePrompt, 'utf8');
    }

    try {
      const res = await spawnCapture(launcher.cmd, [...launcher.prefixArgs, ...invocation.args], {
        cwd: opts.cwd,
        env: opts.env,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        stdin: invocation.stdin,
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
    } finally {
      if (fileCleanup) {
        try {
          fs.unlinkSync(fileCleanup);
        } catch {
          // 清理失败不影响结果
        }
      }
    }
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
