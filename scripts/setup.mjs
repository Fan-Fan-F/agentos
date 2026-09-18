#!/usr/bin/env node
/** AgentOS 一键安装：依赖 → 构建 → 只读体检 → 使用指引。 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' });
  if (r.status !== 0) {
    console.error(`[AgentOS] 命令失败: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
};

console.log('[1/3] 安装依赖…');
if (!fs.existsSync(path.join(root, 'node_modules'))) run('npm', ['install', '--no-audit', '--no-fund']);
else console.log('  node_modules 已存在，跳过');

console.log('[2/3] 构建…');
run('npm', ['run', 'build']);

console.log('[3/3] 本机 Agent 体检（只读，不会执行你的任何 agent）…');
run('node', ['apps/cli/bin/agentos.mjs', 'doctor']);

console.log('');
console.log('✅ AgentOS 就绪！');
console.log('   桌面启动：双击根目录的 AgentOS.bat（Windows）/ AgentOS.command（macOS）');
console.log('   或命令行：npm run desktop');
