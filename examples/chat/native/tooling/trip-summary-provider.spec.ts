import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { observeProvider } from './canonical-provider';

test(
  'summary boundary drains real acknowledgement, withholds downstream, and records cancellation before cleanup',
  { timeout: 10000 },
  async (t) => {
    const received: string[] = [];
    const upstream = createServer(async (q, r) => {
      for await (const _ of q) {
      }
      received.push(q.url!);
      r.setHeader('content-type', 'application/json');
      r.end('{"checkpoint_id":"actual"}');
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve)
    );
    const address = upstream.address();
    assert.ok(address && typeof address !== 'string');
    const observer = await Reflect.apply(observeProvider, undefined, [
      address.port,
      'trip-summary',
    ]);
    t.after(async () => {
      await observer.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    });
    const body = JSON.stringify({
      values: {
        messages: [
          {
            id: 'client-tool-result-call',
            role: 'tool',
            type: 'tool',
            tool_call_id: 'call',
            content: 'Actual summary',
          },
        ],
      },
    });
    const first = await fetch(observer.url + '/threads/positive/state', {
      method: 'POST',
      body,
    });
    await first.text();
    assert.equal(
      observer.requests[0].forwarded,
      true,
      'Observer must distinguish actual forwarding from attempted writes'
    );
    const controller = new AbortController();
    const held = fetch(observer.url + '/threads/held/state', {
      method: 'POST',
      body,
      signal: controller.signal,
    });
    void held.catch(() => {});
    const barrier = await fetch(observer.controlUrl + '/held-stop/accepted');
    const accepted = await barrier.json();
    assert.equal(accepted.upstreamComplete, true);
    assert.equal(accepted.upstreamStatus, 200);
    assert.equal(accepted.downstreamHeadersSent, false);
    assert.equal(received.length, 2);
    controller.abort();
    await assert.rejects(held);
    const closed = await (
      await fetch(observer.controlUrl + '/held-stop/closed')
    ).json();
    assert.equal(closed.downstreamClosedBeforeCleanup, true);
    assert.equal(closed.downstreamFinished, false);
  }
);

test(
  'summary rejection is never forwarded and control paths cannot configure a fault',
  { timeout: 10000 },
  async (t) => {
    let forwards = 0;
    const upstream = createServer(async (q, r) => {
      for await (const _ of q) {
      }
      forwards++;
      r.end('{}');
    });
    await new Promise<void>((yes) => upstream.listen(0, '127.0.0.1', yes));
    const address = upstream.address();
    assert.ok(address && typeof address !== 'string');
    const observer = await observeProvider(address.port, 'trip-summary');
    assert.ok(observer.controlUrl);
    t.after(async () => {
      await observer.close();
      upstream.closeAllConnections();
      await new Promise<void>((yes) => upstream.close(() => yes()));
    });
    const body = JSON.stringify({ values: { messages: [] } });
    await (
      await fetch(observer.url + '/threads/first/state', {
        method: 'POST',
        body,
      })
    ).text();
    for (const phase of ['held-stop', 'held-selection']) {
      const controller = new AbortController();
      const response = fetch(observer.url + '/threads/' + phase + '/state', {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      void response.catch(() => {});
      await (
        await fetch(observer.controlUrl + '/' + phase + '/accepted')
      ).json();
      controller.abort();
      await assert.rejects(response);
      await (await fetch(observer.controlUrl + '/' + phase + '/closed')).json();
    }
    const result = await fetch(observer.url + '/threads/rejected/state', {
      method: 'POST',
      body,
    });
    assert.equal(result.status, 503);
    await result.text();
    const fact = (await (
      await fetch(observer.controlUrl + '/rejected/observed')
    ).json()) as { forwarded: boolean };
    assert.equal(fact.forwarded, false);
    assert.equal(forwards, 3);
    assert.equal(observer.requests.length, 4);
    for (const url of [
      new URL('/held-stop/accepted', observer.controlUrl).href,
      observer.controlUrl + '/arm',
      observer.controlUrl + '/held-stop/accepted?target=http://127.0.0.1:1',
    ])
      assert.equal((await fetch(url)).status, 404);
    assert.equal(
      (
        await fetch(observer.controlUrl + '/held-stop/accepted', {
          method: 'POST',
          body: '{}',
        })
      ).status,
      404
    );
  }
);

test(
  'summary cleanup destruction cannot count as client cancellation',
  { timeout: 10000 },
  async (t) => {
    const upstream = createServer(async (q, r) => {
      for await (const _ of q) {
      }
      r.end('{}');
    });
    await new Promise<void>((yes) => upstream.listen(0, '127.0.0.1', yes));
    const address = upstream.address();
    assert.ok(address && typeof address !== 'string');
    const observer = await observeProvider(address.port, 'trip-summary');
    assert.ok(observer.controlUrl);
    t.after(async () => {
      await observer.close();
      upstream.closeAllConnections();
      await new Promise<void>((yes) => upstream.close(() => yes()));
    });
    await (
      await fetch(observer.url + '/threads/first/state', {
        method: 'POST',
        body: '{}',
      })
    ).text();
    const held = fetch(observer.url + '/threads/held/state', {
      method: 'POST',
      body: '{}',
    });
    void held.catch(() => {});
    await (await fetch(observer.controlUrl + '/held-stop/accepted')).json();
    await observer.close();
    await assert.rejects(held);
    assert.equal(observer.requests[1].downstreamClosedBeforeCleanup, false);
  }
);

test('summary lifecycle overrides cannot publish an accepted production receipt', async (t) => {
  const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runTripSummaryProvider, acceptTripSummaryCapture } = await import(
    './trip-summary-provider'
  );
  const temporaryParent = mkdtempSync(
    join(tmpdir(), 'summary-acceptance-control-')
  );
  t.after(() => rmSync(temporaryParent, { recursive: true, force: true }));
  const evidenceDirectory = join(temporaryParent, 'evidence');
  const result = await runTripSummaryProvider({
    root: process.cwd(),
    temporaryParent,
    evidenceDirectory,
    operations: {
      prepare: async () => {},
      providerCommand: async ({ port }) => ({
        command: process.execPath,
        args: [
          '-e',
          `const h=require('node:http');h.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(q.url==='/ok'?'{}':JSON.stringify([{graph_id:'chat'}]));}).listen(${port},'127.0.0.1',()=>console.log('API: http://127.0.0.1:${port}\\nApplication started up in 0.001s'));`,
        ],
        cwd: process.cwd(),
        env: process.env,
      }),
      exercise: async () => ({ cases: [], modelJournal: [] }),
    },
  });
  assert.equal(result.accepted, false);
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(existsSync(result.temporary), false);
  assert.throws(
    () => acceptTripSummaryCapture(result, evidenceDirectory),
    /Test operations/
  );
  assert.throws(
    () =>
      Reflect.apply(acceptTripSummaryCapture, undefined, [
        { ...result, testOperations: false, cleanupConfirmed: false },
        evidenceDirectory,
      ]),
    /Confirmed cleanup/
  );
  assert.throws(() =>
    acceptTripSummaryCapture(
      { ...result, testOperations: false },
      evidenceDirectory
    )
  );
  assert.equal(existsSync(join(evidenceDirectory, 'capture.json')), true);
  assert.equal(existsSync(join(evidenceDirectory, 'evidence.json')), false);
});
