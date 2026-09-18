# AgentOS

> **Build once, use every agent.**
> 一个本地优先（Local-First）的跨平台多 AI Coding Agent 综合管理平台：发现、运行、切换、协作、编排你机器上已有的各家 Agent。

AgentOS 不是又一个 "Claude Code + Codex + Gemini CLI 启动器"。它要解决的是 **Agent Interoperability（Agent 互操作）**：

- **任何 Agent 可以接管任何 Agent 的工作**（Universal Session Capsule + Context Compiler）
- **任何 Agent 可以向其他 Agent 请求帮助**（Message Bus：ask / review / approve）
- **多个 Agent 可以并行攻克同一任务**（Session Fork：相同起点、独立 worktree、统一比较）
- **用户不再充当不同 AI 之间复制粘贴上下文的"消息中间人"**

## 当前状态

**M1 里程碑（真实可运行的最小闭环）**，详见 [ROADMAP.md](./ROADMAP.md) 与 [TESTING.md](./TESTING.md)。

已实现（真实运行，非 demo）：

| 能力 | 状态 |
|---|---|
| 本机 Agent 发现（PATH/npm 全局/家目录标记，只读） | ✅ Implemented |
| Headless 适配器：Claude Code / Codex / Gemini CLI / OpenCode + Stub | ✅ Implemented（真实 agent 未在本开发环境执行，见 TESTING.md） |
| Universal Session Capsule（v1，版本化 + Markdown 视图） | ✅ Implemented |
| Context Compiler（minimal/standard/full + 预算裁剪） | ✅ Implemented |
| Git Workspace Engine（独立 worktree / checkpoint / diff / commits） | ✅ Implemented |
| Agent Hot Swap（任意→任意，七问验证探针） | ✅ Implemented |
| Session Fork（多 agent 相同起点并行 + 汇总对比） | ✅ Implemented |
| Agent 间提问协作（ask） | ✅ Implemented |
| 统一 Timeline（JSONL 持久化 + WebSocket 实时推送） | ✅ Implemented |
| 本地 Web UI（零构建静态 SPA） | ✅ Implemented (Minimal) |
| CLI：`doctor` / `serve` / `capsule` | ✅ Implemented |
| ACP 适配器 / MCP Hub / Permission Broker / Workflow Canvas / Tauri 壳 | ⏳ 后续里程碑（见 ROADMAP） |

## 快速开始

```bash
# 于仓库根目录（Windows 示例：D:\project\agentos）
npm install
npm run build
npm test          # 单元 + 集成 + 适配器契约测试
npm run doctor    # 只读扫描本机已装的 agent（绝不执行/触碰你的 agent）
npm start         # 启动本地服务，浏览器打开 http://localhost:7333
```

> ⚠️ 隐私与安全：AgentOS 对你已装的 agent **只做存在性检测**（不执行、不读凭据、不要求重新登录、绝不迁移 Token）。
> 版本探测与安装命令默认不执行，需要你在界面/命令中显式触发。详见 [SECURITY.md](./SECURITY.md)。

## 端到端闭环（本项目的成功标准）

```
打开应用 → 发现本机 Claude Code / Codex / Gemini CLI
        → 打开真实 Git 仓库 → 创建任务
        → Claude 工作（headless）→ 保存 Session Capsule
        → 一键切换 Codex → Codex 无需重新解释即可接续（七问验证）
        → Codex 可请求 Gemini review → 发现问题 → Codex 修复
        → 测试通过 → 统一 Timeline 与 Git Diff → 创建 Commit
```

试用真实 agent 的交接闭环（需要你本机已安装并登录相应 CLI，消耗你自己的额度）：

```bash
node scripts/e2e-handoff.mjs --repo <你的git仓库> --from claude --to codex
```

## 文档地图

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 分层架构与数据流
- [ROADMAP.md](./ROADMAP.md) — 里程碑与状态（诚实标注 Implemented/Partial/Not Implemented）
- [DECISIONS.md](./DECISIONS.md) — 决策索引（docs/decisions/ADR-*）
- [COMPATIBILITY.md](./COMPATIBILITY.md) — Agent 支持矩阵与上游项目许可证
- [SECURITY.md](./SECURITY.md) — 凭据隔离与权限模型
- [TESTING.md](./TESTING.md) — 测试策略与真实/契约测试边界
- [docs/research/](./docs/research/) — 协议（ACP/A2A/MCP）、竞品、CLI 能力、可移植性先例、选型研究

## License

MIT（见 [LICENSE](./LICENSE)）。仅借鉴开放协议与开源项目的设计思想，不复制不兼容许可证代码。
