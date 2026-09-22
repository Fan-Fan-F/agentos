import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { WebSocket } from 'ws';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { startAgentOSServer, type StartedServer } from '../src/index.js';

let server: StartedServer;
let taskId: string;
let origin: string;
let wsUrl: string;

beforeAll(async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agentos-network-test-'));
  const repo = path.join(root, 'repo');
  mkdirSync(repo);
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig('user.name', 'network-test');
  await git.addConfig('user.email', 'test@agentos.local');
  writeFileSync(path.join(repo, 'README.md'), 'test only');
  await git.add('.');
  await git.commit('init');
  server = await startAgentOSServer({ dataDir: path.join(root, 'data'), adapters: [], scan: async () => [], port: 0 });
  const address = server.app.server.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
  wsUrl = origin.replace('http:', 'ws:');
  taskId = (await server.runner.createTask({ repoRoot: repo, objective: 'network boundary' })).id;
});
afterAll(async () => { await server?.close(); });

async function socketStatus(id: string, originHeader?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}/ws?taskId=${encodeURIComponent(id)}`, {
      ...(originHeader ? { origin: originHeader } : {}), handshakeTimeout: 3000,
    });
    socket.on('open', () => { socket.close(); resolve(101); });
    socket.on('unexpected-response', (_req, response) => {
      response.resume(); socket.terminate(); resolve(response.statusCode ?? 0);
    });
    socket.on('error', reject);
  });
}

describe('local API browser boundary (real loopback sockets)', () => {
  it('closes an overloaded replay without losing persisted events', async () => {
    const log = server.runner.logFor(taskId);
    let began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const replay = vi.spyOn(log, 'readAll').mockImplementationOnce(async () => {
      began(); await gate; return [];
    });
    const socket = new WebSocket(`${wsUrl}/ws?taskId=${encodeURIComponent(taskId)}`);
    const closed = new Promise<number>((resolve, reject) => {
      socket.on('close', code => resolve(code));
      socket.on('error', reject);
    });
    try {
      await started;
      const event = await log.append(taskId, 'test', 'test.replay-overload', { text: 'x'.repeat(4 * 1024 * 1024) });
      expect(await closed).toBe(1013);
      finish(); replay.mockRestore();
      expect((await log.readAll()).some(item => item.id === event.id)).toBe(true);
    } finally {
      finish(); replay.mockRestore(); socket.terminate();
    }
  });


  it('sends history before live events and delivers replay overlap only once', async () => {
    const log = server.runner.logFor(taskId);
    const readAll = log.readAll.bind(log);
    let began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    let readSnapshot!: () => void;
    const snapshotGate = new Promise<void>(resolve => { readSnapshot = resolve; });
    let captured!: () => void;
    const capturedSnapshot = new Promise<void>(resolve => { captured = resolve; });
    let finish!: () => void;
    const finishGate = new Promise<void>(resolve => { finish = resolve; });
    const replay = vi.spyOn(log, 'readAll').mockImplementationOnce(async () => {
      began();
      await snapshotGate;
      const snapshot = await readAll();
      captured();
      await finishGate;
      return snapshot;
    });
    const socket = new WebSocket(`${wsUrl}/ws?taskId=${encodeURIComponent(taskId)}`);
    const messages: Array<{ type: string; id?: string; events?: Array<{ id: string }> }> = [];
    let received!: () => void;
    const completed = new Promise<void>(resolve => { received = resolve; });
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      messages.push(message);
      if (message.type === 'history' || message.type === 'test.after-snapshot') {
        if (messages.some(event => event.type === 'history') && messages.some(event => event.type === 'test.after-snapshot')) received();
      }
    });
    socket.on('error', () => received());
    try {
      await started;
      const overlap = await log.append(taskId, 'test', 'test.overlap');
      readSnapshot();
      await capturedSnapshot;
      const after = await log.append(taskId, 'test', 'test.after-snapshot');
      finish();
      await completed;
      expect(messages[0]!.type).toBe('history');
      const ids = messages.flatMap(message => message.type === 'history' ? message.events!.map(event => event.id) : [message.id]);
      expect(ids.filter(id => id === overlap.id)).toHaveLength(1);
      expect(ids.filter(id => id === after.id)).toHaveLength(1);
      const nextMessage = new Promise<{ id: string }>(resolve => socket.once('message', data => resolve(JSON.parse(data.toString()))));
      const live = await log.append(taskId, 'test', 'test.live-after-replay');
      expect((await nextMessage).id).toBe(live.id);
    } finally {
      readSnapshot(); finish(); replay.mockRestore(); socket.terminate();
    }
  });


  it('accepts same-origin HTTP and native clients', async () => {
    expect((await fetch(`${origin}/api/health`, { headers: { Origin: origin } })).status).toBe(200);
    expect((await fetch(`${origin}/api/health`)).status).toBe(200);
  });
  it.each(['https://unrelated.example', 'null', 'http://localhost:1'])('rejects foreign Origin %s before writes', async (foreign) => {
    const response = await fetch(`${origin}/api/settings`, {
      method: 'PUT', headers: { Origin: foreign, 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'attacker-change' }),
    });
    expect(response.status).toBe(403);
    expect(existsSync(path.join(server.dataDir, 'settings.json'))).toBe(false);
  });
  it('rejects DNS rebinding Host and cross-site requests without Origin', async () => {
    expect((await server.app.inject({ url: '/api/meta', headers: { host: 'unrelated.example' } })).statusCode).toBe(403);
    expect((await server.app.inject({ url: '/api/meta', headers: { 'sec-fetch-site': 'cross-site' } })).statusCode).toBe(403);
  });
  it('allows same-origin and native WebSockets', async () => {
    expect(await socketStatus(taskId, origin)).toBe(101);
    expect(await socketStatus(taskId)).toBe(101);
  });
  it('rejects a foreign website WebSocket before handshake', async () => {
    expect(await socketStatus(taskId, 'https://unrelated.example')).toBe(403);
  });
  it('rejects an unknown task without creating a task directory', async () => {
    expect(await socketStatus('unknown-task', origin)).toBe(404);
    expect(existsSync(path.join(server.dataDir, 'tasks', 'unknown-task'))).toBe(false);
  });
  it('rejects invalid websocket task identifiers without crashing the server', async () => {
    expect(await socketStatus('../outside', origin)).toBe(400);
    expect((await fetch(`${origin}/api/health`)).status).toBe(200);
  });
  it('reports the actual port when requesting an ephemeral port', () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(origin);
  });
});
