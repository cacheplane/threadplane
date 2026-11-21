import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createPlanningClient } from './connection';
import { createPlanningApplication } from './application';

/* eslint-disable @nx/enforce-module-boundaries -- Local test backend tooling is never bundled. */
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { createAimockBackend } from '../../../../../scripts/react-cockpit/aimock-backend.mjs';
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { createLanggraphProxy } from '../../../../../scripts/react-cockpit/langgraph-proxy.mjs';
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { reactCockpitConfiguration } from '../../../../../scripts/react-cockpit/configuration.mjs';
/* eslint-enable @nx/enforce-module-boundaries */

// The real graph runs under `langgraph dev` on aimock fixtures shared with the
// Angular example (cockpit/deep-agents/planning/angular/e2e/fixtures). Each
// scenario is a tagged prompt; the in-process proxy records requests and holds
// or fails the next call (scripts/react-cockpit/langgraph-proxy.mjs).
const { backend: config } = reactCockpitConfiguration('deep-agents-planning');
const backend = createAimockBackend({ root: resolve(__dirname, '../../../../..'), backend: config });
beforeAll(() => backend.ensure(), 180000);
afterAll(() => backend.close());
type Handler = (request: unknown, response: unknown, pathname: string) => Promise<boolean>;
let server: Server | undefined,
  application: ReturnType<typeof createPlanningApplication> | undefined;
afterEach(async () => {
  await application?.dispose();
  if (server)
    await new Promise<void>((done) => {
      server?.close(() => done());
      server?.closeAllConnections();
    });
});
async function setup() {
  const handle: Handler = createLanggraphProxy({
    upstream: `http://127.0.0.1:${config.langgraphPort}`,
    ready: () => backend.ensure(),
  });
  const http = createServer(async (req, res) => {
    if (!(await handle(req, res, new URL(req.url ?? '/', 'http://localhost').pathname))) {
      res.writeHead(404);
      res.end();
    }
  });
  server = http;
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw Error('No address');
  const base = `http://127.0.0.1:${address.port}`,
    client = createPlanningClient({ apiUrl: base + '/api', headers: {} });
  const read = vi.spyOn(client, 'readCheckpoint'),
    created = createPlanningApplication(client);
  application = created;
  let scenario = 'normal';
  const control = async (path: string) =>
    expect((await fetch(base + path, { method: 'POST' })).ok).toBe(true);
  // The scenario tag selects the scripted model turns (shared fixtures).
  const app = Object.assign(Object.create(created) as typeof created, {
    submit: (text: string) => created.submit(`${text} [scenario:${scenario}]`),
  });
  const configure = async (
    next: string,
    extra: { failStream?: boolean; holdCheckpoint?: boolean } = {}
  ) => {
    scenario = next;
    if (extra.failStream) await control('/__fail-stream');
    if (extra.holdCheckpoint) await control('/__hold/state');
  };
  const release = async () => {
    await control('/__release-state');
    await control('/__release');
  };
  return { app, client, read, base, configure, release };
}
it('first native transport failure before any checkpoint honestly requires New; a fresh conversation succeeds', async () => {
  const f = await setup();
  await f.configure('normal', { failStream: true });
  expect(await f.app.submit('First')).toBe(false);
  expect(f.app.getSnapshot()).toMatchObject({
    phase: 'failed',
    canSubmit: false,
  });
  expect(await f.app.submit('Retry')).toBe(false);
  await f.app.newConversation();
  expect(await f.app.submit('Fresh')).toBe(true);
  expect(f.app.getSnapshot().phase).toBe('saved');
}, 30000);
it('native session confirms actual middleware writes, exact checkpoint, unfinished rows, and second-send empty clear', async () => {
  const f = await setup();
  expect(await (await fetch(f.base + '/__requests')).json()).toEqual([]);
  expect(await f.app.submit('Plan a thoughtful project launch')).toBe(true);
  expect(f.app.getSnapshot()).toMatchObject({
    phase: 'saved',
    savedPlan: {
      kind: 'valid',
      items: expect.arrayContaining([
        { content: expect.any(String), status: 'in_progress' },
      ]),
    },
  });
  await f.configure('empty');
  expect(await f.app.submit('Clear the plan')).toBe(true);
  expect(f.app.getSnapshot().savedPlan).toEqual({ kind: 'valid', items: [] });
}, 30000);
for (const scenario of ['parallel', 'schema'])
  it(`actual ${scenario} rejection is a received core result, never saved authority; later native recovery succeeds`, async () => {
    const f = await setup();
    await f.app.submit('Initial');
    const saved = f.app.getSnapshot().savedPlan;
    await f.configure(scenario);
    expect(await f.app.submit('Rejected update')).toBe(false);
    expect(f.app.getSnapshot()).toMatchObject({
      phase: 'unconfirmed',
      savedPlan: saved,
    });
    expect(
      f.app
        .getSnapshot()
        .toolCalls.some(
          (call) => call.status === 'error' && call.name === 'write_todos'
        )
    ).toBe(true);
    await f.configure('recovery');
    expect(await f.app.submit('Recover with a valid write')).toBe(true);
    expect(f.app.getSnapshot()).toMatchObject({
      phase: 'saved',
      savedPlan: {
        kind: 'valid',
        items: [{ content: 'Recovered', status: 'in_progress' }],
      },
    });
  }, 30000);
it('actual changed unconfirmed prefix cannot lend its plan to no-write; subsequent legitimate replacement recovers', async () => {
  const f = await setup();
  await f.app.submit('Initial');
  const saved = f.app.getSnapshot().savedPlan;
  await f.configure('duplicates');
  f.read.mockRejectedValueOnce(Error('Unavailable exact read'));
  expect(await f.app.submit('Changed live')).toBe(false);
  expect(f.app.getSnapshot()).toMatchObject({
    phase: 'unconfirmed',
    savedPlan: saved,
  });
  await f.configure('no-write');
  expect(await f.app.submit('Just answer')).toBe(false);
  expect(f.app.getSnapshot()).toMatchObject({
    phase: 'unconfirmed',
    savedPlan: saved,
  });
  await f.configure('recovery');
  expect(await f.app.submit('Recover')).toBe(true);
  expect(f.app.getSnapshot().phase).toBe('saved');
}, 30000);
it('stop rejects late owned checkpoint publications and preserves prior saved display', async () => {
  const f = await setup();
  await f.app.submit('Initial');
  const saved = f.app.getSnapshot().savedPlan;
  await f.configure('duplicates', { holdCheckpoint: true });
  const pending = f.app.submit('Changed');
  await vi.waitFor(() => expect(f.app.getSnapshot().phase).toBe('confirming'), {
    timeout: 10000,
  });
  await f.app.stop();
  const stopped = f.app.getSnapshot();
  await f.release();
  await pending;
  expect(f.app.getSnapshot()).toBe(stopped);
  expect(stopped).toMatchObject({
    phase: 'stopped',
    savedPlan: saved,
    canSubmit: false,
  });
}, 30000);
