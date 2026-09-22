import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Exercise the actual browser script's callback lifecycle without booting its API client.
function harness() {
  const sockets: Array<any> = [];
  const timers: Array<() => void> = [];
  const elements = new Map();
  const document = {
    addEventListener() {}, querySelectorAll: () => [],
    getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', value: '', classList: { add() {}, remove() {} } });
      return elements.get(id);
    },
  };
  class Socket {
    readyState = 1;
    constructor(readonly url: string) { sockets.push(this); }
  }
  const context = vm.createContext({ document, window: { addEventListener() {} }, WebSocket: Socket,
    location: { protocol: 'http:', host: '127.0.0.1' }, setTimeout: (fn: () => void) => timers.push(fn) });
  const source = fs.readFileSync(new URL('../../../apps/web/app.js', import.meta.url), 'utf8');
  const boot = source.indexOf('(async function boot()');
  if (boot < 0) throw new Error('Missing browser boot boundary');
  const ui = vm.runInContext(source.slice(0, boot) + '\n({ state, connectWS, renderReviewPatch })', context);
  return { ...ui, sockets, timers };
}

describe('browser timeline subscription lifecycle (simulated socket)', () => {
  it('renders received history through the task view callback', () => {
    const h = harness();
    h.state.currentTaskId = 'a';
    const render = vi.fn();
    h.connectWS('a', render);
    const message = { type: 'history', events: [{ id: 'one', type: 'task.created' }] };
    h.sockets[0].onmessage({ data: JSON.stringify(message) });
    expect(render).toHaveBeenCalledWith(message);
    expect(h.state.events).toEqual(message.events);
  });
  it('ignores events and reconnects from a replaced task socket', () => {
    const h = harness();
    h.state.currentTaskId = 'a';
    const renderA = vi.fn();
    h.connectWS('a', renderA);
    h.state.currentTaskId = 'b';
    const renderB = vi.fn();
    h.connectWS('b', renderB);
    h.sockets[0].onmessage({ data: JSON.stringify({ type: 'history', events: [{ id: 'wrong-task' }] }) });
    h.sockets[0].onclose();
    expect(h.state.events).toEqual([]);
    expect(renderA).not.toHaveBeenCalled();
    expect(h.timers).toHaveLength(0);
    h.sockets[1].onclose();
    h.timers[0]();
    expect(h.sockets).toHaveLength(3);
    h.sockets[2].onmessage({ data: JSON.stringify({ id: 'current', type: 'task.failed' }) });
    expect(renderB).toHaveBeenCalledOnce();
    expect(h.state.events).toEqual([{ id: 'current', type: 'task.failed' }]);
  });
});

describe('review patch rendering', () => {
  it('escapes repository HTML and distinguishes changes from headers', () => {
    const h = harness();
    const rendered = h.renderReviewPatch('+++ b/file\n@@ -1 +1 @@\n-previous\n+<img src=x onerror=alert(1)>');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('&lt;img');
    expect(rendered.html).toContain('diff-meta');
    expect(rendered.html).toContain('diff-add');
    expect(rendered.html).toContain('diff-del');
    expect(rendered.clipped).toBe(false);
  });
  it('bounds rendered lines and reports when the view is incomplete', () => {
    const h = harness();
    const rendered = h.renderReviewPatch('+line\n'.repeat(4000));
    expect(rendered.clipped).toBe(true);
    expect(rendered.html.match(/<span /g)).toHaveLength(3000);
  });
});
