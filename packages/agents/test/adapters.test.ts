import { describe, expect, it } from 'vitest';
import { StubAdapter } from '../src/stub.js';
import { createClaudeAdapter } from '../src/adapters/claude.js';
import { createCodexAdapter } from '../src/adapters/codex.js';
import { createGeminiAdapter } from '../src/adapters/gemini.js';
import { createOpencodeAdapter } from '../src/adapters/opencode.js';
import { createParseContext, type ParseContext } from '../src/cliHeadless.js';
import { AgentNotSupportedError } from '../src/adapter.js';
import type { AgentAdapter, AgentEvent } from '../src/adapter.js';

/* ============ 解析器测试（schema 样本来自 docs/research/04 的公开文档/社区逆向）============ */

const claudeLines = [
  '{"type":"system","subtype":"init","session_id":"abc-123","tools":["Read","Bash"],"model":"claude-x"}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"让我先看看文件"},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"a.ts"}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"file content here"}]}}',
  '{"type":"result","subtype":"success","is_error":false,"result":"任务完成：已修复 X","session_id":"abc-123","total_cost_usd":0.01,"duration_ms":100,"num_turns":1,"usage":{"input_tokens":10}}',
];

const codexLines = [
  '{"type":"thread.started","thread_id":"th-9"}',
  '{"type":"item.completed","item":{"type":"command_execution","command":"npm test","exit_code":0,"status":"completed"}}',
  '{"type":"item.completed","item":{"type":"agent_message","text":"测试全部通过，修复完成"}}',
  '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":50}}',
];

function feed(adapterDef: { parseLine?: (l: string, c: ParseContext) => void; parseBuffer?: (s: string, c: ParseContext) => void; finalFrom?: (s: string, e: AgentEvent[]) => string }, lines: string[]) {
  const ctx = createParseContext();
  for (const l of lines) {
    try {
      adapterDef.parseLine?.(l, ctx);
    } catch {
      /* 与生产一致：单行失败忽略 */
    }
  }
  const finalMessage = adapterDef.finalFrom ? adapterDef.finalFrom(lines.join('\n'), ctx.events) : '';
  return { ctx, finalMessage };
}

