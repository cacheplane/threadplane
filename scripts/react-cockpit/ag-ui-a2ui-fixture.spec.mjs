import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { pidAbsent } from '../../fixtures/react-parity/native-ag-ui-a2ui/server.mjs';

const module = await import('./ag-ui-a2ui-fixture.mjs').catch(() => ({}));
test('native A2UI exports an import-inert owned fixture manager', () => {
  assert.equal(typeof module.createAgUiA2uiFixture, 'function');
});

const body = (threadId, turn = 0) =>
  Buffer.from(
    JSON.stringify({
      threadId,
      runId: `${threadId}-${turn}`,
      messages: [],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    })
  );
async function setup(options = {}) {
  const acquired = [];
  const fixture = module.createAgUiA2uiFixture({
    retain: await mkdtemp(join(tmpdir(), 'native-a2ui-manager-test-')),
    acquire: async ({ threadId, retain }) => {
      const calls = [];
      let closed = false;
      const resource = {
        threadId,
        retain,
        calls,
        closed: () => closed,
        url: 'http://127.0.0.1:12345/agent',
        fetch: async (_url, init) => {
          calls.push(Buffer.from(init.body));
          return new Response('canonical encoded bytes\r\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        },
        stats: () => ({
          ready: { pid: 1000 + acquired.indexOf(resource) },
          requests: calls.map((raw) => ({ rawBody: raw.toString() })),
          closure: {
            worker: closed,
            listener: closed,
            sockets: closed,
            responses: closed,
          },
        }),
        close: async () => {
          closed = true;
        },
      };
      acquired.push(resource);
      return resource;
    },
    ...options,
  });
  await fixture.reset();
  return { fixture, acquired };
}
const lifecycle =
  typeof module.createAgUiA2uiFixture === 'function' ? test : test.skip;
lifecycle(
  'sequential conversations each acquire one canonical child and preserve all four raw requests',
  async () => {
    const { fixture, acquired } = await setup();
    try {
      for (const thread of ['first', 'new'])
        for (let turn = 0; turn < 4; turn++) {
          const raw = body(thread, turn);
          const result = await fixture.forward(raw);
          assert.equal(result.status, 200);
          assert.deepEqual(
            result.bytes,
            Buffer.from('canonical encoded bytes\r\n')
          );
          assert.deepEqual(acquired.at(-1).calls.at(-1), raw);
        }
      assert.equal(acquired.length, 2);
      assert.notEqual(acquired[0].retain, acquired[1].retain);
      await assert.rejects(fixture.forward(body('first', 5)), /bound/);
    } finally {
      await fixture.close();
    }
    assert.ok(acquired.every((owner) => owner.closed()));
  }
);
lifecycle(
  'reset closes all old owners before fresh generation and archives immutable receipts',
  async () => {
    const { fixture, acquired } = await setup();
    await fixture.forward(body('first'));
    await fixture.forward(body('second'));
    await fixture.reset();
    assert.ok(acquired.every((owner) => owner.closed()));
    const before = fixture.receipt();
    assert.equal(before.archived.length, 1);
    assert.equal(before.archived[0].owners.length, 2);
    await assert.rejects(fixture.forward(body('first')), /reused/);
    await fixture.forward(body('third'));
    assert.deepEqual(fixture.receipt().archived, before.archived);
    await fixture.close();
  }
);
lifecycle(
  'held response belongs only to captured old request while New uses a fresh child',
  async () => {
    const { fixture, acquired } = await setup();
    fixture.hold();
    const old = fixture.forward(body('old'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.receipt().current.holds, 1);
    fixture.hold(false);
    const fresh = await fixture.forward(body('new'));
    assert.equal(fresh.status, 200);
    assert.equal(acquired.length, 2);
    fixture.release();
    assert.equal((await old).status, 200);
    assert.equal(fixture.receipt().current.requests[0].threadId, 'old');
    await fixture.close();
  }
);
lifecycle(
  'reset cancels held old response and rejects new work until acquisition and cleanup finish',
  async () => {
    const { fixture } = await setup();
    fixture.hold();
    const old = fixture.forward(body('old'));
    const rejected = assert.rejects(old, /revoked/);
    await new Promise((resolve) => setImmediate(resolve));
    await fixture.reset();
    await rejected;
    assert.equal(fixture.receipt().current.holds, 0);
    await fixture.close();
  }
);
lifecycle(
  'concurrent same-owner request and owner/generation bounds reject before forwarding',
  async () => {
    const { fixture, acquired } = await setup();
    fixture.hold();
    const held = fixture.forward(body('one'));
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(fixture.forward(body('one', 1)), /active/);
    fixture.hold(false);
    fixture.release();
    await held;
    for (let owner = 2; owner <= 8; owner++)
      for (let turn = 0; turn < 4; turn++)
        await fixture.forward(body(String(owner), turn));
    await assert.rejects(fixture.forward(body('ninth')), /owner bound/);
    for (let turn = 1; turn < 4; turn++)
      await fixture.forward(body('one', turn));
    assert.equal(acquired.flatMap((owner) => owner.calls).length, 32);
    await assert.rejects(fixture.forward(body('one', 5)), /bound/);
    await fixture.close();
  }
);
lifecycle(
  'partial acquisition retains its closure receipt and reset closure failure keeps routes unavailable',
  async () => {
    const partial = {
      closure: {
        worker: false,
        listener: true,
        sockets: true,
        responses: true,
      },
    };
    const { fixture } = await setup({
      acquire: async () => {
        throw Object.assign(new Error('partial startup'), {
          fixtureClosure: partial,
        });
      },
    });
    await assert.rejects(fixture.forward(body('broken')), /partial startup/);
    assert.deepEqual(
      fixture.receipt().current.owners[0].acquisitionFailure,
      partial
    );
    await assert.rejects(fixture.reset(), /closure/);
    await assert.rejects(fixture.forward(body('new')), /unavailable/);
    await assert.rejects(fixture.close(), /closure/);
  }
);
lifecycle(
  'explicit fake negative transport is labeled separately and New can still use a real canonical child',
  async () => {
    const { fixture, acquired } = await setup();
    fixture.failTransport();
    const failed = await fixture.forward(body('failed'));
    assert.equal(failed.status, 503);
    assert.equal(acquired.length, 0);
    assert.equal(
      fixture.receipt().current.requests[0].kind,
      'fake-negative-transport'
    );
    assert.equal((await fixture.forward(body('new'))).status, 200);
    assert.equal(acquired.length, 1);
    await fixture.close();
  }
);
lifecycle(
  'reviewed identity and fields reject before canonical acquisition',
  async () => {
    const { fixture, acquired } = await setup();
    for (const raw of [
      Buffer.from('{}'),
      body(''),
      Buffer.from(
        JSON.stringify({ ...JSON.parse(body('x')), surprise: 'denied' })
      ),
      Buffer.alloc(2_000_001),
    ])
      await assert.rejects(fixture.forward(raw));
    assert.equal(acquired.length, 0);
    await fixture.close();
  }
);

lifecycle(
  'forwards the measured installed SDK protocolVersion 1.0 request field unchanged',
  async () => {
    const { fixture, acquired } = await setup();
    const raw = Buffer.from(
      JSON.stringify({
        ...JSON.parse(body('native-sdk')),
        protocolVersion: '1.0',
      })
    );
    try {
      for (const protocolVersion of ['0.9', '2.0', 1, null])
        await assert.rejects(
          fixture.forward(
            Buffer.from(
              JSON.stringify({
                ...JSON.parse(body('native-sdk')),
                protocolVersion,
              })
            )
          ),
          /protocolVersion/
        );
      assert.equal(acquired.length, 0);
      await fixture.forward(raw);
      assert.deepEqual(acquired[0].calls[0], raw);
    } finally {
      await fixture.close();
    }
  }
);

lifecycle(
  'held delivery has its own bounded deadline and leaves no held authority',
  async () => {
    const { fixture } = await setup({ timeoutMs: 10, cleanupTimeoutMs: 20 });
    fixture.hold();
    const pending = fixture.forward(body('held-deadline'));
    const result = await Promise.race([
      pending.then(
        () => 'delivered',
        (error) => String(error)
      ),
      new Promise((resolve) => setTimeout(() => resolve('unbounded'), 100)),
    ]);
    fixture.release();
    await pending.catch(() => undefined);
    await fixture.close();
    assert.match(result, /Held delivery deadline/);
  }
);

lifecycle(
  'partial acquisition cleanup is bounded and late acquired resources are closed',
  async () => {
    let acquire;
    const acquired = new Promise((resolve) => {
      acquire = resolve;
    });
    const { fixture } = await setup({
      acquire: () => acquired,
      timeoutMs: 10,
      cleanupTimeoutMs: 20,
    });
    const pending = fixture
      .forward(body('slow-acquisition'))
      .catch((error) => String(error));
    const reset = fixture.reset();
    const result = await Promise.race([
      reset.then(
        () => 'reset',
        (error) => String(error)
      ),
      new Promise((resolve) => setTimeout(() => resolve('unbounded'), 100)),
    ]);
    let closed = false;
    acquire({
      url: 'http://127.0.0.1:12345/agent',
      close: async () => {
        closed = true;
      },
      stats: () => ({
        closure: {
          worker: closed,
          listener: closed,
          sockets: closed,
          responses: closed,
        },
      }),
    });
    await pending;
    await reset.catch(() => undefined);
    await fixture.close().catch(() => undefined);
    assert.match(result, /closure/);
    assert.equal(closed, true);
  }
);

lifecycle(
  'concurrent resets coalesce and cannot close a fresh unrevoked generation',
  async () => {
    const { fixture } = await setup();
    await fixture.forward(body('prior'));
    const first = fixture.reset(),
      second = fixture.reset();
    await Promise.allSettled([first, second]);
    const receipt = fixture.receipt();
    await fixture.close();
    assert.equal(first, second);
    assert.equal(receipt.current.generation, 2);
    assert.equal(receipt.current.revoked, false);
    assert.equal(receipt.archived.length, 1);
  }
);

lifecycle(
  'reset owns and closes buffered browser responses before exposing a fresh generation',
  async () => {
    const { fixture } = await setup();
    const request = Readable.from([body('browser-response')]);
    request.method = 'POST';
    const response = new EventEmitter();
    response.writeHead = () => {
      response.headersSent = true;
    };
    response.end = () => {
      /* Deliberately retain a pending browser write. */
    };
    response.destroy = () => {
      response.destroyed = true;
      setImmediate(() => response.emit('close'));
    };
    await fixture(request, response, '/ag-ui/a2ui/agent');
    await fixture.reset();
    const destroyed = response.destroyed;
    const prior = fixture.receipt().archived[0];
    await fixture.close();
    assert.equal(destroyed, true);
    assert.equal(prior.proxyResponsesClosed, true);
  }
);

lifecycle(
  'an empty resource closure never authorizes a fresh generation',
  async () => {
    const { fixture, acquired } = await setup();
    await fixture.forward(body('empty-closure'));
    acquired[0].stats = () => ({ closure: {} });
    const result = await fixture.reset().then(
      () => 'reset',
      (error) => String(error)
    );
    await fixture.close().catch(() => undefined);
    assert.match(result, /closure/);
  }
);

test(
  'actual canonical manager uses distinct child PIDs and exact encoded wire with verified closure',
  { skip: !process.env.THREADPLANE_AGUI_A2UI_MANAGER_OPTIONS },
  async () => {
    const options = JSON.parse(
      process.env.THREADPLANE_AGUI_A2UI_MANAGER_OPTIONS
    );
    const fixture = module.createAgUiA2uiFixture(options),
      pids = [];
    await fixture.reset();
    try {
      for (const name of ['first', 'new']) {
        const threadId = name + '-' + randomUUID();
        const input = {
          ...JSON.parse(body(threadId)),
          protocolVersion: '1.0',
          messages: [
            {
              id: randomUUID(),
              role: 'user',
              content: 'I want to fly LAX to JFK',
            },
          ],
        };
        const raw = Buffer.from(JSON.stringify(input));
        const result = await fixture.forward(raw);
        assert.equal(result.status, 200);
        const owner = fixture.receipt().current.owners.at(-1),
          record = owner.stats.requests[0];
        pids.push(owner.stats.ready.pid);
        assert.deepEqual(Buffer.from(record.rawBody), raw);
        assert.deepEqual(result.bytes, Buffer.from(record.sentWire.join('')));
        assert.equal(
          record.worker.observations.state.values.messages.length,
          2
        );
        assert.deepEqual(record.worker.observations.deniedNetwork, []);
        assert.ok(
          record.worker.events.some(
            (event) =>
              event.type === 'RUN_FINISHED' &&
              event.threadId === threadId &&
              event.runId === input.runId
          )
        );
      }
      assert.equal(new Set(pids).size, 2);
    } finally {
      await fixture.close();
    }
    const receipt = fixture.receipt();
    for (const generation of receipt.archived)
      for (const owner of generation.owners) {
        assert.deepEqual(owner.stats.closure, {
          worker: true,
          listener: true,
          sockets: true,
          responses: true,
        });
        assert.equal(owner.stats.child.childClosed, true);
        assert.equal(owner.stats.child.stdoutClosed, true);
        assert.equal(owner.stats.child.stderrClosed, true);
      }
    assert.ok(pids.every((pid) => pidAbsent(pid)));
  }
);
