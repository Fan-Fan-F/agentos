import path from 'node:path';
import { atomicWriteJson } from '../store/jsonStore.js';
import { newId, nowIso } from '../ids.js';

/**
 * Project Memory：跨任务、跨 agent 的项目级共享记忆（架构决策/约定/事实/已知 bug/目标/约束）。
 * 用户拥有完整查看/编辑/删除权；去重 + 可导出为 Markdown。
 */

export type MemoryKind = 'decision' | 'convention' | 'fact' | 'bug' | 'goal' | 'constraint';

export interface MemoryEntry {
  id: string;
  ts: string;
  kind: MemoryKind;
  text: string;
  tags: string[];
  source?: string;
}

interface MemoryFile {
  entries: MemoryEntry[];
}

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

export class ProjectMemory {
  constructor(private readonly file: string) {}

  private async load(): Promise<MemoryFile> {
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as MemoryFile;
      return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
    } catch {
      return { entries: [] };
    }
  }

  private async save(doc: MemoryFile): Promise<void> {
    await atomicWriteJson(this.file, doc);
  }

  async add(entry: { kind: MemoryKind; text: string; tags?: string[]; source?: string }): Promise<MemoryEntry> {
    const doc = await this.load();
    const text = normalize(entry.text);
    const dup = doc.entries.find((e) => e.kind === entry.kind && normalize(e.text) === text);
    if (dup) return dup;
    const full: MemoryEntry = {
      id: newId('mem'),
      ts: nowIso(),
      kind: entry.kind,
      text: entry.text.trim(),
      tags: entry.tags ?? [],
      source: entry.source,
    };
    doc.entries.push(full);
    await this.save(doc);
    return full;
  }

  async list(filter?: { kind?: MemoryKind; tag?: string; q?: string }): Promise<MemoryEntry[]> {
    const doc = await this.load();
    let entries = doc.entries;
    if (filter?.kind) entries = entries.filter((e) => e.kind === filter.kind);
    if (filter?.tag) entries = entries.filter((e) => e.tags.includes(filter.tag as string));
    if (filter?.q) {
      const q = normalize(filter.q);
      entries = entries.filter((e) => normalize(e.text).includes(q));
    }
    return entries;
  }

  async remove(id: string): Promise<boolean> {
    const doc = await this.load();
    const before = doc.entries.length;
    doc.entries = doc.entries.filter((e) => e.id !== id);
    if (doc.entries.length === before) return false;
    await this.save(doc);
    return true;
  }

  async exportMarkdown(): Promise<string> {
    const entries = await this.list();
    const byKind = new Map<string, MemoryEntry[]>();
    for (const e of entries) {
      const arr = byKind.get(e.kind) ?? [];
      arr.push(e);
      byKind.set(e.kind, arr);
    }
    const titles: Record<string, string> = {
      decision: '架构决策',
      convention: '编码约定',
      fact: '重要事实',
      bug: '已知 Bug',
      goal: '项目目标',
      constraint: '用户约束',
    };
    const lines = ['# Project Memory', ''];
    for (const [kind, arr] of byKind) {
      lines.push(`## ${titles[kind] ?? kind}`);
      lines.push(...arr.map((e) => `- ${e.text}${e.source ? `（来源: ${e.source}）` : ''}`));
      lines.push('');
    }
    return lines.join('\n');
  }
}
