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
  private needsBoundaryCheck = true;
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
    let prefix = '';
    if (this.needsBoundaryCheck) {
      try {
        const handle = await fsp.open(this.file, 'r');
        try {
          const { size } = await handle.stat();
          if (size > 0) {
            const last = Buffer.alloc(1);
            await handle.read(last, 0, 1, size - 1);
            if (last[0] !== 10) prefix = '\n';
          }
        } finally {
          await handle.close();
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    // Keep crash evidence, but separate an incomplete tail from the next event.
    await fsp.appendFile(this.file, prefix + JSON.stringify(evt) + '\n', 'utf8');
    this.needsBoundaryCheck = false;
    this.emitter.emit('event', evt);
    return evt;
  }

  async readAll(): Promise<TimelineEvent[]> {
    await this.chain;
    let raw: string;
    try {
      raw = await fsp.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: TimelineEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const event = parsed as Record<string, unknown>;
        if (!['id', 'ts', 'taskId', 'actor', 'type'].every(key =>
          typeof event[key] === 'string' && event[key].length > 0,
        )) continue;
        out.push(event as unknown as TimelineEvent);
      } catch {
        // Skip malformed records in memory; never rewrite the original crash evidence.
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
