import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  root,
  preparationLock,
} from '../../fixtures/react-parity/native-strands-react/configuration.mjs';
import { existsSync } from 'node:fs';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bounded = async (promise, ms = 16000) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise(
        (_, reject) =>
          (timer = setTimeout(() => reject(Error('Operation deadline')), ms))
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
async function setup(t, options) {
  const module = await import('./native-strands-fixture.mjs').catch(() => null);
  assert.ok(module, 'Native Strands tap must exist');
  const fixture = module.createNativeStrandsFixture(options);
  const server = createServer(async (req, res) => {
    if (!(await fixture(req, res, new URL(req.url, 'http://local').pathname)))
      res.writeHead(404).end();
  });
  t.after(async () => {
    await fixture.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { fixture, url: `http://127.0.0.1:${server.address().port}`, module };
}
let createSession, bundle;
test.before(async () => {
  bundle = await mkdtemp(join(tmpdir(), 'strands-session-test-'));
  await build({
    stdin: {
      contents: `export {createSession} from ${JSON.stringify(
        root + '/libs/ag-ui/src/runtime/create-session.ts'
      )}`,
      resolveDir: root,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    tsconfig: root + '/tsconfig.base.json',
    outfile: bundle + '/session.mjs',
  });
  ({ createSession } = await import(pathToFileURL(bundle + '/session.mjs')));
});
test.after(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true });
});
const events = (entry) =>
  Buffer.from(entry.upstreamBase64, 'base64')
    .toString()
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice(6)));
for (const scenario of ['approval', 'batch'])
  for (const approved of [true, false])
    test(
      `genuine ${scenario} ${
        approved ? 'approve' : 'decline'
      } preserves original Session pause, bytes and canonical authority`,
      { timeout: 40000 },
      async (t) => {
        const { fixture, url } = await setup(t);
        await fixture.reset({ scenario });
        const session = createSession({
          url: url + '/runtimes/aws-strands/agent',
          threadId: crypto.randomUUID(),
        });
        t.after(() => session.dispose());
        const paused = await bounded(
          session.submit(
            'Book the fictional Q3 roadmap review on Tuesday at 10:00 after checking availability.'
          )
        );
        assert.equal(paused, 'paused');
        const decision = session.getSnapshot().decision;
        assert.equal(decision.kind, 'native');
        assert.equal(decision.interrupts[0].reason, 'book_meeting');
        assert.deepEqual(decision.interrupts[0].metadata.reason, {
          topic: 'Q3 roadmap review',
          slot: 'Tuesday 10:00',
        });
        const before = await (await fetch(url + '/__stats')).json();
        assert.equal(before.current.observed.entries, 1);
        assert.equal(before.current.observed.completedReturns.length, 0);
        assert.equal(
          before.current.observed.backendState.booking.status,
          'pending'
        );
        const outcome = await bounded(
          session.resume(
            decision.id,
            decision.interrupts.map((i) => ({
              interruptId: i.id,
              status: 'resolved',
              payload: { approved },
            }))
          )
        );
        assert.equal(outcome, 'success');
        const stats = await (await fetch(url + '/__stats')).json(),
          current = stats.current;
        assert.equal(current.requests.length, 2);
        assert.equal(
          current.observed.model.httpSeen,
          scenario === 'batch' ? 2 : 3
        );
        assert.equal(current.observed.entries, 2);
        assert.equal(current.observed.interruptedUnwinds, 1);
        assert.equal(current.observed.completedReturns.length, 1);
        assert.equal(
          current.observed.backendState.booking.status,
          approved ? 'booked' : 'declined'
        );
        assert.equal(
          current.observed.observedState.booking.status,
          scenario === 'batch' ? (approved ? 'booked' : 'declined') : 'pending'
        );
        const canonical = approved
          ? 'Meeting booked for Tuesday 10:00: Q3 roadmap review'
          : 'The human declined. Meeting NOT booked: Q3 roadmap review';
        const all = current.requests.flatMap(events),
          result = all.find(
            (e) =>
              e.type === 'TOOL_CALL_RESULT' &&
              JSON.parse(e.content) === canonical
          );
        assert.ok(result);
        const call = all.find(
          (e) =>
            e.type === 'TOOL_CALL_START' && e.toolCallName === 'book_meeting'
        );
        assert.equal(result.toolCallId, call.toolCallId);
        const terminal = events(current.requests[1]).find(
          (e) => e.type === 'RUN_FINISHED'
        );
        assert.equal(terminal.outcome.type, 'success');
        assert.equal(terminal.runId, current.requests[1].body.runId);
        const snapshots = all
          .filter((e) => e.type === 'STATE_SNAPSHOT')
          .map((e) => e.snapshot.booking?.status)
          .filter(Boolean);
        assert.ok(snapshots.includes('pending'));
        assert.equal(
          snapshots.at(-1),
          scenario === 'batch' ? (approved ? 'booked' : 'declined') : 'pending'
        );
        for (const entry of current.requests)
          assert.equal(entry.upstreamBase64, entry.sentBase64);
        assert.equal(
          current.observed.model.records.at(-1).canonicalContinuation,
          canonical
        );
        assert.ok(
          current.observed.model.records.every(
            (r) =>
              r.requestHeaders.find(
                ([key]) => key.toLowerCase() === 'x-stainless-retry-count'
              )?.[1] === '0'
          )
        );
        await session.dispose();
        await fixture.close();
        const receipt = fixture.stats().closed[0];
        assert.ok(Object.values(receipt.closure).every(Boolean));
        assert.equal(existsSync(preparationLock), false);
      }
    );
