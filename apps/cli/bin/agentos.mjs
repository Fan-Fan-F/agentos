#!/usr/bin/env node
// AgentOS CLI：serve / doctor / capsule
import { startAgentOSServer } from '@agentos/server';
import { scanAgents } from '@agentos/agents';

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;

  if (cmd === 'serve' || cmd === undefined) {
    const port = Number(arg(rest, '--port', process.env.AGENTOS_PORT ?? 7333));
    const server = await startAgentOSServer({ port });
    console.log(`AgentOS 已启动: ${server.url}`);
    console.log(`数据目录: ${server.dataDir}`);
    console.log('（本地优先：所有数据留在本机；对已装 agent 只读，不做任何执行/上传）');
    console.log('按 Ctrl+C 停止。');
    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  if (cmd === 'doctor') {
    const probe = rest.includes('--probe');
    const agents = await scanAgents({ probe });
    console.log(`\nAgentOS doctor — 本机 Agent 扫描（${probe ? '深度：执行了 --version' : '只读：未执行任何 agent'}）\n`);
    for (const a of agents) {
      const status = a.status === 'installed' ? '✔ installed' : '✘ not-installed';
      const auth = a.auth === 'ok' ? '登录标记:有' : '登录标记:未知';
      const bin = a.binaries[0] ?? '-';
      console.log(`  ${status.padEnd(16)} ${a.name.padEnd(20)} ${a.version ? 'v' + a.version.padEnd(12) : ''.padEnd(13)} ${auth.padEnd(12)} ${bin}`);
    }
    console.log('\n说明：AgentOS 绝不读取凭据内容；已登录的 agent 无需重新登录。');
    if (!probe) console.log('提示：加 --probe 可执行各 agent 的 --version 深度检测（默认不执行你的 agent）。\n');
    return;
  }

  if (cmd === 'capsule') {
    const file = rest.find((r) => !r.startsWith('--'));
    if (!file) {
      console.error('用法: agentos capsule <capsule.json> [--md]');
      process.exit(1);
    }
    const { readFile } = await import('node:fs/promises');
    const { parseCapsule, capsuleToMarkdown } = await import('@agentos/core');
    const capsule = parseCapsule(JSON.parse(await readFile(file, 'utf8')));
    if (rest.includes('--md')) console.log(capsuleToMarkdown(capsule));
    else console.log(JSON.stringify(capsule, null, 2));
    return;
  }

  console.error(`未知命令: ${cmd ?? '(空)'}。可用命令: serve | doctor [--probe] | capsule <file> [--md]`);
  process.exit(1);
}

main().catch((err) => {
  console.error('错误:', err.message);
  process.exit(1);
});
