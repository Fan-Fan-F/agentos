import { CliHeadlessAdapter } from '../cliHeadless.js';
import { profileFor } from '../catalog.js';

/**
 * OpenCode 适配器（opencode run --format json；session 引用来自事件中的 sessionID 字段）。
 * 注意 `-p` 是 server 密码不是 prompt（docs/research/04 §4）。
 */
export function createOpencodeAdapter(binary = 'opencode'): CliHeadlessAdapter {
  return new CliHeadlessAdapter({
    id: 'opencode',
    profile: profileFor('opencode'),
    binary,
    buildRunArgs(prompt, opts) {
      return ['run', '--format', 'json', ...(opts?.extraArgs ?? []), prompt];
    },
    buildResumeArgs(sessionRef, prompt, opts) {
      return ['run', '--session', sessionRef, ...(opts?.extraArgs ?? []), prompt];
    },
    parseLine(line, ctx) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      const sid = obj['sessionID'] ?? obj['session_id'] ?? obj['sessionId'];
      if (typeof sid === 'string') ctx.sessionRef = sid;
      const part = (obj['part'] ?? obj) as Record<string, unknown>;
      const type = (part['type'] ?? obj['type']) as string | undefined;
      const text = part['text'] ?? obj['text'];
      if (typeof text === 'string' && text.trim() && (type === 'text' || type === 'message' || type === 'agent')) {
        ctx.push('message', { text });
      } else if (type === 'tool' || type === 'tool_call') {
        ctx.push('tool_call', { tool: part['tool'] ?? part['name'], status: (part['state'] as Record<string, unknown> | undefined)?.['status'] });
      }
    },
    finalFrom(stdout, events) {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]!;
        const text = e.data['text'];
        if (typeof text === 'string' && text.trim()) return text;
      }
      // 事件流解析不出文本时，退回原始 stdout（去除 JSON 行后几乎为空）
      return stdout.trim().slice(-4000);
    },
  });
}