test(
  'two explicit booking turns in the same native Session use distinct current tool identities',
  { timeout: 40000 },
  async (t) => {
    const { fixture, url } = await setup(t);
    await fixture.reset({ scenario: 'batch' });
    const session = createSession({
      url: url + '/runtimes/aws-strands/agent',
      threadId: crypto.randomUUID(),
    });
    t.after(() => session.dispose());
    for (const approved of [true, false]) {
      await bounded(
        session.submit(
          'Book the fictional Q3 roadmap review on Tuesday at 10:00 after checking availability.'
        )
      );
      const d = session.getSnapshot().decision;
      assert.equal(d.kind, 'native');
      await bounded(
        session.resume(
          d.id,
          d.interrupts.map((i) => ({
            interruptId: i.id,
            status: 'resolved',
            payload: { approved },
          }))
        )
      );
    }
    const stats = await (await fetch(url + '/__stats')).json();
    const starts = stats.current.requests
      .flatMap(events)
      .filter(
        (e) => e.type === 'TOOL_CALL_START' && e.toolCallName === 'book_meeting'
      );
    assert.equal(starts.length, 2);
    assert.notEqual(starts[0].toolCallId, starts[1].toolCallId);
    assert.equal(stats.current.observed.model.httpSeen, 4);
  }
);
test(
  'New after pause and completion starts fresh histories without reusing prior authority',
  { timeout: 40000 },
  async (t) => {
    const { fixture, url } = await setup(t);
    await fixture.reset({ scenario: 'batch' });
    const ids = [];
    for (const approve of [null, true, false]) {
      const session = createSession({
        url: url + '/runtimes/aws-strands/agent',
        threadId: crypto.randomUUID(),
      });
      try {
        assert.equal(
          await bounded(
            session.submit(
              'Book the fictional Q3 roadmap review on Tuesday at 10:00 after checking availability.'
            )
          ),
          'paused'
        );
        const d = session.getSnapshot().decision;
        ids.push(d.interrupts[0].id);
        if (approve !== null)
          assert.equal(
            await bounded(
              session.resume(
                d.id,
                d.interrupts.map((i) => ({
                  interruptId: i.id,
                  status: 'resolved',
                  payload: { approved: approve },
                }))
              )
            ),
            'success'
          );
      } finally {
        await bounded(session.dispose(), 4000);
      }
    }
    assert.equal(new Set(ids).size, 3);
    const stats = await (await fetch(url + '/__stats')).json();
    assert.equal(stats.current.observed.model.httpSeen, 5);
    assert.equal(stats.current.observed.completedReturns.length, 2);
  }
);
for (const action of ['stop', 'dispose'])
  test(
    `native held ${action} closes actual provider peer before owner cleanup`,
    { timeout: 30000 },
    async (t) => {
      const { fixture, url } = await setup(t);
      await fixture.reset({ scenario: 'cancel' });
      const session = createSession({
        url: url + '/runtimes/aws-strands/agent',
        threadId: crypto.randomUUID(),
      });
      t.after(() => session.dispose());
      const pending = session.submit(
        'Book the fictional Q3 roadmap review on Tuesday at 10:00 after checking availability.'
      );
      let seen;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        seen = await (await fetch(url + '/__stats')).json();
        if (seen.current.observed.model.heldActive) break;
        await pause(25);
      }
      assert.equal(seen.current.observed.model.heldActive, 1);
      await bounded(session[action](), 4000);
      assert.equal(await bounded(pending, 4000), 'aborted');
      const peerDeadline = Date.now() + 3000;
      while (Date.now() < peerDeadline) {
        seen = await (await fetch(url + '/__stats')).json();
        if (
          seen.current.observed.model.records[0].peerClosed &&
          seen.current.observed.model.active === 0
        )
          break;
        await pause(25);
      }
      const record = seen.current.observed.model.records[0];
      assert.equal(record.peerClosed, true);
      assert.equal(record.cleanupReleased, false);
      assert.equal(seen.current.observed.entries, 0);
      await fixture.close();
      assert.ok(
        Object.values(fixture.stats().closed[0].closure).every(Boolean)
      );
    }
  );
