# ADR-009：桌面体验 = App 模式窗口先行，Tauri 原生壳后置（M5）

- 状态：Accepted（2026-09-18）
- 背景：用户要求"下载下来就是个桌面端，点进去简洁易懂、审美对标 OpenAI/ChatGPT"。候选：① Tauri 2 原生壳（本机已确认有 Rust 工具链）② Electron ③ 本地服务 + 浏览器 App 模式窗口。
- 决策：本里程碑交付 **App 模式窗口** 方案：
  - 双击 `AgentOS.bat`（Windows）/ `AgentOS.command`（macOS）→ 自动完成首次构建 → 启动本地服务 → 以 Edge/Chrome `--app` 模式打开**无边框、无地址栏的独立窗口**（与原生应用观感一致，Ollama/LM Studio 同款分发思路）；
  - 无 Edge/Chrome 时回退默认浏览器；`npm run desktop` 等价入口；`node scripts/setup.mjs` 一键安装+构建+体检。
  - UI 全面翻新为 ChatGPT 风格设计系统（平面卡片、细分隔线、单翡翠强调色 #10a37f、浅/深/跟随系统主题、首次使用向导、空态引导、设置面板），经浏览器截图逐屏验证。
- 理由：当天生效、零打包风险、全平台一致；原生壳的增量价值（系统托盘、自动更新、文件对话框）在 M5 由 Tauri 2 兑现（cargo 1.98 已确认可用，sidecar 打包 Node 服务，见 docs/research/06）。
- 后果：App 模式窗口依赖本机装有 Edge/Chrome（Windows 10/11 与 macOS 主流环境默认满足）；生命周期 = 服务进程生命周期（关窗不退服务，Ctrl+C/托盘 M5 处理）。
