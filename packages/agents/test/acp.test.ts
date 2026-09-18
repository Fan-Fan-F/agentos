import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AcpClient, type AcpProcessLike } from '../src/acp/client.js';
import { createMessageReader, writeMessage } from '../src/acp/jsonrpc.js';
import { AcpAdapter } from '../src/acp/client.js';

/** 用内存流模拟 ACP agent 端（无需真实 agent，协议逻辑真实运行）。 */
function fakeAgent() {
  const agentStdin = new PassThrough(); // client 写 → agent 读
  const agentStdout = new PassThrough(); // agent 写 → client 读
  const proc: AcpProcessLike = { stdin: agentStdin, stdout: agentStdout, kill() {} };

  const seen: Array<{ id?: number; method: string; params?: unknown }> = [];
  /** agent 收到的"响应/错误"（client 的应答），用于验证防挂死策略 */
  const replies: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const reader = createMessageReader(agentStdin);
  reader.onMessage((msg) => {
    if ('method' in msg) seen.push({ id: (msg as { id?: number }).id, method: msg.method, params: msg.params });
    else replies.push(msg as Record<string, unknown>);
    const req = msg as { id?: number; method: string };
    if (req.id === undefined) return;
    // 按协议依次应答
    if (req.method === 'initialize') {
      writeMessage(agentStdout, { jsonrpc: '2.0', id: req.id, result: { protocolVersion: 1, agentInfo: { name: 'fake', version: '0' } } });
    } else if (req.method === 'session/new') {
      writeMessage(agentStdout, { jsonrpc: '2.0', id: req.id, result: { sessionId: `sess-${nextId++}` } });
    } else if (req.method === 'session/prompt') {
      // 模拟真实 ACP agent：先请求权限，再流式通知 + 最终应答 —— client 必须应答权限请求，否则挂死
      writeMessage(agentStdout, {
        jsonrpc: '2.0',
        id: 9001,
        method: 'session/request_permission',
        params: { sessionId: 'sess-1', options: [], requestId: 9001 },
      });
      writeMessage(agentStdout, {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好，' } } },
      });
      writeMessage(agentStdout, {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '世界' } } },
      });
      writeMessage(agentStdout, { jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } });
    }
  });
  return { proc, seen, replies };
}

describe('ACP 客户端（stdio NDJSON，M3 前骨架）', () => {
  it('initialize → session/new → session/prompt（增量收集为 finalMessage + 事件）', async () => {
    const { proc, seen, replies } = fakeAgent();
    const client = new AcpClient(proc);

    await client.initialize({ name: 'agentos', version: '0.1.0' });
    const sessionId = await client.newSession('D:/demo');
    expect(sessionId).toMatch(/^sess-/);

    const events: string[] = [];
    const res = await client.prompt(sessionId, '实现 X', (e) => events.push(e.type));
    expect(res.finalMessage).toBe('你好，世界');
    expect(res.sessionRef).toBe(sessionId);
    expect(events.filter((t) => t === 'message').length).toBe(2);
    expect(events.at(-1)).toBe('result');

    expect(seen.map((s) => s.method)).toEqual(['initialize', 'session/new', 'session/prompt']);
    const promptParams = seen[2]!.params as { prompt: Array<{ type: string; text: string }> };
    expect(promptParams.prompt[0]!.text).toBe('实现 X');
    // 防挂死：agent 的 session/request_permission 请求必须被应答（默认拒绝 cancel）
    const permReply = replies.find((r) => r['id'] === 9001) as { result?: { outcome?: { type?: string } } } | undefined;
    expect(permReply).toBeDefined();
    expect(permReply!.result!.outcome!.type).toBe('cancel');
  });
});

describe('ACP Adapter（骨架，默认不可用 —— 诚实标注 M3）', () => {
  it('未注入进程工厂时 run 抛出明确错误；isAvailable=false 不参与自动路由', async () => {
    const adapter = new AcpAdapter({
      createProcess: undefined as never,
      profile: { id: 'acp-x', name: 'ACP X', protocols: ['acp'], capabilities: { headless: true, resume: false, jsonStream: true, mcp: false, hooks: false } },
    });
    expect((await adapter.isAvailable()).available).toBe(false);
    await expect(adapter.run('x')).rejects.toThrow(/M3/);
  });

  it('注入进程工厂后走真实 ACP 流程', async () => {
    const { proc } = fakeAgent();
    const adapter = new AcpAdapter({
      createProcess: async () => proc,
      profile: { id: 'acp-x', name: 'ACP X', protocols: ['acp'], capabilities: { headless: true, resume: false, jsonStream: true, mcp: false, hooks: false } },
    });
    const res = await adapter.run('做点事', { cwd: 'D:/x' });
    expect(res.finalMessage).toBe('你好，世界');
  });
});
