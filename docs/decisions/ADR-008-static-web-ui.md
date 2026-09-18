# ADR-008：Web UI 先用零构建静态实现，React 后置

- 状态：Accepted（2026-09-18）
- 决策：M1 的 Web UI 为服务端直出的原生 HTML/JS/CSS 单页（无构建步骤、无 CDN 依赖、可完全离线），覆盖：Agent 扫描卡片、项目登记、任务创建/运行/换人/提问/Fork、实时时间线、Capsule 与 Diff 查看。
- 理由：把工程量集中在引擎（capsule/编译器/适配器/git）上；UI 结构已按 React 迁移友好的组件化思路组织；零依赖符合"本地优先、可离线"。
- 后果：复杂交互（Workflow Canvas、Diff 高亮）在 React/Vite 迁移（M4+）中补齐；当前 UI 明确标注 Minimal。
