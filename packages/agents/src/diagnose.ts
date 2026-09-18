/**
 * Agent 故障诊断层（夜间迭代 R3）：
 * 真实运行失败时给出"发生了什么 + 用户该怎么办"，而不是把 402/JSONL 原样丢给用户。
 * 只做模式识别，不做网络探测。
 */

export type FailureKind = 'quota' | 'auth' | 'version' | 'model' | 'rate' | 'network' | 'unknown';

export interface Diagnosis {
  kind: FailureKind;
  /** 人类可读的处置建议 */
  hint: string;
  matched: string;
}

const PATTERNS: Array<{ kind: FailureKind; re: RegExp; hint: string }> = [
  {
    kind: 'quota',
    re: /402|insufficient\s+(balance|credit|quota)|quota\s+(exhausted|exceeded)|credit balance|billing/i,
    hint: '该 Agent 账户额度不足（402/billing）。请为其充值，或在界面中换其他 Agent 接管当前任务（Capsule 已保存，交接不丢上下文）。',
  },
  {
    kind: 'auth',
    re: /401|unauthorized|invalid\s+api\s+key|not\s+(logged|authenticated)|please\s+(run|use).*login|please\s+sign\s+in/i,
    hint: '该 Agent 未登录或登录已过期。请在其官方 CLI 中重新登录（AgentOS 不代登录、不迁移凭据）。',
  },
  {
    kind: 'version',
    re: /requires\s+a\s+newer\s+version|upgrade.*(cli|app|codex)|outdated\s+version|unsupported\s+client/i,
    hint: '该 Agent CLI 版本过旧，无法服务当前模型。请升级官方 CLI（npm i -g <对应官方包>）后重试。',
  },
  {
    kind: 'model',
    re: /model\s+(metadata\s+for\s+)?[`"']?[\w.:-]+[`"']?\s+not\s+found|invalid_request_error|model_not_found|does\s+not\s+exist\s+or\s+is\s+not\s+authorized/i,
    hint: '模型不可用（模型名不存在或当前 CLI/账户不支持）。请在该 Agent 的配置中更换模型，或升级 CLI。',
  },
  {
    kind: 'rate',
    re: /429|rate\s*limit|too\s+many\s+requests|slow\s+down/i,
    hint: '触发限流（429）。稍后重试，或换其他 Agent 接管当前任务。',
  },
  {
    kind: 'network',
    re: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|fetch\s+failed|network\s+error|getaddrinfo/i,
    hint: '网络错误：无法连接到该 Agent 的服务端。请检查网络/代理后重试。',
  },
];

/** 从运行产物中诊断失败类别；无匹配返回 null。 */
export function diagnoseFailure(input: { finalMessage?: string; stderrTail?: string; exitCode?: number | null }): Diagnosis | null {
  const text = `${input.finalMessage ?? ''}\n${input.stderrTail ?? ''}`;
  if (!text.trim()) return null;
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      return { kind: p.kind, hint: p.hint, matched: m[0].slice(0, 120) };
    }
  }
  return null;
}
