import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, onTestFinished } from 'vitest';
import { createConnectedApplication } from './connection';
import type { A2uiApplication } from './application';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Borrow the moved private presentation type.
import type { SurfaceView } from '../../../../../libs/cockpit-a2ui-react/src/surface';

/* eslint-disable @nx/enforce-module-boundaries -- Local test backend tooling is never bundled. */
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { createAimockBackend } from '../../../../../scripts/react-cockpit/aimock-backend.mjs';
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { createLanggraphProxy } from '../../../../../scripts/react-cockpit/langgraph-proxy.mjs';
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { reactCockpitConfiguration } from '../../../../../scripts/react-cockpit/configuration.mjs';
/* eslint-enable @nx/enforce-module-boundaries */

// The real graph runs under `langgraph dev` on aimock fixtures shared with the
// Angular example (cockpit/chat/a2ui/angular/e2e/fixtures); the in-process
// proxy records each /api request (scripts/react-cockpit/langgraph-proxy.mjs).
const { backend: config } = reactCockpitConfiguration('chat-a2ui');
const backend = createAimockBackend({ root: resolve(__dirname, '../../../../..'), backend: config });
beforeAll(() => backend.ensure(), 180000);
afterAll(() => backend.close());
type Handler = (request: unknown, response: unknown, pathname: string) => Promise<boolean>;
async function fixture() {
  const proxy: Handler = createLanggraphProxy({
    upstream: `http://127.0.0.1:${config.langgraphPort}`,
    ready: () => backend.ensure(),
  });
  const server: Server = createServer(async (req, res) => {
    if (!(await proxy(req, res, new URL(req.url ?? '', 'http://localhost').pathname))) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const app = createConnectedApplication({ apiUrl: base + '/api', headers: {} });
  onTestFinished(async () => {
    await app.dispose();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  const handle = {
    receipt: async () => ({ requests: await (await fetch(base + '/__requests')).json() }),
  };
  return { app, handle };
}
async function action(app: A2uiApplication, surface: SurfaceView, id: string) {
  expect(surface.actions[id]()).toBe(true);
  if (app.getSnapshot().busy)
    await new Promise<void>((resolve) => {
      const release = app.subscribe(() => {
        if (!app.getSnapshot().busy) {
          release();
          resolve();
        }
      });
    });
  expect(app.getSnapshot().error).toBeNull();
}
it('actual default SDK session admits the compiled graph four-turn edited Search, Select and Modify flow', async () => {
  const f = await fixture();
  expect((await f.handle.receipt()).requests).toEqual([]);
  const publications: ReturnType<typeof f.app.getSnapshot>[] = [];
  f.app.subscribe(() => publications.push(f.app.getSnapshot()));
  expect(await f.app.submit('I want to fly LAX to JFK')).toBe(true);
  const booking = f.app.getSnapshot().surfaces[0];
  expect(booking.kind).toBe('booking');
  booking.edits.origin('SFO');
  booking.edits.dest('SEA');
  booking.edits.date('2026-11-03');
  booking.edits.passengers('003');
  booking.edits.fare('Business');
  expect(booking.form?.getSnapshot().valid).toBe(true);
  await action(f.app, booking, 'submit');
  expect(booking.actions.submit()).toBe(false);
  expect(booking.form?.getSnapshot().drafts.passengers).toBe('003');
  const results = f.app.getSnapshot().surfaces.at(-1)!;
  expect(results.kind).toBe('results');
  await action(f.app, results, 'btn_0');
  const confirmation = f.app.getSnapshot().surfaces.at(-1)!;
  expect(confirmation.kind).toBe('confirmation');
  await action(f.app, confirmation, 'modify');
  const restored = f.app.getSnapshot().surfaces.at(-1)!;
  expect(restored.kind).toBe('booking');
  expect(restored.form?.getSnapshot().model).toEqual({
    origin: ['SFO'],
    dest: ['SEA'],
    date: '2026-11-03',
    passengers: 3,
    fare_class: ['Business'],
  });
  expect(f.app.getSnapshot().messages).toHaveLength(8);
  expect(f.app.getSnapshot().surfaces.map((s) => s.kind)).toEqual([
    'booking',
    'results',
    'confirmation',
    'booking',
  ]);
  for (const state of publications) {
    expect(state.messages.length).toBe(state.surfaces.length * 2);
    if (state.busy) expect(state.activeSurface).toBeNull();
  }
  const receipt = await f.handle.receipt();
  expect(
    receipt.requests.filter((r: { path: string }) => r.path === '/api/threads')
  ).toHaveLength(1);
  const create = receipt.requests.find(
    (r: { path: string }) => r.path === '/api/threads'
  );
  expect(create.body).toEqual({
    thread_id: f.app.getSnapshot().threadId,
    if_exists: 'raise',
    metadata: {},
  });
  const streams = receipt.requests.filter((r: { path: string }) =>
    r.path.endsWith('/runs/stream')
  );
  expect(streams).toHaveLength(4);
  expect(
    JSON.parse(streams[1].body.input.messages[0].content).action.context
  ).toMatchObject({ origin: ['SFO'], dest: ['SEA'], passengers: 3 });
  expect(
    receipt.requests.filter((r: { path: string }) =>
      r.path.endsWith('/history')
    )
  ).toHaveLength(4);
  const exact = receipt.requests.filter((r: { path: string }) =>
    r.path.endsWith('/state/checkpoint')
  );
  expect(exact).toHaveLength(4);
  expect(
    exact.every(
      (r: {
        body: {
          checkpoint: {
            checkpoint_ns: string;
            checkpoint_id: string;
            thread_id: string;
          };
        };
      }) =>
        r.body.checkpoint.checkpoint_ns === '' &&
        !!r.body.checkpoint.checkpoint_id &&
        r.body.checkpoint.thread_id === f.app.getSnapshot().threadId
    )
  ).toBe(true);
  // Each turn's run status was read once from the real server.
  expect(
    receipt.requests.filter(
      (r: { method: string; path: string }) => r.method === 'GET' && /\/runs\/[^/]+$/.test(r.path)
    )
  ).toHaveLength(4);
}, 60000);
