import { CliHeadlessAdapter } from '../cliHeadless.js';
import { profileFor } from '../catalog.js';

/** Codex CLI 适配器（codex exec --json；thread_id 来自 thread.started，见 docs/research/04 §2）。 */
export function createCodexAdapter(binary = 'codex'): CliHeadlessAdapter {
  return new CliHeadlessAdapter({
    id: 'codex',
    profile: profileFor('codex'),
    binary,
    buildRunArgs(prompt, opts) {
      return [
        'exec',
        '--json',
        '--skip-git-repo-check',
        ...(opts?.permissionFlags ?? []),
        ...(opts?.model ? ['-m', opts.model] : []),
        ...(opts?.extraArgs ?? []),
        prompt,
      ];
    },
    buildResumeArgs(sessionRef, prompt, opts) {
      return [
        'exec',
        'resume',
        sessionRef,
        '--json',
        ...(opts?.permissionFlags ?? []),
        ...(opts?.extraArgs ?? []),
        prompt,
      ];
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
      return stdout.trim().slice(-4000);
    },
  });
}
