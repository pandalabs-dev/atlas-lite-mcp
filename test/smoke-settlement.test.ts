import { describe, expect, it } from 'vitest';
import { createRuntime } from '../src/core/runtime.js';
import { createHttpClient } from '../src/core/http.js';
import { defineTool, type ProductModule } from '../src/core/tools.js';
import { createSmokeSession } from './smoke/settlement.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
function setup() {
  const gate = deferred();
  const started = deferred();
  const events: string[] = [];
  let state = 0;
  const site = { name: 'fake', host: 'fake.atlassian.net', baseUrl: 'https://fake.atlassian.net', email: 'fake@example.invalid', apiToken: 'fake-only', tokenType: 'classic' as const, available: true };
  const rt = createRuntime({ sites: [site], source: 'env', path: '/not-used' });
  let attempts = 0;
  rt.resolve({}).http = createHttpClient(site, {
    fetch: async () => {
      if (attempts++ === 0) return new Response('', { status: 429, headers: { 'retry-after': '1' } });
      state = 1;
      events.push('late-write');
      return new Response('{}');
    },
    sleep: async () => { events.push('retry-sleep'); started.resolve(); await gate.promise; },
  });
  const modules: ProductModule[] = [{ name: 'fake', tools: [
    defineTool({ name: 'write', description: 'fake', shape: {}, async run(_, runtime) {
      await runtime.resolve({}).http.request('jira', 'POST', '/fake');
      events.push('handler-settled');
      return 'written';
    } }),
    defineTool({ name: 'read', description: 'fake', shape: {}, async run() { events.push('read'); return String(state); } }),
    defineTool({ name: 'restore', description: 'fake', shape: {}, async run() { state = 0; events.push('restored'); return 'restored'; } }),
  ] }];
  const session = createSmokeSession(rt, modules, 10);
  return { gate, started, events, session, state: () => state };
}

describe('smoke session settlement using real linked MCP transports', () => {
  it('drains retry sleep and the late writer before timeout cleanup reads', async () => {
    const f = setup();
    await f.session.connect();
    let error: unknown;
    const work = f.session.run(async () => {
      try { await f.session.call('write', {}); } catch (e) { error = e; }
      await f.session.call('read', {});
      await f.session.call('restore', {});
    });
    await f.started.promise;
    await new Promise((r) => setTimeout(r, 25));
    const readBeforeSettlement = f.events.includes('read');
    f.gate.resolve();
    await work;
    await f.session.close();
    expect(readBeforeSettlement).toBe(false);
    expect(error).toBeDefined();
    expect(f.events.indexOf('read')).toBeGreaterThan(f.events.indexOf('handler-settled'));
    expect(f.state()).toBe(0);
  });

  it('does not release readback after an SDK timeout during a delayed cleanup write', async () => {
    const f = setup();
    await f.session.connect();
    const work = f.session.run(async () => {
      await f.session.call('read', {});
      try { await f.session.call('write', {}); } catch { /* Cleanup error stays observable after drain. */ }
      await f.session.call('read', {});
    });
    await f.started.promise;
    await new Promise((r) => setTimeout(r, 25));
    const readsWhilePending = f.events.filter((e) => e === 'read').length;
    f.gate.resolve();
    await work;
    await f.session.close();
    expect(readsWhilePending).toBe(1);
    expect(f.events.filter((e) => e === 'read')).toHaveLength(2);
    expect(f.events.lastIndexOf('read')).toBeGreaterThan(f.events.indexOf('handler-settled'));
  });

  it('does not advance another scenario or shutdown over a deadline-abandoned writer', async () => {
    const f = setup();
    await f.session.connect();
    const deadline = new AbortController();
    const first = f.session.run(async () => {
      try { await f.session.call('write', {}); } catch { /* Scenario must still await settlement. */ }
    }, deadline.signal).catch(() => {});
    await f.started.promise;
    deadline.abort(new Error('scenario deadline'));
    const next = f.session.run(async () => { f.events.push('next'); }).catch(() => {});
    const closing = f.session.close().then(() => { f.events.push('closed'); });
    await new Promise((r) => setTimeout(r, 25));
    const advanced = f.events.includes('next');
    const closed = f.events.includes('closed');
    f.gate.resolve();
    await Promise.all([first, next, closing]);
    expect(advanced).toBe(false);
    expect(closed).toBe(false);
    expect(f.events.indexOf('closed')).toBeGreaterThan(f.events.indexOf('handler-settled'));
    expect(f.events).not.toContain('next');
  });
});
