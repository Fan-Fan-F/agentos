#!/usr/bin/env node
/**
 * 真实端到端交接闭环（任务书 §32 的成功标准，需用户本机已安装并登录相应 CLI）：
 *   打开真实 git 仓库 → 创建任务 → from-agent 工作 → Capsule → swap 到 to-agent（七问验证）
 *   →（可选 --review to）向第三个 agent 请求评审 → 打印统一 Timeline 与 Capsule 路径。
 *
 * 用法：
 *   node scripts/e2e-handoff.mjs --repo D:\code\demo --from claude --to codex [--review gemini] [--objective "…"]
 *
 * 说明：
 *  - 会真实调用你本机的 agent CLI（headless），消耗你自己的额度；全程只读扫描不碰凭据。
 *  - 需要 npm run build 后运行（依赖 packages/*/dist）。
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const repo = arg('--repo');
  const from = arg('--from', 'claude');
  const to = arg('--to', 'codex');
  const review = arg('--review');
  const objective = arg('--objective', '阅读该仓库，选择一个小的改进点（如修复一个明显 bug 或补充一个测试），实现并说明理由。改动保持最小。');

  if (!repo || !existsSync(resolve(repo))) {
    console.error('错误：请用 --repo 提供一个真实存在的 git 仓库绝对路径。');
    process.exit(1);
  }

  let core, agents;
  try {
    core = await import('@agentos/core');
    agents = await import('@agentos/agents');
  } catch (e) {
    console.error('错误：请先在仓库根目录执行 npm install && npm run build：', e.message);
    process.exit(1);
  }

  const { TaskRunner } = agents;
  const runner = new TaskRunner({
    dataDir: process.env.AGENTOS_HOME || undefined,
    adapters: agents.createDefaultAdapters(),
    defaultTimeoutMs: 10 * 60_000,
  });

  console.log(`\n▶ 创建任务：${repo}\n  目标：${objective}`);
  const task = await runner.createTask({ repoRoot: resolve(repo), objective });

  console.log(`\n▶ [1/3] ${from} 开始工作（headless，独立 worktree）…`);
  const r1 = await runner.runTask(task.id, { agentId: from });
  console.log(`  完成：branch=${r1.branch} exit=${r1.run.exitCode} 变更文件=${r1.diffFiles}`);
  console.log(`  Capsule: ${r1.capsule?.id}`);

  console.log(`\n▶ [2/3] 交接给 ${to}（Capsule → Context Compiler → 七问验证）…`);
  const r2 = await runner.swapAgent(task.id, { toAgentId: to });
  console.log(`  完成：branch=${r2.branch} exit=${r2.run.exitCode} 变更文件=${r2.diffFiles}`);
  console.log(`  新 Capsule: ${r2.capsule?.id}（接管自 ${r1.capsule?.id}）`);

  if (review) {
    console.log(`\n▶ [3/3] 请 ${review} 评审当前实现…`);
    const { answer } = await runner.askAgent(task.id, {
      toAgentId: review,
      question: '请 review 当前分支相对基线的全部改动：指出正确性/边界/测试缺口问题；若无问题请明确说明。',
    });
    console.log(`  ${review} 的评审结论：\n${answer.slice(0, 1500)}`);
  }

  const events = await runner.logFor(task.id).readAll();
  console.log(`\n=== 统一 Timeline（${events.length} 条事件）===`);
  for (const e of events) {
    console.log(`  ${e.ts.slice(11, 19)}  [${e.actor}] ${e.type}`);
  }
  console.log(`\n✅ E2E 闭环完成。Capsule 与 Timeline 位于：`);
  console.log(`   ${runner.taskStore().taskDir(task.id)}`);
  console.log(`\n（提示：可用 \`agentos capsule <文件> --md\` 查看人可读的交接文档）`);
}

main().catch((err) => {
  console.error('\nE2E 失败:', err.message);
  console.error('常见原因：目标 agent 未安装/未登录（agentos doctor 检查）；仓库不是 git；网络问题。');
  process.exit(1);
});
