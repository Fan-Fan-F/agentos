import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentOSServer, startAgentOSServer } from '../src/index.js';

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); });
async function dataDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'agentos-instance-')); }
async function create(dir: string) {
  const server = await createAgentOSServer({ dataDir: dir, adapters: [], scan: async () => [] });
  closers.push(() => server.app.close());
  return server;
}

async function killOwnedChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}
async function childOwner(dir: string): Promise<{ child: ChildProcess; ready?: boolean; error?: string }> {
  const child = fork(fileURLToPath(new URL('./server-lock-child.mjs', import.meta.url)), [dir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  closers.push(() => killOwnedChild(child));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Child server startup timed out')), 10000);
    child.once('message', message => { clearTimeout(timer); resolve({ child, ...(message as object) }); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Child exited before startup')); });
  });
}

describe('data directory ownership', () => {
  it('rejects a second server before recovery rewrites an active task', async () => {
    const dir = await dataDir();
    await create(dir);
    const taskDir = path.join(dir, 'tasks', 'active-task');
    await fs.mkdir(taskDir, { recursive: true });
    const file = path.join(taskDir, 'task.json');
    const original = JSON.stringify({ id: 'active-task', status: 'running', runs: [], createdAt: '2026-09-21' });
    await fs.writeFile(file, original);
    const outcome = await create(dir).then(() => 'accepted', err => String(err.message));
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(outcome).toMatch(/已由另一个服务/);
  });

  it('allows independent directories and reacquires after a normal close', async () => {
    const dir = await dataDir();
    const first = await create(dir);
    await create(await dataDir());
    await first.app.close();
    await create(dir);
  });

  it('admits exactly one simultaneous constructor', async () => {
    const dir = await dataDir();
    const results = await Promise.all(Array.from({ length: 8 }, () => create(dir).then(() => true, () => false)));
    expect(results.filter(Boolean).length).toBe(1);
  });

  it('releases ownership when HTTP listen fails', async () => {
    const dir = await dataDir();
    const occupied = net.createServer();
    await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve, reject) => occupied.close(err => err ? reject(err) : resolve())));
    const port = (occupied.address() as net.AddressInfo).port;
    await expect(startAgentOSServer({ dataDir: dir, adapters: [], port })).rejects.toThrow();
    await create(dir);
  });

  it('releases ownership when construction fails', async () => {
    const dir = await dataDir();
    await expect(createAgentOSServer({ dataDir: dir, adapters: [undefined as never] })).rejects.toThrow();
    await create(dir);
  });

  it('refuses unknown lock contents without deleting them', async () => {
    const dir = await dataDir();
    const lock = path.join(dir, '.server.lock');
    await fs.mkdir(lock);
    const sentinel = path.join(lock, 'unknown.txt');
    await fs.writeFile(sentinel, 'preserve');
    await expect(create(dir)).rejects.toThrow(/无法确认/);
    expect(await fs.readFile(sentinel, 'utf8')).toBe('preserve');
  });

  it('treats a directory junction or symlink as the same data directory', async () => {
    const dir = await dataDir();
    const alias = path.join(await dataDir(), 'alias');
    await fs.symlink(dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await create(dir);
    await expect(create(alias)).rejects.toThrow(/已由另一个服务/);
  });

  it('reclaims a killed real server exactly once under cross-process contention', async () => {
    const dir = await dataDir();
    const original = await childOwner(dir);
    expect(original.ready).toBe(true);
    const taskDir = path.join(dir, 'tasks', 'active-task');
    await fs.mkdir(taskDir, { recursive: true });
    const file = path.join(taskDir, 'task.json');
    await fs.writeFile(file, JSON.stringify({ id: 'active-task', status: 'running', runs: [], createdAt: '2026-09-21' }));
    const contender = await childOwner(dir);
    expect(contender.error).toMatch(/已由另一个服务/);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).status).toBe('running');
    await killOwnedChild(original.child);
    const contenders = await Promise.all(Array.from({ length: 6 }, () => childOwner(dir)));
    const winners = contenders.filter(result => result.ready);
    expect(winners.length).toBe(1);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).status).toBe('interrupted');
    const events = (await fs.readFile(path.join(taskDir, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(events.filter(event => event.type === 'task.recovered').length).toBe(1);
    await killOwnedChild(winners[0]!.child);
    await create(dir);
  }, 20000);
});
