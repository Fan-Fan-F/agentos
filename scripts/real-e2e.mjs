#!/usr/bin/env node
/**
 * 真实 E2E dogfooding（夜间迭代 R2）：
 * 用本机已登录的真实 agent 完整跑通核心闭环：
 *   temp git 仓库 → claude 实现（真实文件+测试） → Capsule → codex 接管（七问验证）
 *   → claude 评审 → codex 跟进修复 → 汇总报告
 * 全部输出落盘 docs/dogfood/，供后续修复与追溯。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const { TaskRunner, createDefaultAdapters } = await import(pathToFile(root, 'packages/agents/dist/index.js'));

function pathToFile(rootPath, rel) {
  return 'file:///' + path.join(rootPath, rel).replace(/\\/g, '/');
}

const log = [];
const t0 = Date.now();
const say = (m) => {
  const line = `[${Math.round((Date.now() - t0) / 1000)}s] ${m}`;
  console.log(line);
  log.push(line);
};

function assert(cond, msg) {
  say(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  // 0. 环境前置：二进制存在 + 登录标记（stat，不读内容）
  const home = os.homedir();
  const pre = {
    claudeBin: fs.existsSync('C:/Users/Fan/AppData/Roaming/npm/claude.cmd'),
    claudeAuth: fs.existsSync(path.join(home, '.claude.json')),
    codexBin: fs.existsSync('C:/Users/Fan/AppData/Roaming/npm/codex.cmd'),
    codexAuth: fs.existsSync(path.join(home, '.codex', 'auth.json')),
  };
  say(`前置: ${JSON.stringify(pre)}`);
  if (!pre.claudeBin || !pre.codexBin) {
    say('缺少 agent 二进制，无法真实 E2E');
    process.exit(1);
  }

  // 1. 真实临时 git 仓库（小型 JS 项目）
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentos-e2e-'));
  const repoRoot = path.join(tmp, 'demo-repo');
  await fsp.mkdir(repoRoot, { recursive: true });
  const git = simpleGit(repoRoot);
  await git.init();
  await git.addConfig('user.name', 'agentos-e2e');
  await git.addConfig('user.email', 'e2e@agentos.local');
  await fsp.writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({ name: 'demo', type: 'module' }, null, 2));
  await fsp.writeFile(path.join(repoRoot, 'README.md'), '# demo\n');
  await git.add('./*');
  await git.commit('init');

  // 2. TaskRunner（真实适配器）
  const dataDir = path.join(tmp, 'agentos-home');
  const runner = new TaskRunner({ dataDir, adapters: createDefaultAdapters(), defaultTimeoutMs: 8 * 60_000 });

  const devFlagsClaude = ['--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Glob,Grep,Bash'];
  const devFlagsCodex = ['--sandbox', 'workspace-write'];

  // 3. claude 真实工作
  say('▶ [1/5] claude 开始真实实现…');
  const task = await runner.createTask({
    repoRoot,
    objective:
      '创建 src/fib.js，导出函数 fib(n)（n>=0，记忆化迭代实现）；创建 test/fib.test.js，用 node:test 写 3 个断言（fib(0)=0, fib(10)=55, fib(20)=6765）；运行 node --test 确认全部通过。只创建这两个文件，不要改动其他文件。',
    constraints: ['不引入任何 npm 依赖', 'package.json 保持不变'],
  });
  const r1 = await runner.runTask(task.id, { agentId: 'claude', permissionFlags: devFlagsClaude });
  say(`claude 完成: exit=${r1.run.exitCode} 分支=${r1.branch} 耗时=${Math.round(r1.run.durationMs / 1000)}s 变更文件=${r1.diffFiles}`);
  assert(r1.run.exitCode === 0 && !r1.run.error, 'claude 运行成功');
  const filesAfterClaude = await fsp.readdir(path.join(repoRoot, 'src'), { recursive: true }).catch(() => []);
  say(`src/ 内容: ${filesAfterClaude.join(', ') || '（空）'}`);
  assert(filesAfterClaude.some((f) => String(f).includes('fib.js')), 'claude 创建了 src/fib.js');

  // 4. codex 接管（Capsule → 七问验证）
  say('▶ [2/5] 交接给 codex（七问验证）…');
  const r2 = await runner.swapAgent(task.id, { toAgentId: 'codex', permissionFlags: devFlagsCodex });
  say(`codex 接管: exit=${r2.run.exitCode} 分支=${r2.branch} capsule=${r2.capsule?.id}`);
  assert(r2.capsule?.origin.resumedFromCapsuleId === r1.capsule?.id, 'Capsule 链正确');
  const verifyEvent = (await runner.logFor(task.id).readAll()).find(
    (e) => e.type === 'agent.replied' && e.payload?.kind === 'handoff-verify',
  );
  const verifyAnswer = String(verifyEvent?.payload?.answer ?? '');
  say(`七问回答（前 600 字）:\n${verifyAnswer.slice(0, 600)}`);
  const checks = {
    任务目标: /fib/i.test(verifyAnswer),
    已完成: /fib\.js|测试|断言/.test(verifyAnswer),
    下一步: /(下一步|review|评审|文档|继续)/i.test(verifyAnswer),
  };
  for (const [k, v] of Object.entries(checks)) assert(v, `codex 七问包含「${k}」`);

  // 5. claude 评审
  say('▶ [3/5] 请 claude 评审 codex 的现状…');
  const { answer } = await runner.askAgent(task.id, {
    toAgentId: 'claude',
    question: '请 review 当前分支相对基线的全部改动：fib 实现与测试是否正确？是否存在边界问题？只回答结论与要点。',
  });
  say(`claude 评审（前 400 字）:\n${answer.slice(0, 400)}`);
  assert(answer.trim().length > 30, '评审返回了实质内容');

  // 6. codex 跟进修复
  say('▶ [4/5] codex 跟进…');
  const r3 = await runner.followUp(task.id, {
    agentId: 'codex',
    permissionFlags: devFlagsCodex,
    message: '运行 node --test 确认测试全部通过；若测试文件缺失则补上；然后输出一段总结：当前任务状态、已完成、下一步。',
  });
  say(`codex 跟进: exit=${r3.run.exitCode}`);

  // 7. 汇总
  say('▶ [5/5] 汇总验证…');
  const taskFinal = await runner.getTask(task.id);
  const diff = await runner.git.diffAgainstBase(r2.worktreePath, taskFinal.baseRef);
  say(`最终变更文件: ${diff.files.map((f) => `${f.change}:${f.path}`).join(', ')}`);
  assert(diff.files.length >= 2, '分支上有真实文件变更');
  const events = await runner.logFor(task.id).readAll();
  say(`Timeline 共 ${events.length} 条事件`);
  assert(events.length > 15, 'Timeline 完整记录了全流程');

  // 报告落盘
  const reportDir = path.join(root, 'docs', 'dogfood');
  await fsp.mkdir(reportDir, { recursive: true });
  const report = [
    '# 真实 E2E Dogfooding 报告',
    '',
    `- 日期：2026-09-19`,
    `- 仓库：${repoRoot}`,
    `- 数据目录：${dataDir}`,
    `- 结果：${process.exitCode ? '❌ 存在失败断言' : '✅ 闭环全通'}`,
    '',
    '## 关键结果',
    ...log.map((l) => `- ${l}`),
    '',
    '## 七问验证全文',
    '```',
    verifyAnswer,
    '```',
    '',
    '## claude 评审全文',
    '```',
    answer,
    '```',
    '',
    '## Timeline 全事件',
    ...events.map((e) => `- ${e.ts.slice(11, 19)} [${e.actor}] ${e.type}`),
  ].join('\n');
  await fsp.writeFile(path.join(reportDir, '2026-09-19-real-e2e.md'), report, 'utf8');
  say(`报告已写入 docs/dogfood/2026-09-19-real-e2e.md`);
  say(`任务数据: ${runner.taskStore().taskDir(task.id)}`);
}

main().catch((err) => {
  say(`💥 E2E 异常: ${err.message}\n${err.stack?.split('\n').slice(0, 6).join('\n')}`);
  process.exitCode = 1;
}).finally(async () => {
  await fsp.writeFile(path.join(root, 'docs', 'dogfood', 'last-run.log'), log.join('\n'), 'utf8').catch(() => {});
});
