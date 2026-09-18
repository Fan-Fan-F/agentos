import { newId, nowIso } from '../ids.js';

/**
 * Agent Message Bus（M1 基线）：记录 agent 间结构化消息（ask/delegate/review/approve/reject…）。
 * 语义与 A2A Task/Message 概念对齐；本地同机 MVP 由 TaskRunner 驱动执行，
 * 未来 A2A Bridge 可把 Bus 消息桥接为 A2A message/send。
 */

export type BusMessageType =
  | 'ask'
  | 'delegate'
  | 'review'
  | 'challenge'
  | 'approve'
  | 'reject'
  | 'return-task'
  | 'request-evidence'
  | 'artifact'
  | 'diff'
  | 'test-result';

export interface BusMessage {
  id: string;
  ts: string;
  from: string;
  to: string;
  type: BusMessageType;
  taskId?: string;
  payload: unknown;
  reply?: unknown;
  repliedAt?: string;
}

export type BusListener = (msg: BusMessage) => void;

export class MessageBus {
  private listeners = new Set<BusListener>();
  private log: BusMessage[] = [];

  subscribe(fn: BusListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  publish(msg: Omit<BusMessage, 'id' | 'ts'>): BusMessage {
    const full: BusMessage = { id: newId('msg'), ts: nowIso(), ...msg };
    this.log.push(full);
    for (const fn of this.listeners) fn(full);
    return full;
  }

  recordReply(messageId: string, reply: unknown): BusMessage | undefined {
    const msg = this.log.find((m) => m.id === messageId);
    if (!msg) return undefined;
    msg.reply = reply;
    msg.repliedAt = nowIso();
    return msg;
  }

  history(filter?: { taskId?: string; from?: string; to?: string }): BusMessage[] {
    return this.log.filter(
      (m) =>
        (!filter?.taskId || m.taskId === filter.taskId) &&
        (!filter?.from || m.from === filter.from) &&
        (!filter?.to || m.to === filter.to),
    );
  }
}
