import { CliHeadlessAdapter, type PromptInvocation } from '../cliHeadless.js';
import { profileFor } from '../catalog.js';

/**
 * Gemini CLI 适配器（-p + --output-format json，单块 JSON 而非 JSONL）。
 * 无头模式没有官方 session_id 字段 → 原生 resume 不启用，热切换走 Capsule 通道（docs/research/04 §3）。
 *
 * 提示词通道：短提示词走位置参数；长提示词（交接包）写入 `<cwd>/.agentos/PROMPT.md`
 * 并用官方 @file 引用（`-p "...@.agentos/PROMPT.md"`）—— 规避 Windows 命令行上限，
 * 也避开上游「stdin 与 -p 组合导致内容重复」的已知 bug。
 */
const INLINE_PROMPT_LIMIT = 6000;

export function createGeminiAdapter(binary = 'gemini'): CliHeadlessAdapter {
  return new CliHeadlessAdapter({
    id: 'gemini',
    profile: profileFor('gemini'),
    binary,
    npmPackage: '@google/gemini-cli',
    buildRunArgs(prompt, opts): PromptInvocation {
      const flags = [
        '--output-format',
        'json',
        ...(opts?.permissionFlags ?? []),
        ...(opts?.model ? ['-m', opts.model] : []),
        ...(opts?.extraArgs ?? []),
      ];
      if (prompt.length <= INLINE_PROMPT_LIMIT) {
        return { args: ['-p', prompt, ...flags] };
      }
      return {
        args: ['-p', '请读取 @.agentos/PROMPT.md，其中包含完整任务说明与上下文，然后完成该任务。', ...flags],
        filePrompt: prompt,
      };
    },
    parseBuffer(stdout, ctx) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(stdout) as Record<string, unknown>;
      } catch {
        return;
      }
      const err = obj['error'] as Record<string, unknown> | undefined;
      if (err) {
        ctx.push('error', { message: (err['message'] as string) ?? String(obj['error']), code: err['code'] });
      }
      if (typeof obj['response'] === 'string') {
        ctx.push('message', { text: obj['response'] as string });
      }
      if (obj['stats']) ctx.push('result', { stats: obj['stats'] });
    },
    finalFrom(stdout, events) {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]!;
        const text = e.data['text'];
        if (typeof text === 'string' && text.trim()) return text;
      }
      return stdout.trim().slice(-4000);
    },
  });
}
