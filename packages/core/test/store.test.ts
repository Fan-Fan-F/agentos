import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonStore, atomicWriteJson } from '../src/store/jsonStore.js';
import { EventLog } from '../src/timeline/log.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'agentos-store-'));

describe('JsonStore（ADR-002）', () => {
  it('put/get/all/roundtrip + 跨实例读取（崩溃恢复基础）', async () => {
    const dir = tmp();
    const s1 = new JsonStore<{ id: string; v: number }>(dir);
    await s1.put({ id: 'a', v: 1 });
    await s1.put({ id: 'b', v: 2 });
    // 覆盖写
    await s1.put({ id: 'a', v: 10 });
    const s2 = new JsonStore<{ id: string; v: number }>(dir); // 模拟重启
    expect(await s2.get('a')).toEqual({ id: 'a', v: 10 });
    const all = await s2.all();
    expect(all).toHaveLength(2);
    expect(await s2.delete('b')).toBe(true);
    expect(await s2.get('b')).toBeUndefined();
  });

  it('get 不存在的 id 返回 undefined 而不是抛错', async () => {
    const s = new JsonStore<{ id: string }>(tmp());
    expect(await s.get('nope')).toBeUndefined();
  });

  it('atomicWriteJson 覆盖已存在文件（Windows rename 语义）', async () => {
    const file = path.join(tmp(), 'x.json');
    await atomicWriteJson(file, { a: 1 });
    await atomicWriteJson(file, { a: 2 });
    const s = new JsonStore<{ a: number }>(path.dirname(file));
    expect(await s.get('x')).toEqual({ a: 2 });
  });
});

describe('EventLog（统一 Timeline）', () => {
  it('追加 → 重读 → since 过滤；半行容错', async () => {
    const file = path.join(tmp(), 'events.jsonl');
    const log = new EventLog(file);
    const e1 = await log.append('t1', 'system', 'task.created', {});
    const e2 = await log.append('t1', 'claude', 'agent.message', { text: 'hi' });
    expect(e1.id).not.toBe(e2.id);

    const log2 = new EventLog(file); // 模拟重启
    const all = await log2.readAll();
    expect(all).toHaveLength(2);
    const since = await log2.since(e1.id);
    expect(since.map((e) => e.id)).toEqual([e2.id]);

    // 半行（崩溃瞬间写入中断）容忍
    const { appendFileSync } = await import('node:fs');
    appendFileSync(file, '{"id":"broken","ts":"x"');
    expect((await log2.readAll()).length).toBe(2);
  });

  it('subscribe 收到新事件并可退订', async () => {
    const log = new EventLog(path.join(tmp(), 'events.jsonl'));
    const seen: string[] = [];
    const un = log.subscribe((e) => seen.push(e.type));
    await log.append('t', 'a', 'evt.a');
    un();
    await log.append('t', 'a', 'evt.b');
    expect(seen).toEqual(['evt.a']);
  });
});
