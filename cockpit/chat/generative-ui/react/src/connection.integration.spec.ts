import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi, onTestFinished } from 'vitest';
import { createConnectedApplication } from './connection';

/* eslint-disable @nx/enforce-module-boundaries -- Local test backend tooling is never bundled. */
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { createAimockBackend } from '../../../../../scripts/react-cockpit/aimock-backend.mjs';
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { createLanggraphProxy } from '../../../../../scripts/react-cockpit/langgraph-proxy.mjs';
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { reactCockpitConfiguration } from '../../../../../scripts/react-cockpit/configuration.mjs';
/* eslint-enable @nx/enforce-module-boundaries */

// The real graph runs under `langgraph dev` on aimock fixtures shared with the
// Angular example (cockpit/chat/generative-ui/angular/e2e/fixtures); the
// in-process proxy records requests and holds or fails the next call
// (scripts/react-cockpit/langgraph-proxy.mjs). Faults no model output can
// reach (a throwing tool, malformed tool data, prose on the action parent)
// are covered by cockpit/chat/generative-ui/python/tests/test_streaming.py:
// test_malformed_failed_missing_or_uncorrelated_results_roll_back_entire_batch,
// test_mixed_genuine_success_and_runtime_error_is_atomic and
// test_genuine_nonempty_parent_fallback_no_wrapper_or_data.
const { backend: config } = reactCockpitConfiguration('chat-generative-ui');
const backend = createAimockBackend({ root: resolve(__dirname, '../../../../..'), backend: config });
beforeAll(() => backend.ensure(), 180000);
afterAll(() => backend.close());
type Handler = (request: unknown, response: unknown, pathname: string) => Promise<boolean>;
async function fixture() {
  const handle: Handler = createLanggraphProxy({
    upstream: `http://127.0.0.1:${config.langgraphPort}`,
    ready: () => backend.ensure(),
  });
  const server: Server = createServer(async (req, res) => {
    if (!(await handle(req, res, new URL(req.url ?? '', 'http://localhost').pathname))) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const app = createConnectedApplication({
    apiUrl: base + '/api',
    headers: {},
  });
  onTestFinished(async () => {
    await app.dispose();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  const control = async (path: string, body?: object) => {
    expect(
      (await fetch(base + path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) })).status
    ).toBe(200);
  };
  const requests = async () =>
    (await (await fetch(base + '/__requests')).json()) as {
      path: string;
      method: string;
      body: Record<string, unknown>;
    }[];
  return { app, base, control, requests };
}
it('actual default session confirms initial, cancelled filter, structural and prose turns with exact requests', async () => {
  const f = await fixture();
  expect(await f.requests()).toEqual([]);
  const states: ReturnType<typeof f.app.getSnapshot>[] = [];
  f.app.subscribe(() => states.push(f.app.getSnapshot()));
  expect(await f.app.submit('Show dashboard')).toBe(true);
  const initial = f.app.getSnapshot();
  expect(initial.surfaces).toHaveLength(1);
  expect(Object.keys(initial.dashboard)).toHaveLength(7);
  expect(await f.app.submit('Filter to cancelled flights')).toBe(true);
  const filtered = f.app.getSnapshot();
  expect(filtered.surfaces).toEqual(initial.surfaces);
  expect(
    filtered.dashboard.recent_disruptions?.every((r) => r.type === 'cancelled')
  ).toBe(true);
  expect(await f.app.submit('Remove the table')).toBe(true);
  expect(f.app.getSnapshot().surfaces).toHaveLength(2);
  const structured = f.app.getSnapshot();
  expect(await f.app.submit('Why is on-time low?')).toBe(true);
  expect(f.app.getSnapshot().dashboard).toEqual(structured.dashboard);
  expect(f.app.getSnapshot().surfaces).toEqual(structured.surfaces);
  for (const s of states)
    if (s.busy && s.activity === 'confirming')
      expect(s.surfaces.length).toBeLessThanOrEqual(2);
  const requests = await f.requests();
  expect(requests).toHaveLength(17);
  expect(requests.filter((r) => r.path === '/api/threads')).toHaveLength(1);
  expect(requests.filter((r) => r.path.endsWith('/runs/stream'))).toHaveLength(
    4
  );
  expect(
    requests.filter((r) => r.method === 'GET' && /\/runs\/[^/]+$/.test(r.path))
  ).toHaveLength(4);
  expect(requests.filter((r) => r.path.endsWith('/history'))).toHaveLength(4);
  expect(
    requests.filter((r) => r.path.endsWith('/state/checkpoint'))
  ).toHaveLength(4);
}, 60000);
it.each(['missing', 'invalid'])(
  'actual %s decision confirms an honest saved no-op with the prior dashboard',
  async (decisionFault) => {
    const f = await fixture();
    expect(await f.app.submit('Show dashboard')).toBe(true);
    const prior = f.app.getSnapshot();
    // Real model output that admission rejects (fixtures).
    expect(
      await f.app.submit(`Filter to cancelled flights (${decisionFault === 'missing' ? 'no' : 'invalid'} decision)`)
    ).toBe(true);
    const saved = f.app.getSnapshot();
    expect(saved.dashboard).toEqual(prior.dashboard);
    expect(saved.surfaces).toEqual(prior.surfaces);
    expect(saved.toolCalls).toEqual(prior.toolCalls);
    expect(saved.messages.at(-1)?.content).toContain(
      'No dashboard changes were made.'
    );
    expect(saved.canSubmit).toBe(true);
    expect(
      (await f.requests()).filter((r) => r.path.endsWith('/runs/stream'))
    ).toHaveLength(2);
  },
  60000
);
it('actual failed read-only interpretation retains the confirmed dashboard and requires New', async () => {
  const f = await fixture();
  expect(await f.app.submit('Show dashboard')).toBe(true);
  const prior = f.app.getSnapshot();
  // The interpretation model fails for this prompt (fixture).
  expect(await f.app.submit('Why is on-time low? (interpreter down)')).toBe(false);
  expect(f.app.getSnapshot().dashboard).toBe(prior.dashboard);
  expect(f.app.getSnapshot().surfaces).toBe(prior.surfaces);
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  expect(
    (await f.requests()).filter((r) => r.path.endsWith('/runs/stream'))
  ).toHaveLength(2);
}, 60000);
it('actual pending task rejects confirmation and Stop preserves the confirmed board without retry', async () => {
  const f = await fixture();
  expect(await f.app.submit('Show dashboard')).toBe(true);
  const prior = f.app.getSnapshot();
  await f.control('/__state/unsafe');
  expect(await f.app.submit('Filter to cancelled flights')).toBe(false);
  expect(f.app.getSnapshot().surfaces).toBe(prior.surfaces);
  expect(f.app.getSnapshot().dashboard).toBe(prior.dashboard);
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  await f.app.newConversation();
  await f.control('/__state/safe');
  await f.control('/__hold/stream', { immediate: true });
  const pending = f.app.submit('Show dashboard');
  await vi.waitFor(async () =>
    expect(
      (await f.requests()).filter((r) => r.path.endsWith('/runs/stream'))
    ).toHaveLength(3)
  );
  await f.app.stop();
  await pending;
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  expect(
    (await f.requests()).filter((r) => r.path.endsWith('/runs/stream'))
  ).toHaveLength(3);
}, 60000);
it.each([
  'missing-terminal',
  'stale-terminal',
  'foreign-terminal',
  'old-message',
  'old-data',
  'incomplete-tools',
  'malformed-layout',
  'missing-dashboard',
  'disagreeing-dashboard',
  'task-error',
])(
  'actual saved %s fault cannot replace confirmed data or layouts',
  async (fault) => {
    const f = await fixture();
    expect(await f.app.submit('Show dashboard')).toBe(true);
    const prior = f.app.getSnapshot();
    // The confirmation's checkpoint read is rewritten (injected data).
    await f.control('/__state/' + fault);
    expect(
      await f.app.submit(
        fault === 'malformed-layout'
          ? 'Remove the table'
          : 'Filter to cancelled flights'
      )
    ).toBe(false);
    expect(f.app.getSnapshot().dashboard).toBe(prior.dashboard);
    expect(f.app.getSnapshot().surfaces).toBe(prior.surfaces);
    expect(f.app.getSnapshot().canSubmit).toBe(false);
    const count = (await f.requests()).length;
    expect(await f.app.submit('Follow up')).toBe(false);
    expect(await f.requests()).toHaveLength(count);
  },
  60000
);
it.each(['running', 'error'])(
  'actual independent exact run status %s cannot grant confirmation',
  async (runStatus) => {
    const f = await fixture();
    await f.control('/__run-status/' + runStatus);
    expect(await f.app.submit('Show dashboard')).toBe(false);
    expect(f.app.getSnapshot()).toMatchObject({
      canSubmit: false,
      surfaces: [],
      dashboard: {},
    });
    expect(
      (await f.requests()).filter(
        (r) => r.method === 'GET' && /\/runs\/[^/]+$/.test(r.path)
      )
    ).toHaveLength(1);
  },
  60000
);