describe('CLI 适配器解析器（真实 schema 样本）', () => {
  it('Claude stream-json：sessionRef 捕获 + 事件归一化 + finalFrom(result)', () => {
    const a = createClaudeAdapter();
    const { ctx, finalMessage } = feed(a.def, claudeLines);
    expect(ctx.sessionRef).toBe('abc-123');
    const types = ctx.events.map((e) => e.type);
    expect(types).toContain('system');
    expect(types).toContain('message');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('result');
    expect(finalMessage).toBe('任务完成：已修复 X');
    // 提示词通道：stdin（官方管道模式），参数只含 flags
    const inv = a.def.buildRunArgs('做任务', { allowedTools: ['Read', 'Edit'], permissionFlags: ['--permission-mode', 'acceptEdits'] });
    expect(inv.stdin).toBe('做任务');
    expect(inv.args[0]).toBe('-p');
    expect(inv.args.join(' ')).toContain('--allowedTools Read,Edit');
    expect(inv.args.join(' ')).toContain('--permission-mode acceptEdits');
    expect(inv.args.join(' ')).not.toContain('做任务');
    // resume：--resume <id> + stdin
    const rinv = a.def.buildResumeArgs!('abc-123', '继续', {});
    expect(rinv.stdin).toBe('继续');
    expect(rinv.args.join(' ')).toContain('--resume abc-123');
  });

  it('Claude 坏行容错：垃圾行不炸解析器', () => {
    const a = createClaudeAdapter();
    const { ctx } = feed(a.def, ['not json at all', '{"type":"unknown-weird"}', ...claudeLines]);
    expect(ctx.sessionRef).toBe('abc-123');
  });

  it('Codex --json：thread_id 捕获 + agent_message 文本 + stdin 通道（exec -）', () => {
    const a = createCodexAdapter();
    const { ctx, finalMessage } = feed(a.def, codexLines);
    expect(ctx.sessionRef).toBe('th-9');
    expect(finalMessage).toBe('测试全部通过，修复完成');
    expect(ctx.events.some((e) => e.type === 'tool_call')).toBe(true);
    const inv = a.def.buildRunArgs('继续任务', {});
    expect(inv.stdin).toBe('继续任务');
    expect(inv.args).toContain('-');
    const rinv = a.def.buildResumeArgs!('th-9', '继续', {});
    expect(rinv.args.join(' ')).toContain('resume th-9');
    expect(rinv.stdin).toBe('继续');
    const permitted = a.def.buildResumeArgs!('th-9', '继续', { permissionFlags: ['--sandbox', 'workspace-write'] });
    expect(permitted.args.indexOf('--sandbox')).toBeLessThan(permitted.args.indexOf('resume'));
  });

  it('Gemini：短提示词位置参数；长提示词走 @file 文件通道（规避上游 stdin 重复 bug）', async () => {
    const a = createGeminiAdapter();
    const ctx = createParseContext();
    const raw = '{"response":"分析完成：问题在缓存层","stats":{"tokens":100}}';
    a.def.parseBuffer!(raw, ctx);
    const finalMessage = a.def.finalFrom!(raw, ctx.events);
    expect(finalMessage).toBe('分析完成：问题在缓存层');
    expect(ctx.sessionRef).toBeUndefined(); // 无官方 session id
    expect(a.supportsResume()).toBe(false);
    await expect(a.resume('x', 'p')).rejects.toBeInstanceOf(AgentNotSupportedError);

    const short = a.def.buildRunArgs('短任务', {});
    expect(short.args[0]).toBe('-p');
    expect(short.args).toContain('短任务');
    expect(short.filePrompt).toBeUndefined();

    const long = 'x'.repeat(8000);
    const big = a.def.buildRunArgs(long, {});
    expect(big.filePrompt).toBe(long);
    expect(big.args.join(' ')).toContain('@.agentos/PROMPT.md');
    expect(big.args.join(' ')).not.toContain(long);
  });

  it('OpenCode：stdin 通道 + sessionID 捕获 + resume 参数（注意 -p 是密码不是 prompt）', () => {
    const a = createOpencodeAdapter();
    const { ctx, finalMessage } = feed(a.def, [
      '{"type":"session","sessionID":"ses_1"}',
      '{"type":"text","part":{"type":"text","text":"opencode 完成"}}',
    ]);
    expect(ctx.sessionRef).toBe('ses_1');
    expect(finalMessage).toBe('opencode 完成');
    const inv = a.def.buildRunArgs('hello', {});
    expect(inv.args[0]).toBe('run');
    expect(inv.stdin).toBe('hello');
    expect(inv.args).not.toContain('-p');
    const rinv = a.def.buildResumeArgs!('ses_1', 'go', {});
    expect(rinv.args).toContain('--session');
    expect(rinv.args).toContain('ses_1');
  });
});

/* ============ Adapter Contract 套件（对任何 AgentAdapter 断言，见 TESTING.md）============ */

async function runAdapterContract(adapter: AgentAdapter) {
  const avail = await adapter.isAvailable();
  expect(avail.available).toBe(true);
  expect(adapter.profile.id).toBe(adapter.id);
  expect(adapter.supportsResume()).toBe(typeof adapter.resume === 'function');

  const events: AgentEvent[] = [];
  const res = await adapter.run('单元契约探针', { onEvent: (e) => events.push(e) });
  for (const e of [...events, ...res.events]) {
    expect(['system', 'message', 'tool_call', 'tool_result', 'error', 'result']).toContain(e.type);
    expect(e.agentId).toBe(adapter.id);
    expect(typeof e.ts).toBe('string');
  }
  expect(typeof res.finalMessage).toBe('string');
  expect(res.finalMessage.length).toBeGreaterThan(0);
  expect(res.sessionRef ?? null).not.toBe(undefined);
  return res;
}

describe('Adapter Contract（Stub 覆盖，真实二进制见 e2e 脚本）', () => {
  it('StubAdapter 满足契约：事件形状 / sessionRef / resume 记录', async () => {
    const stub = new StubAdapter('claude', (prompt, resumed) => ({
      events: [{ type: 'message', data: { text: resumed ? '续接' : '首次' } }],
      finalMessage: `收到: ${prompt.slice(0, 30)}`,
      sessionRef: 'stub-1',
    }));
    const res = await runAdapterContract(stub);
    expect(res.sessionRef).toBe('stub-1');
    const r2 = await stub.resume('stub-1', '继续任务');
    expect(r2.finalMessage).toContain('继续任务');
    expect(stub.calls.filter((c) => c.resumed)).toHaveLength(1);
    // opts.cwd 透传（worktree 隔离依赖它）
    await stub.run('x', { cwd: 'D:/somewhere' });
    expect(stub.calls.at(-1)!.opts?.cwd).toBe('D:/somewhere');
  });
});
