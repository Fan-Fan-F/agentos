import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { newId, nowIso } from '../ids.js';
import type { TimelineEvent } from '../types.js';
import { ensureDir } from '../store/jsonStore.js';

/**
 * 统一 Timeline：每任务一个追加写 JSONL 文件 + 内存订阅（WS 推送）。
 * 崩溃恢复 = 直接重读文件。
 */
export class EventLog {
  private emitter = new EventEmitter();
  /** 追加串行化：并行 fork 时避免 JSONL 行交错 */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {
    ensureDir(path.dirname(file));
    this.emitter.setMaxListeners(50);
  }

  get filePath(): string {
    return this.file;
  }

  async append(taskId: string, actor: string, type: string, payload?: unknown): Promise<TimelineEvent> {
    const run = this.chain.then(() => this.doAppend(taskId, actor, type, payload));
    this.chain = run.catch(() => {});
    return run;
  }

  private async doAppend(taskId: string, actor: string, type: string, payload?: unknown): Promise<TimelineEvent> {
    const evt: TimelineEvent = { id: newId('evt'), ts: nowIso(), taskId, actor, type, payload };
    await fsp.appendFile(this.file, JSON.stringify(evt) + '\n', 'utf8');
    this.emitter.emit('event', evt);
    return evt;
  }

  async readAll(): Promise<TimelineEvent[]> {
    let raw: string;
    try {
      raw = await fsp.readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    const out: TimelineEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as TimelineEvent);
      } catch {
        // 尾部半行（崩溃瞬间）容忍跳过
      }
    }
    return out;
  }

  async since(sinceEventId: string): Promise<TimelineEvent[]> {
    const all = await this.readAll();
    const idx = all.findIndex((e) => e.id === sinceEventId);
    return idx >= 0 ? all.slice(idx + 1) : all;
  }

  subscribe(fn: (evt: TimelineEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
}
