import type { AgentRunOptions } from '../adapter.js';
import { CliHeadlessAdapter, type PromptInvocation } from '../cliHeadless.js';
import { profileFor } from '../catalog.js';

function buildClaudeArgs(opts?: AgentRunOptions): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    ...(opts?.model ? ['--model', opts.model] : []),
    ...(opts?.allowedTools?.length ? ['--allowedTools', opts.allowedTools.join(',')] : []),
    ...(opts?.permissionFlags ?? []),
    ...(opts?.extraArgs ?? []),
  ];
}

/**
 * Claude Code 适配器（stream-json；session_id 来自 system/init 与 result 事件，见 docs/research/04 §1）。
 * 提示词走 stdin（官方管道模式：`cat prompt | claude -p --output-format stream-json`），
 * 避开 Windows 命令行长度上限与转义问题。
 */
export function createClaudeAdapter(binary = 'claude'): CliHeadlessAdapter {
  return new CliHeadlessAdapter({
    id: 'claude',
    profile: profileFor('claude'),
    binary,
    npmPackage: '@anthropic-ai/claude-code',
    buildRunArgs(prompt, opts): PromptInvocation {
      return {
        args: buildClaudeArgs(opts),
        stdin: prompt,
      };
    },
    buildResumeArgs(sessionRef, prompt, opts): PromptInvocation {
      return {
        args: ['--resume', sessionRef, ...buildClaudeArgs(opts)],
        stdin: prompt,
      };
    },
    parseLine(line, ctx) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (obj['type'] === 'system' && obj['subtype'] === 'init') {
        const sid = obj['session_id'];
        if (typeof sid === 'string') ctx.sessionRef = sid;
        ctx.push('system', { sessionId: sid, model: obj['model'], tools: obj['tools'] });
        return;
      }
      if (obj['type'] === 'assistant') {
        const message = obj['message'] as { content?: Array<Record<string, unknown>> } | undefined;
        const content = message?.content ?? [];
        const texts: string[] = [];
        for (const block of content) {
          if (block['type'] === 'text' && typeof block['text'] === 'string') {
            texts.push(block['text'] as string);
          } else if (block['type'] === 'tool_use') {
            ctx.push('tool_call', { id: block['id'], name: block['name'], input: block['input'] });
          }
        }
        if (texts.length) ctx.push('message', { text: texts.join('\n') });
        return;
      }
      if (obj['type'] === 'user') {
        const message = obj['message'] as { content?: unknown } | undefined;
        const content = Array.isArray(message?.content) ? (message?.content as Array<Record<string, unknown>>) : [];
        for (const block of content) {
          if (block['type'] === 'tool_result') {
            ctx.push('tool_result', {
              id: block['tool_use_id'],
              isError: block['is_error'] === true,
              content: typeof block['content'] === 'string' ? (block['content'] as string).slice(0, 2000) : undefined,
            });
          }
        }
        return;
      }
      if (obj['type'] === 'result') {
        const sid = obj['session_id'];
        if (typeof sid === 'string') ctx.sessionRef = sid;
        ctx.push('result', {
          subtype: obj['subtype'],
          result: obj['result'],
          isError: obj['is_error'] === true,
          costUsd: obj['total_cost_usd'],
          durationMs: obj['duration_ms'],
          numTurns: obj['num_turns'],
          usage: obj['usage'],
        });
      }
    },
    finalFrom(stdout, events) {
      const resultEvt = [...events].reverse().find((e) => e.type === 'result');
      const r = resultEvt?.data['result'];
      if (typeof r === 'string' && r.trim()) return r;
      return stdout.trim().slice(-4000);
    },
  });
}
