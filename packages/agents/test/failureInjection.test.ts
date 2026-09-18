import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliHeadlessAdapter, createParseContext } from '../src/cliHeadless.js';
import { profileFor } from '../src/catalog.js';
import { spawnCapture } from '../src/spawn.js';

/**
 * 故障注入（任务书 §10）：用自造的临时"假 agent"二进制注入真实故障，
 * 验证产品行为：超时杀进程树、缺失二进制的清晰报错、malformed 输出容错。
 * 这些是真实的子进程故障，不是 mock —— 进程、管道、超时全部真实。
 */

function makeFakeAgent(dir: string, script: string): { binary: string; ext: string[] } {
  if (process.platform === 'win32') {
    const bin = path.join(dir, 'fakeagent.cmd');
    writeFileSync(bin, `@echo off\r\n${script}\r\n`);
    return { binary: bin, ext: ['.cmd'] };
  }
  const bin = path.join(dir, 'fakeagent');
  writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  chmodSync(bin, 0o755);
  return { binary: bin, ext: [''] };
}

function adapterWith(binary: string): CliHeadlessAdapter {
  return new CliHeadlessAdapter({
    id: 'fake',
    profile: profileFor('fake'),
    binary,
    buildRunArgs: () => ({ args: [] }),
    // 与真实 agent 相同的容错解析器（system/result/thread.started 三种形状）
    parseLine(line, ctx) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return; // 垃圾行忽略
      }
      if (obj['type'] === 'system' && obj['subtype'] === 'init') {
        if (typeof obj['session_id'] === 'string') ctx.sessionRef = obj['session_id'];
        ctx.push('system', { sessionId: obj['session_id'] });
      } else if (obj['type'] === 'result') {
        if (typeof obj['session_id'] === 'string') ctx.sessionRef = obj['session_id'];
        ctx.push('result', {});
      } else if (obj['type'] === 'thread.started') {
        if (typeof obj['thread_id'] === 'string') ctx.sessionRef = obj['thread_id'];
        ctx.push('system', { threadId: obj['thread_id'] });
      }
    },
  });
}

describe('故障注入：无头进程', () => {
  it('超时：挂死进程被强杀，已产出的事件不丢失，timedOut=true', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agentos-kill-'));
    // 注意：Windows 的 `timeout /t` 在 stdin 重定向下会立即退出（经典陷阱），用 ping 模拟睡眠
    const sleepCmd = process.platform === 'win32' ? 'ping -n 30 127.0.0.1 >nul' : 'sleep 30';
    const echoCmd =
      process.platform === 'win32'
        ? 'echo {"type":"system","subtype":"init","session_id":"s-timeout"}'
        : `echo '{"type":"system","subtype":"init","session_id":"s-timeout"}'`;
    const { binary } = makeFakeAgent(dir, `${echoCmd}\n${sleepCmd}`);
    const adapter = adapterWith(binary);

    const events: unknown[] = [];
    const res = await adapter.run('做点事', { timeoutMs: 2500, onEvent: (e) => events.push(e) });

    expect(res.timedOut).toBe(true);
    expect(res.events.length).toBe(1);
    expect(res.events[0]!.data['sessionId']).toBe('s-timeout');
    expect(res.durationMs).toBeLessThan(15000); // 没有等满 30s
  }, 20000);

  it('缺失二进制：报错清晰可行动（指引 doctor），而非晦涩 ENOENT', async () => {
    const adapter = adapterWith('definitely-not-exists-xyz-agentos');
    await expect(adapter.run('x')).rejects.toThrow(/未找到.*doctor/s);
  });

  it('malformed 输出：垃圾行被忽略，合法行正常解析', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agentos-garbage-'));
    const echo =
      process.platform === 'win32'
        ? 'echo not-json-garbage && echo {"type":"thread.started","thread_id":"th-ok"} && echo [{"broken":'
        : `echo 'not-json-garbage'; echo '{"type":"thread.started","thread_id":"th-ok"}'; echo '[{"broken":'`;
    const { binary } = makeFakeAgent(dir, echo);
    const adapter = adapterWith(binary);

    const res = await adapter.run('x', { timeoutMs: 15000 });
    expect(res.sessionRef).toBe('th-ok');
    expect(res.events.length).toBe(1);
  }, 20000);

  it('stderr 旁路：stderr 内容进入 stderrTail 供诊断，不影响 stdout 解析', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agentos-stderr-'));
    const script =
      process.platform === 'win32'
        ? 'echo WARN: something to stderr 1>&2 && echo {"type":"result","session_id":"s-e"}'
        : `echo 'WARN: something to stderr' >&2; echo '{"type":"result","session_id":"s-e"}'`;
    const { binary } = makeFakeAgent(dir, script);
    const res = await adapterWith(binary).run('x', { timeoutMs: 15000 });
    expect(res.sessionRef).toBe('s-e');
    expect(res.stderrTail).toContain('WARN');
  }, 20000);

  it('spawnCapture：stdin 关闭语义（防 codex exec 挂起的合同保障）', async () => {
    // 用 node -e 假进程读取 stdin 并回显（跨平台、不经 .cmd —— .cmd 必须走 launcher 层）
    const script = `let n=0;process.stdin.on('data',c=>n+=c.length);process.stdin.on('end',()=>{console.log('got-stdin:'+n)})`;
    const res = await spawnCapture(process.execPath, ['-e', script], { timeoutMs: 10000, stdin: 'hello' });
    expect(res.timedOut).toBe(false);
    expect(res.stdout).toContain('got-stdin:5');
  }, 20000);

  it('ParseContext 工厂：坏行注入不抛异常（解析器合同）', () => {
    const ctx = createParseContext();
    expect(() => {
      ctx.push('message', { text: 'ok' });
    }).not.toThrow();
    expect(ctx.events).toHaveLength(1);
  });
});
