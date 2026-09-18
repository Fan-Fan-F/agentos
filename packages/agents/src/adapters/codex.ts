import { CliHeadlessAdapter, type PromptInvocation } from '../cliHeadless.js';
import { profileFor } from '../catalog.js';

/**
 * Codex CLI 适配器（codex exec --json；thread_id 来自 thread.started，见 docs/research/04 §2）。
 * 提示词走 stdin（官方 `codex exec -`；stdin 必须关闭否则会挂起 —— spawn 层统一 end()）。
 */
export function createCodexAdapter(binary = 'codex'): CliHeadlessAdapter {
  return new CliHeadlessAdapter({
    id: 'codex',
    profile: profileFor('codex'),
    binary,
    npmPackage: '@openai/codex',
    buildRunArgs(prompt, opts): PromptInvocation {
      return {
        args: [
          'exec',
          '--json',
          '--skip-git-repo-check',
          ...(opts?.permissionFlags ?? []),
          ...(opts?.model ? ['-m', opts.model] : []),
          ...(opts?.extraArgs ?? []),
          '-',
        ],
        stdin: prompt,
      };
    },
    buildResumeArgs(sessionRef, prompt, opts): PromptInvocation {
      return {
        args: [
          'exec',
          'resume',
          sessionRef,
          '--json',
          ...(opts?.permissionFlags ?? []),
          ...(opts?.extraArgs ?? []),
          '-',
        ],
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
      switch (obj['type']) {
        case 'thread.started': {
          const tid = obj['thread_id'];
          if (typeof tid === 'string') ctx.sessionRef = tid;
          ctx.push('system', { threadId: tid });
          break;
        }
        case 'item.completed': {
          const item = (obj['item'] ?? {}) as Record<string, unknown>;
          const t = (item['type'] ?? item['item_type']) as string | undefined;
          if (t === 'agent_message') {
            const text = item['text'] ?? item['content'];
            if (typeof text === 'string') ctx.push('message', { text });
          } else if (t === 'command_execution') {
            ctx.push('tool_call', { command: item['command'], exitCode: item['exit_code'], status: item['status'] });
          } else if (t === 'file_change') {
            ctx.push('tool_call', { fileChange: item['changes'] ?? item });
          } else if (t === 'mcp_tool_call') {
            ctx.push('tool_call', { tool: item['tool'], server: item['server'] });
          }
          break;
        }
        case 'turn.completed': {
          ctx.push('result', { usage: obj['usage'] });
          break;
        }
        case 'turn.failed':
        case 'error': {
          const err = obj['error'] as Record<string, unknown> | undefined;
          ctx.push('error', {
            message: (obj['message'] as string) ?? (err?.['message'] as string) ?? JSON.stringify(obj).slice(0, 500),
          });
          break;
        }
        default:
          break;
      }
    },
    finalFrom(stdout, events) {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]!;
        const text = e.data['text'];
        if (typeof text === 'string' && text.trim()) return text;
      }
      // 无 agent_message 时：优先返回最后一个 error 的人类可读消息，绝不回吐原始 JSONL
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]!;
        if (e.type === 'error' && typeof e.data['message'] === 'string') {
          return `错误：${e.data['message']}`;
        }
      }
      // stdout 是 JSONL 时不要原样返回：给出可读摘要
      const looksJsonl = stdout.trimStart().startsWith('{') || stdout.trimStart().startsWith('[');
      if (looksJsonl && events.length > 0) {
        const kinds = [...new Set(events.map((e) => e.type))].join('/');
        return `（codex 返回了 ${events.length} 条事件（${kinds}），未包含文本消息。请检查 codex CLI 版本/登录状态，或运行 agentos doctor。）`;
      }
      return stdout.trim().slice(-4000);
    },
  });
}
