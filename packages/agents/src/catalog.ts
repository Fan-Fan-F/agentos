import type { AgentProfile, AgentSkill } from '@agentos/core';

/**
 * Agent 目录（插件 Manifest 的内置实现，见任务书 §23）。
 * skills 为 0-1 的能力估计（依据 docs/research/04 与公开评测，非精确值）。
 */

export interface AgentCatalogEntry {
  id: string;
  name: string;
  binaries: string[];
  npmPackage?: string;
  /** 家目录存在性标记（仅 stat，绝不读内容） */
  homeMarkers: string[];
  /** 任一存在即视为"已登录标记"（同样是只 stat） */
  authMarkers: string[];
  protocols: AgentProfile['protocols'];
  capabilities: AgentProfile['capabilities'];
  skills: Partial<Record<AgentSkill, number>>;
  install: { command: string; note: string } | null;
  docsUrl: string;
}

export const AGENT_CATALOG: AgentCatalogEntry[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    binaries: ['claude'],
    npmPackage: '@anthropic-ai/claude-code',
    homeMarkers: ['.claude', '.claude.json'],
    authMarkers: ['.claude.json', '.claude/.credentials.json'],
    protocols: ['cli', 'acp', 'sdk'],
    capabilities: { headless: true, resume: true, jsonStream: true, mcp: true, hooks: true },
    skills: { coding: 0.95, planning: 0.9, debugging: 0.9, review: 0.9, testing: 0.85, largeContext: 0.8, speed: 0.6, costEfficiency: 0.5 },
    install: { command: 'npm install -g @anthropic-ai/claude-code', note: '官方 npm 包；安装与登录均由 Anthropic 官方流程完成' },
    docsUrl: 'https://code.claude.com/docs',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    binaries: ['codex'],
    npmPackage: '@openai/codex',
    homeMarkers: ['.codex'],
    authMarkers: ['.codex/auth.json'],
    protocols: ['cli', 'acp'],
    capabilities: { headless: true, resume: true, jsonStream: true, mcp: true, hooks: false },
    skills: { coding: 0.9, planning: 0.75, debugging: 0.85, review: 0.8, testing: 0.8, largeContext: 0.7, speed: 0.7, costEfficiency: 0.6 },
    install: { command: 'npm install -g @openai/codex', note: '官方 npm 包；登录由 OpenAI 官方流程完成' },
    docsUrl: 'https://developers.openai.com/codex/cli',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    binaries: ['gemini'],
    npmPackage: '@google/gemini-cli',
    homeMarkers: ['.gemini'],
    authMarkers: ['.gemini/oauth_creds.json'],
    protocols: ['cli', 'acp'],
    capabilities: { headless: true, resume: false, jsonStream: false, mcp: true, hooks: false },
    skills: { coding: 0.8, planning: 0.75, debugging: 0.75, review: 0.75, testing: 0.7, largeContext: 1.0, speed: 0.6, costEfficiency: 0.8 },
    install: { command: 'npm install -g @google/gemini-cli', note: '官方 npm 包；登录由 Google 官方流程完成' },
    docsUrl: 'https://geminicli.com/docs',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    binaries: ['opencode'],
    npmPackage: 'opencode-ai',
    homeMarkers: ['.local/share/opencode'],
    authMarkers: ['.local/share/opencode/auth.json'],
    protocols: ['cli', 'acp', 'api'],
    capabilities: { headless: true, resume: true, jsonStream: true, mcp: true, hooks: false },
    skills: { coding: 0.8, planning: 0.7, debugging: 0.75, review: 0.7, testing: 0.7, largeContext: 0.7, speed: 0.7, costEfficiency: 0.7 },
    install: { command: 'npm install -g opencode-ai', note: '官方 npm 包；模型 provider 由 opencode.json 配置' },
    docsUrl: 'https://opencode.ai/docs',
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    binaries: ['qwen'],
    npmPackage: '@qwen-code/qwen-code',
    homeMarkers: ['.qwen'],
    authMarkers: ['.qwen/oauth_creds.json'],
    protocols: ['cli'],
    capabilities: { headless: true, resume: false, jsonStream: false, mcp: true, hooks: false },
    skills: { coding: 0.75, planning: 0.65, debugging: 0.7, review: 0.65, testing: 0.65, largeContext: 0.9, speed: 0.7, costEfficiency: 0.9 },
    install: { command: 'npm install -g @qwen-code/qwen-code', note: '官方 npm 包' },
    docsUrl: 'https://github.com/QwenLM/qwen-code',
  },
  {
    id: 'kimi',
    name: 'Kimi CLI',
    binaries: ['kimi'],
    homeMarkers: ['.kimi'],
    authMarkers: ['.kimi'],
    protocols: ['cli', 'acp'],
    capabilities: { headless: true, resume: false, jsonStream: false, mcp: true, hooks: false },
    skills: { coding: 0.7, planning: 0.65, debugging: 0.65, review: 0.65, testing: 0.6, largeContext: 0.8, speed: 0.7, costEfficiency: 0.9 },
    install: { command: 'uv tool install kimi-cli', note: 'Moonshot 官方（uv 工具链）' },
    docsUrl: 'https://github.com/MoonshotAI/kimi-cli',
  },
  {
    id: 'aider',
    name: 'Aider',
    binaries: ['aider'],
    homeMarkers: ['.aider*'],
    authMarkers: ['.aider.conf.yml'],
    protocols: ['cli'],
    capabilities: { headless: true, resume: false, jsonStream: false, mcp: false, hooks: false },
    skills: { coding: 0.75, planning: 0.5, debugging: 0.7, review: 0.6, testing: 0.6, largeContext: 0.6, speed: 0.8, costEfficiency: 0.8 },
    install: { command: 'python -m pip install aider-install && aider-install', note: '官方安装器（pipx/uv 均可）' },
    docsUrl: 'https://aider.chat/docs',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    binaries: ['copilot'],
    npmPackage: '@github/copilot',
    homeMarkers: ['.copilot'],
    authMarkers: ['.config/github-copilot'],
    protocols: ['cli'],
    capabilities: { headless: true, resume: false, jsonStream: false, mcp: true, hooks: false },
    skills: { coding: 0.75, planning: 0.6, debugging: 0.65, review: 0.7, testing: 0.65, largeContext: 0.6, speed: 0.7, costEfficiency: 0.8 },
    install: { command: 'npm install -g @github/copilot', note: '官方 npm 包' },
    docsUrl: 'https://docs.github.com/copilot/concepts/agents/about-copilot-cli',
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent CLI',
    binaries: ['cursor-agent'],
    npmPackage: '@cursor/agent',
    homeMarkers: ['.cursor'],
    authMarkers: ['.cursor'],
    protocols: ['cli'],
    capabilities: { headless: true, resume: false, jsonStream: false, mcp: true, hooks: false },
    skills: { coding: 0.8, planning: 0.65, debugging: 0.7, review: 0.65, testing: 0.65, largeContext: 0.7, speed: 0.7, costEfficiency: 0.6 },
    install: { command: 'npm install -g @cursor/agent', note: '官方 npm 包（npm 包名以官方文档为准）' },
    docsUrl: 'https://cursor.com/docs/cli',
  },
  {
    id: 'droid',
    name: 'Factory Droid',
    binaries: ['droid'],
    homeMarkers: ['.factory'],
    authMarkers: ['.factory'],
    protocols: ['cli'],
    capabilities: { headless: true, resume: false, jsonStream: false, mcp: true, hooks: false },
    skills: { coding: 0.8, planning: 0.65, debugging: 0.7, review: 0.65, testing: 0.65, largeContext: 0.7, speed: 0.7, costEfficiency: 0.7 },
    install: { command: 'curl -fsSL https://app.factory.ai/cli | sh', note: 'Factory 官方安装脚本' },
    docsUrl: 'https://docs.factory.ai',
  },
  {
    id: 'amp',
    name: 'Sourcegraph Amp',
    binaries: ['amp'],
    npmPackage: '@sourcegraph/amp',
    homeMarkers: ['.config/amp'],
    authMarkers: ['.config/amp'],
    protocols: ['cli'],
    capabilities: { headless: true, resume: false, jsonStream: true, mcp: true, hooks: false },
    skills: { coding: 0.8, planning: 0.65, debugging: 0.7, review: 0.75, testing: 0.65, largeContext: 0.8, speed: 0.7, costEfficiency: 0.6 },
    install: { command: 'npm install -g @sourcegraph/amp', note: '官方 npm 包（包名以官方文档为准）' },
    docsUrl: 'https://ampcode.com/manual',
  },
  {
    id: 'crush',
    name: 'Charm Crush',
    binaries: ['crush'],
    homeMarkers: ['.config/crush'],
    authMarkers: ['.config/crush'],
    protocols: ['cli'],
    capabilities: { headless: true, resume: false, jsonStream: false, mcp: true, hooks: false },
    skills: { coding: 0.7, planning: 0.6, debugging: 0.65, review: 0.65, testing: 0.6, largeContext: 0.6, speed: 0.75, costEfficiency: 0.7 },
    install: null,
    docsUrl: 'https://github.com/charmbracelet/crush',
  },
];

export function catalogEntry(agentId: string): AgentCatalogEntry | undefined {
  return AGENT_CATALOG.find((e) => e.id === agentId);
}

/** 内置 agent 的 profile（含 skills），未知 id 返回通用 profile。 */
export function profileFor(agentId: string): AgentProfile {
  const entry = catalogEntry(agentId);
  if (entry) {
    return { id: entry.id, name: entry.name, protocols: entry.protocols, capabilities: entry.capabilities, skills: entry.skills };
  }
  return {
    id: agentId,
    name: agentId,
    protocols: ['cli'],
    capabilities: { headless: true, resume: false, jsonStream: false, mcp: false, hooks: false },
    skills: { coding: 0.5, planning: 0.5, debugging: 0.5, review: 0.5, testing: 0.5 },
  };
}
