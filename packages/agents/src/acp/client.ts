import { createMessageReader, writeMessage, type JsonRpcMessage, type JsonRpcResponse } from './jsonrpc.js';
import type { AgentEvent, AgentAdapter, AgentProfile, AgentRunOptions, AgentRunResult } from '../adapter.js';
import { AgentNotSupportedError } from '../adapter.js';
import { nowIso } from '@agentos/core';

/**
 * ACP 适配层（骨架，M3 完善）：
 * AcpClient 通过注入的进程流说 JSON-RPC（stdio NDJSON）——
 * initialize → session/new → session/prompt，收集 session/update 通知。
 * 用依赖注入而非直接 spawn，使协议逻辑可脱离真实 agent 单测。
 * 注意：这是协议骨架，尚未对齐官方 SDK 的完整 schema（M3 换用 @zed-industries/agent-client-protocol）。
 */

export interface AcpProcessLike {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr?: NodeJS.ReadableStream;
  kill(): void;
}

export interface AcpSessionUpdate {
  sessionId?: string;
  update?: Record<string, unknown>;
}

export class AcpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private unsubscribe: () => void;

  constructor(private readonly proc: AcpProcessLike) {
    const reader = createMessageReader(proc.stdout);
    this.unsubscribe = reader.onMessage((msg: JsonRpcMessage) => this.handle(msg));
  }

  private handle(msg: JsonRpcMessage): void {
    if ('id' in msg && msg.id !== null && msg.id !== undefined && ('result' in msg || 'error' in msg)) {
      const res = msg as JsonRpcResponse;
      const p = this.pending.get(res.id as number);
      if (!p) return;
      this.pending.delete(res.id as number);
      if (res.error) p.reject(new Error(`ACP 错误 ${res.error.code}: ${res.error.message}`));
      else p.resolve(res.result);
    }
    // session/update 等通知由 prompt 循环内消费（见 notifications 缓冲）
    if ('method' in msg && !('id' in msg)) {
      for (const fn of AcpClient.notificationListeners) fn(msg.method, msg.params);
    }
  }

  private static notificationListeners = new Set<(method: string, params: unknown) => void>();

  onNotification(fn: (method: string, params: unknown) => void): () => void {
    AcpClient.notificationListeners.add(fn);
    return () => AcpClient.notificationListeners.delete(fn);
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    // 先登记 pending 再写出请求：stdio 流可能同步派发响应（Node 24 PassThrough 实测如此）
    let resolveFn!: (v: unknown) => void;
    let rejectFn!: (e: Error) => void;
    const promise = new Promise<unknown>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    this.pending.set(id, { resolve: resolveFn, reject: rejectFn });
    writeMessage(this.proc.stdin, { jsonrpc: '2.0', id, method, params });
    return promise;
  }

  async initialize(clientInfo: { name: string; version: string }): Promise<unknown> {
    return this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo,
    });
  }

  async newSession(cwd: string, mcpServers: unknown[] = []): Promise<string> {
    const res = (await this.request('session/new', { cwd, mcpServers })) as { sessionId?: string };
    if (!res?.sessionId) throw new Error('ACP agent 未返回 sessionId');
    return res.sessionId;
  }

  /** 发送一轮 prompt；返回最终 agent 文本（收集 agent_message_chunk 增量）。 */
  async prompt(
    sessionId: string,
    text: string,
    onEvent?: (evt: AgentEvent, agentId: string) => void,
    agentId = 'acp-agent',
  ): Promise<AgentRunResult> {
    const started = Date.now();
    const events: AgentEvent[] = [];
    let finalText = '';
    const off = this.onNotification((method, params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      if (method !== 'session/update') return;
      const update = (p['update'] ?? {}) as Record<string, unknown>;
      if (update['sessionUpdate'] === 'agent_message_chunk') {
        const chunk = (update['content'] as { text?: string } | undefined)?.text ?? '';
        finalText += chunk;
        const evt: AgentEvent = { agentId, ts: nowIso(), type: 'message', data: { delta: chunk } };
        events.push(evt);
        onEvent?.(evt, agentId);
      } else if (update['sessionUpdate'] === 'tool_call') {
        const evt: AgentEvent = { agentId, ts: nowIso(), type: 'tool_call', data: update };
        events.push(evt);
        onEvent?.(evt, agentId);
      }
    });
    try {
      const res = (await this.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text }],
      })) as { stopReason?: string };
      const evt: AgentEvent = { agentId, ts: nowIso(), type: 'result', data: { stopReason: res?.stopReason } };
      events.push(evt);
      onEvent?.(evt, agentId);
      return {
        sessionRef: sessionId,
        finalMessage: finalText,
        events,
        exitCode: 0,
        timedOut: false,
        durationMs: Date.now() - started,
      };
    } finally {
      off();
    }
  }

  stop(): void {
    this.unsubscribe();
    this.proc.kill();
    for (const [, p] of this.pending) p.reject(new Error('ACP 连接关闭'));
    this.pending.clear();
  }
}

export interface AcpAdapterOptions {
  /** 注入进程工厂（生产环境传真实 spawn；测试传内存流） */
  createProcess: () => Promise<AcpProcessLike>;
  profile: AgentProfile;
}

export class AcpAdapter implements AgentAdapter {
  readonly id: string;
  readonly profile: AgentProfile;

  constructor(private readonly opts: AcpAdapterOptions) {
    this.id = opts.profile.id;
    this.profile = opts.profile;
  }

  supportsResume(): boolean {
    // ACP session/load（会话恢复）在 M3 对齐官方 SDK 后启用
    return false;
  }

  async isAvailable(): Promise<{ available: boolean; binary?: string }> {
    // 由注入工厂决定；骨架返回 false，避免在未配置时被自动路由选中
    return { available: false };
  }

  async run(prompt: string, opts: AgentRunOptions = {}): Promise<AgentRunResult> {
    if (!this.opts.createProcess) {
      throw new AgentNotSupportedError('ACP adapter 将在 M3 落地（需官方 SDK 对齐）');
    }
    const proc = await this.opts.createProcess();
    const client = new AcpClient(proc);
    try {
      await client.initialize({ name: 'agentos', version: '0.1.0' });
      const sessionId = await client.newSession(opts.cwd ?? process.cwd());
      return await client.prompt(sessionId, prompt, (evt) => opts.onEvent?.(evt));
    } finally {
      client.stop();
    }
  }
}