test(
  'tap guards routes, serializes resets and closes incomplete caller bodies',
  { timeout: 30000 },
  async (t) => {
    const { fixture, url, module } = await setup(t);
    assert.equal((await fetch(url + '/unknown')).status, 404);
    assert.equal((await fetch(url + '/__reset')).status, 405);
    await Promise.all([fixture.reset(), fixture.reset({ scenario: 'batch' })]);
    assert.equal(fixture.stats().closed.length, 1);
    assert.equal(fixture.stats().current.scenario, 'batch');
    assert.equal(
      (
        await fetch(url + '/runtimes/aws-strands/agent', {
          method: 'POST',
          body: '{broken',
        })
      ).status,
      500
    );
    assert.equal(
      Buffer.from(
        fixture.stats().current.requests[0].requestBase64,
        'base64'
      ).toString(),
      '{broken'
    );
    const partial = httpRequest(url + '/runtimes/aws-strands/agent', {
      method: 'POST',
    });
    partial.on('error', () => {});
    partial.write('{partial');
    const deadline = Date.now() + 1000;
    while (fixture.stats().current.requests.length < 2 && Date.now() < deadline)
      await pause(5);
    assert.equal(fixture.stats().current.active, 1);
    await Promise.all([fixture.close(), fixture.close()]);
    partial.destroy();
    assert.equal(fixture.stats().closed[1].active, 0);
    const terminal =
      'data: {"type":"RUN_FINISHED","runId":"r","threadId":"t","outcome":{"type":"success"}}\n\n';
    assert.equal(module.transformFrame(terminal, 'missing-terminal'), '');
    assert.match(
      module.transformFrame(terminal, 'wrong-terminal'),
      /negative-wrong-run/
    );
    assert.match(
      module.transformFrame(terminal, 'child-only-terminal'),
      /SUBAGENT_FINISHED/
    );
    assert.equal(module.transformFrame(terminal, 'approval'), terminal);
  }
);

