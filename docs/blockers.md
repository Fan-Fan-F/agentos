# Blockers（夜间迭代记录）

> 按 §25 阻塞策略记录：问题 / 根因 / 已尝试 / 绕过方式 / 需要用户做什么。
> 定期复查：用户解决侧问题后，重跑 `node scripts/real-e2e.mjs` 即可完成真实闭环验证。

## BLOCKER-1：claude CLI 账户额度不足（2026-09-19，真实 E2E 发现）

- 现象：任何 `claude -p` 调用立即返回 `API Error: 402 Insufficient Balance`。
- 根因：**用户侧** Anthropic 账户余额/额度不足。非 AgentOS 缺陷（诊断层已正确识别为 `[quota]` 并给出建议）。
- 已尝试：确认登录标记存在（~/.claude.json）；确认 CLI 可执行；减小提示词无用（纯账户问题）。
- 产品侧已做：402 → `[quota]` 诊断 + "充值或换 Agent 接管"建议；ask 不再把错误文本冒充回答。
- **需要用户**：为 Anthropic 账户充值后，重跑 `node scripts/real-e2e.mjs` 完成真实闭环验证。

## BLOCKER-2：codex CLI 版本过旧（2026-09-19，真实 E2E 发现）

- 现象：`codex exec` 返回 `The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade...`（HTTP 400）。
- 根因：**用户侧** npm 全局的 @openai/codex 版本落后于其账户默认模型（gpt-6-astra）的要求。非 AgentOS 缺陷（诊断为 `[version]`）。
- 已尝试：默认参数执行失败；无权限也不应改动用户的 codex 安装（用户此前明确要求不碰现有 agent）。
- 产品侧已做：JSONL 不再泄漏为最终消息；失败诊断 `[version]` + 升级指引；接管失败自动跳过七问探针。
- **需要用户**：自行升级 codex（`npm install -g @openai/codex`）后重跑真实 E2E。

## 影响

- 真实 E2E 的"agent 真实产出代码"半程被上述两个用户侧问题阻塞；引擎半程（Capsule 链、HANDOFF.md 提交、时间线、诊断、探针跳过）已全部真实验证通过（docs/dogfood/2026-09-19-real-e2e.md）。
- gemini/opencode 未安装，同样无法真实验证（用户可安装后自动解锁）。
