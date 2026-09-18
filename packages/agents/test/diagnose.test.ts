import { describe, expect, it } from 'vitest';
import { diagnoseFailure } from '../src/diagnose.js';

/** 诊断层单测：样本来自 2026-09-19 真实 E2E dogfooding 的实际输出（docs/dogfood/）。 */
describe('Agent 故障诊断层', () => {
  it('402 余额不足 → quota + 充值/换人建议', () => {
    const d = diagnoseFailure({ finalMessage: 'API Error: 402 Insufficient Balance' });
    expect(d?.kind).toBe('quota');
    expect(d!.hint).toContain('额度不足');
    expect(d!.hint).toContain('换其他 Agent');
  });

  it('CLI 版本过旧 → version + 升级建议（真实 codex 报错样本）', () => {
    const d = diagnoseFailure({
      finalMessage:
        'The "gpt-6-astra" model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.',
    });
    expect(d?.kind).toBe('version');
    expect(d!.hint).toContain('升级');
  });

  it('未登录 → auth；429 → rate；网络错误 → network', () => {
    expect(diagnoseFailure({ finalMessage: 'error: 401 Unauthorized, please run /login' })?.kind).toBe('auth');
    expect(diagnoseFailure({ stderrTail: 'HTTP 429 Too Many Requests' })?.kind).toBe('rate');
    expect(diagnoseFailure({ stderrTail: 'fetch failed: getaddrinfo ENOTFOUND api.x.com' })?.kind).toBe('network');
  });

  it('模型不可用 → model', () => {
    const d = diagnoseFailure({ finalMessage: 'invalid_request_error: model_not_found' });
    expect(d?.kind).toBe('model');
  });

  it('正常输出不误报', () => {
    expect(diagnoseFailure({ finalMessage: '任务完成：已实现 fib 并通过 3 个测试。' })).toBeNull();
    expect(diagnoseFailure({ finalMessage: '', stderrTail: '' })).toBeNull();
  });
});