for (const scenario of [
  'missing-terminal',
  'wrong-terminal',
  'child-only-terminal',
])
  test(
    `negative ${scenario} retains genuine upstream terminal and canonical result`,
    { timeout: 30000 },
    async (t) => {
      const { fixture, url } = await setup(t);
      await fixture.reset({ scenario });
      const session = createSession({
        url: url + '/runtimes/aws-strands/agent',
        threadId: crypto.randomUUID(),
      });
      t.after(() => session.dispose());
      assert.equal(
        await bounded(
          session.submit(
            'Book the fictional Q3 roadmap review on Tuesday at 10:00 after checking availability.'
          )
        ),
        'paused'
      );
      const d = session.getSnapshot().decision;
      await bounded(
        session.resume(
          d.id,
          d.interrupts.map((i) => ({
            interruptId: i.id,
            status: 'resolved',
            payload: { approved: true },
          }))
        )
      );
      const stats = await (await fetch(url + '/__stats')).json(),
        entries = stats.current.requests;
      assert.equal(entries.length, 2);
      assert.equal(entries[0].upstreamBase64, entries[0].sentBase64);
      const entry = entries[1],
        native = events(entry);
      const upstreamTerminal = native.find((e) => e.type === 'RUN_FINISHED');
      assert.equal(upstreamTerminal.runId, entry.body.runId);
      assert.equal(upstreamTerminal.outcome.type, 'success');
      assert.ok(
        native.some(
          (e) =>
            e.type === 'TOOL_CALL_RESULT' &&
            JSON.parse(e.content) ===
              'Meeting booked for Tuesday 10:00: Q3 roadmap review'
        )
      );
      const sent = events({ ...entry, upstreamBase64: entry.sentBase64 });
      assert.equal(
        sent.some(
          (e) => e.type === 'RUN_FINISHED' && e.runId === entry.body.runId
        ),
        false
      );
      assert.equal(stats.current.observed.model.httpSeen, 3);
      if (scenario === 'child-only-terminal')
        assert.ok(sent.some((e) => e.type === 'SUBAGENT_FINISHED'));
    }
  );

test(
  'absolute operation deadline closes a partial caller body before owner shutdown',
  { timeout: 30000 },
  async (t) => {
    const { fixture, url } = await setup(t, { operationMs: 100 });
    await fixture.reset();
    const partial = httpRequest(url + '/runtimes/aws-strands/agent', {
      method: 'POST',
    });
    partial.on('error', () => {});
    partial.write('{partial');
    t.after(() => partial.destroy());
    const deadline = Date.now() + 1500;
    while (
      Date.now() < deadline &&
      !fixture.stats().current.requests[0]?.deadlineExceeded
    )
      await pause(10);
    const stats = fixture.stats().current;
    assert.equal(stats.requests[0]?.deadlineExceeded, true);
    assert.equal(stats.active, 0);
  }
);

for (const action of ['deadline', 'close'])
  test(
    `partial reset ${action} settles without backend allocation`,
    { timeout: 3000 },
    async (t) => {
      const { createNativeStrandsFixture } = await import(
        './native-strands-fixture.mjs'
      );
      const fixture = createNativeStrandsFixture({
        operationMs: action === 'deadline' ? 30 : 5000,
      });
      const request = new PassThrough();
      request.method = 'POST';
      const response = new PassThrough();
      response.writeHead = () => response;
      const handled = fixture(request, response, '/__reset');
      t.after(async () => {
        request.destroy();
        response.destroy();
        await fixture.close();
        await handled;
      });
      request.write('{partial');
      // Let the async iterator retain the received chunk before closing its peer.
      await pause(0);
      if (action === 'close') await bounded(fixture.close(), 300);
      else await pause(150);
      assert.equal(request.destroyed, true);
      assert.equal(response.destroyed, true);
      assert.equal(await bounded(handled, 300), true);
      const stats = fixture.stats();
      assert.equal(stats.current, null);
      assert.deepEqual(stats.closed, []);
      assert.equal(stats.activeControls, 0);
      assert.equal(stats.controlRequests.length, 1);
      assert.equal(
        Buffer.from(
          stats.controlRequests[0].requestBase64,
          'base64'
        ).toString(),
        '{partial'
      );
      assert.equal(
        stats.controlRequests[0].deadlineExceeded,
        action === 'deadline'
      );
      assert.equal(response.listenerCount('close'), 0);
      assert.equal(existsSync(preparationLock), false);
      await fixture.close();
      await assert.rejects(fixture.reset(), /Fixture closed/);
      const lateRequest = new PassThrough();
      lateRequest.method = 'POST';
      const lateResponse = new PassThrough();
      let status;
      lateResponse.writeHead = (value) => {
        status = value;
        return lateResponse;
      };
      try {
        assert.equal(
          await bounded(fixture(lateRequest, lateResponse, '/__reset'), 300),
          true
        );
        assert.equal(status, 500);
        assert.equal(fixture.stats().controlRequests.length, 1);
      } finally {
        lateRequest.destroy();
        lateResponse.destroy();
      }
    }
  );
