import { createClaudeAdapter } from './adapters/claude.js';
import { createCodexAdapter } from './adapters/codex.js';
import { createGeminiAdapter } from './adapters/gemini.js';
import { createOpencodeAdapter } from './adapters/opencode.js';

export * from './adapter.js';
export * from './stub.js';
export * from './cliHeadless.js';
export * from './adapters/claude.js';
export * from './adapters/codex.js';
export * from './adapters/gemini.js';
export * from './adapters/opencode.js';
export * from './catalog.js';
export * from './discovery.js';
export * from './installer.js';
export * from './handoff.js';
export * from './runner.js';
export * from './spawn.js';
export * from './where.js';
export * from './acp/jsonrpc.js';
export * from './acp/client.js';

/** 默认适配器组：四家 headless CLI（未安装的 agent 在 run 时给出明确错误，discovery 会提前提示）。 */
export function createDefaultAdapters(): Array<ReturnType<typeof createClaudeAdapter> | ReturnType<typeof createCodexAdapter> | ReturnType<typeof createGeminiAdapter> | ReturnType<typeof createOpencodeAdapter>> {
  return [createClaudeAdapter(), createCodexAdapter(), createGeminiAdapter(), createOpencodeAdapter()];
}
