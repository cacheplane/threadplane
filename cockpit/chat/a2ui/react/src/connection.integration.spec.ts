import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, onTestFinished } from 'vitest';
import { createConnectedApplication } from './connection';
import type { A2uiApplication, SurfaceView } from './application';

async function fixture() {
  const location = new URL(
    '../../../../../scripts/react-cockpit/chat-a2ui-fixture.mjs',
    import.meta.url
  ).href;
  const { createChatA2uiFixture, fixtureConfiguration } = await import(
    /* @vite-ignore */ location
  );
  // Existing fixture prepares one frozen isolated Python environment; no model credentials.
  const evidence = mkdtempSync(
    join(tmpdir(), 'threadplane-chat-a2ui-task3-sdk-')
  );
  const handle = createChatA2uiFixture({
    configuration: fixtureConfiguration(),
  });
  const server = createServer(async (req, res) => {
    if (
      !(await handle(
        req,
        res,
        new URL(req.url ?? '', 'http://localhost').pathname
      ))
    ) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const app = createConnectedApplication({
    apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,
    headers: {},
  });
  onTestFinished(async () => {
    await app.dispose();
    await handle.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    const receipt = handle.receipt();
    writeFileSync(
      join(evidence, 'receipt.json'),
      JSON.stringify(receipt, null, 2) + '\n',
      { mode: 0o600 }
    );
    console.log('Task 3 actual SDK evidence: ' + evidence);
    expect(receipt.worker.reaped).toBe(true);
    expect(receipt.worker.pythonAbsent).toBe(true);
  });
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
  expect(f.handle.receipt().requests).toEqual([]);
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
  const receipt = f.handle.receipt();
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
  expect(
    receipt.runReads.map((r: { run: { status: string } }) => r.run.status)
  ).toEqual(['success', 'success', 'success', 'success']);
  expect(
    receipt.proofs.every(
      (p: { actualCompiledGraph: boolean; networkConnectAttempts: number }) =>
        p.actualCompiledGraph && p.networkConnectAttempts === 0
    )
  ).toBe(true);
  expect(
    receipt.proofs.some((p: { tools?: { name: string }[] }) =>
      p.tools?.some((t) => t.name === '_lookup_flight_impl')
    )
  ).toBe(true);
}, 60000);
