import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanAgents } from '../src/discovery.js';
import { findInPath } from '../src/where.js';
import { planInstall } from '../src/installer.js';

/**
 * 发现测试（ADR-006）：只造 fake 的 PATH 目录与家目录标记，
 * 全程不执行任何真实 agent 二进制 —— 与生产环境的只读扫描完全同路径。
 */
function fakeEnv() {
  const home = mkdtempSync(path.join(tmpdir(), 'agentos-home-'));
  const binDir = mkdtempSync(path.join(tmpdir(), 'agentos-bin-'));
  const npmRoot = mkdtempSync(path.join(tmpdir(), 'agentos-npm-'));
  // Windows 上 npm shim 是 .cmd；同时造无扩展名文件兼容 unix
  const shim = (name: string) => {
    writeFileSync(path.join(binDir, name + '.cmd'), 'echo fake\r\n');
    writeFileSync(path.join(binDir, name), '#!/bin/sh\necho fake\n');
  };
  shim('claude');
  shim('codex');
  // gemini 只留家目录标记（CLI 未装）
  mkdirSync(path.join(home, '.gemini'), { recursive: true });
  // claude 登录标记
  writeFileSync(path.join(home, '.claude.json'), '{}');
  // npm 全局里装过 opencode（scope 包目录）
  mkdirSync(path.join(npmRoot, 'opencode-ai'), { recursive: true });
  return { home, binDir, npmRoot };
}

describe('Agent Discovery（只读）', () => {
  it('PATH shim + 家目录标记 + npm 全局 三路发现', async () => {
    const { home, binDir, npmRoot } = fakeEnv();
    const agents = await scanAgents({
      homeDir: home,
      pathEnv: binDir,
      npmGlobalRoot: npmRoot,
      probe: false, // 绝不执行 --version
    });

    const claude = agents.find((a) => a.id === 'claude')!;
    expect(claude.status).toBe('installed');
    expect(claude.binaries.length).toBeGreaterThan(0);
    expect(claude.auth).toBe('ok');
    expect(claude.homeMarkersFound).toContain('.claude.json');
    expect(claude.capabilities.resume).toBe(true);

    const codex = agents.find((a) => a.id === 'codex')!;
    expect(codex.status).toBe('installed');
    expect(codex.auth).toBe('unknown'); // 没有 auth.json 标记

    const gemini = agents.find((a) => a.id === 'gemini')!;
    expect(gemini.status).toBe('not-installed');
    expect(gemini.homeMarkersFound).toContain('.gemini');

    const opencode = agents.find((a) => a.id === 'opencode')!;
    expect(opencode.status).toBe('not-installed');
    expect(opencode.installSource).toBe('npm');
  });

  it('findInPath 尊重 PATH 顺序且只 stat 不执行', () => {
    const { binDir } = fakeEnv();
    const hits = findInPath('claude', binDir);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.startsWith(binDir)).toBe(true);
    expect(findInPath('does-not-exist-xyz', binDir)).toEqual([]);
  });

  it('安装计划只来自官方源，且强制要求确认', () => {
    const plan = planInstall('claude')!;
    expect(plan.source).toBe('official npm registry');
    expect(plan.command).toBe('npm install -g @anthropic-ai/claude-code');
    expect(plan.requiresConfirmation).toBe(true);
    expect(planInstall('crush')).toBeUndefined(); // 无官方 npm 方案的 agent
  });
});
