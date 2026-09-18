import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectMemory } from '../src/memory/project.js';

describe('ProjectMemory（共享记忆）', () => {
  it('添加 / 去重 / 过滤 / 删除 / 导出', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'agentos-mem-')), 'memory.json');
    const mem = new ProjectMemory(file);

    const e1 = await mem.add({ kind: 'decision', text: '使用 pnpm 工作区', source: 'ADR-001' });
    const dup = await mem.add({ kind: 'decision', text: '使用 pnpm 工作区' });
    expect(dup.id).toBe(e1.id); // 去重
    await mem.add({ kind: 'decision', text: 'API 层不直接读数据库' });
    await mem.add({ kind: 'bug', text: 'worktree 下 node_modules 需重装', tags: ['windows'] });

    expect((await mem.list()).length).toBe(3);
    expect((await mem.list({ kind: 'decision' })).length).toBe(2);
    expect((await mem.list({ tag: 'windows' })).length).toBe(1);
    expect((await mem.list({ q: 'pnpm' })).length).toBe(1);

    expect(await mem.remove(e1.id)).toBe(true);
    expect((await mem.list()).length).toBe(2);

    const md = await mem.exportMarkdown();
    expect(md).toContain('# Project Memory');
    expect(md).toContain('API 层不直接读数据库');
    expect(md).toContain('已知 Bug');
  });

  it('跨实例（重启）记忆仍在', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'agentos-mem-')), 'memory.json');
    await new ProjectMemory(file).add({ kind: 'goal', text: '做成本地优先平台' });
    const list = await new ProjectMemory(file).list();
    expect(list[0]!.text).toBe('做成本地优先平台');
  });
});
