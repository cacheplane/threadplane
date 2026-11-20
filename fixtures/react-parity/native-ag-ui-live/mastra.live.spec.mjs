/**
 * Live: real sessions against the Mastra hosting service, with the scripted
 * model its own tests use, over HTTP and over the in-process client agent the
 * service wraps. No browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bounded, startMastra, startRecordingServer } from './services.mjs';
import { loadSession } from './session.mjs';

const RESERVE = 'Please reserve the North Pines campsite for 2 nights.';
const RESERVED =
  'Reserved North Pines for 2 night(s) — total $90. Confirmation TP-0288.';
const DECLINED =
  'Reservation for North Pines was declined by the user. Nothing was booked.';

let runtime, removeBundle, mastra;
const live = (name, body) =>
  test(name, { timeout: 120000 }, (t) => bounded(body(t), name, 110000));
async function serverFor(t) {
  const server = await startRecordingServer({
    target: mastra.url,
    headers: mastra.headers,
  });
  t.after(() => server.stop());
  return server;
}
function session(t, options) {
  const created = runtime.createSession(options);
  t.after(() => created.dispose());
  return created;
}

test.before(async () => {
  ({ runtime, remove: removeBundle } = await loadSession());
  mastra = await startMastra();
});
test.after(async () => {
  await mastra?.stop();
  await removeBundle?.();
});

for (const interruptTransport of [undefined, 'protocol', 'auto'])
  for (const approved of [true, false])
    live(
      `${
        interruptTransport ?? 'no profile'
      } answers a Mastra suspension natively (${
        approved ? 'approve' : 'decline'
      })`,
      async (t) => {
        const server = await serverFor(t);
        const owner = session(t, {
          url: server.url,
          ...(interruptTransport && { interruptTransport }),
        });
        assert.equal(await owner.submit(RESERVE), 'paused');
        const paused = owner.getSnapshot();
        // Mastra sends the notice and the protocol's outcome; the outcome wins.
        const types = server.events(owner.threadId).map((event) => event.type);
        assert.ok(types.includes('CUSTOM'));
        assert.equal(paused.run.terminal.outcome.type, 'interrupt');
        assert.equal(paused.decision.command, undefined);
        assert.equal(paused.inputBlocked.reason, 'decision');
        const [interrupt] = paused.interrupts;
        assert.equal(interrupt.reason, 'mastra:tool_suspend');
        assert.equal(typeof interrupt.toolCallId, 'string');
        assert.equal(interrupt.value, interrupt.metadata);
        assert.deepEqual(interrupt.value.mastra.suspendPayload, {
          site: 'North Pines',
          nights: 2,
          total_usd: 90,
        });

        assert.equal(
          await owner.resume([
            {
              interruptId: interrupt.id,
              status: 'resolved',
              value: { approved },
            },
          ]),
          'success'
        );
        assert.deepEqual(server.requests[1].resume, [
          {
            interruptId: interrupt.id,
            status: 'resolved',
            payload: { approved },
          },
        ]);
        assert.deepEqual(server.requests[1].forwardedProps, {});
        const settled = owner.getSnapshot();
        assert.equal(settled.error, undefined);
        assert.equal(settled.inputBlocked, undefined);
        const call = settled.toolCalls.find(
          (entry) => entry.name === 'reserve_campsite'
        );
        assert.equal(call.status, 'complete');
        assert.equal(call.result, approved ? RESERVED : DECLINED);
      }
    );

live('mastra-command answers the notice with the Mastra command', async (t) => {
  const server = await serverFor(t);
  const owner = session(t, {
    url: server.url,
    interruptTransport: 'mastra-command',
  });
  assert.equal(await owner.submit(RESERVE), 'paused');
  const paused = owner.getSnapshot();
  const [interrupt] = paused.interrupts;
  // The pause is the notice: its value names the suspended tool call.
  assert.equal(interrupt.reason, 'on_interrupt');
  assert.equal(interrupt.value.type, 'mastra_suspend');
  assert.equal(interrupt.toolCallId, interrupt.value.toolCallId);
  assert.equal(paused.decision.command.transport, 'mastra-command');
  // A command cannot cancel, and the session says so without sending.
  await assert.rejects(
    owner.resume([{ interruptId: interrupt.id, status: 'cancelled' }]),
    /cannot cancel/
  );
  assert.equal(server.requests.length, 1);

  assert.equal(
    await owner.resume([
      {
        interruptId: interrupt.id,
        status: 'resolved',
        value: { approved: true },
      },
    ]),
    'success'
  );
  const answer = server.requests[1];
  assert.equal(answer.resume, undefined);
  assert.deepEqual(answer.forwardedProps, {
    command: {
      resume: { approved: true },
      interruptEvent: {
        toolCallId: interrupt.value.toolCallId,
        runId: interrupt.value.runId,
      },
    },
  });
  const settled = owner.getSnapshot();
  assert.equal(settled.error, undefined);
  assert.equal(settled.interrupts, undefined);
  assert.equal(
    settled.toolCalls.find((call) => call.name === 'reserve_campsite').result,
    RESERVED
  );
});

live(
  'a session runs over the in-process Mastra client agent, with no HTTP',
  async (t) => {
    const threadId = `live-local-${crypto.randomUUID()}`;
    const agent = await mastra.agent(threadId);
    const before = mastra.stats().length;
    const owner = session(t, { agent, threadId, agentId: 'mastra' });
    assert.equal(owner.agentId, 'mastra');
    assert.equal(owner.threadId, threadId);
    assert.equal(await owner.submit('hello'), 'success');
    assert.deepEqual(
      owner
        .getSnapshot()
        .messages.map((message) => [message.role, message.content]),
      [
        ['user', 'hello'],
        ['assistant', 'Hello there.'],
      ]
    );

    // The same agent pauses and is answered through the session.
    assert.equal(await owner.submit(RESERVE), 'paused');
    const [interrupt] = owner.getSnapshot().interrupts;
    assert.equal(interrupt.reason, 'mastra:tool_suspend');
    assert.equal(
      await owner.resume([
        {
          interruptId: interrupt.id,
          status: 'resolved',
          value: { approved: true },
        },
      ]),
      'success'
    );
    const settled = owner.getSnapshot();
    assert.equal(settled.error, undefined);
    assert.equal(
      settled.toolCalls.find((call) => call.name === 'reserve_campsite').result,
      RESERVED
    );
    // Nothing went through the hosting service.
    assert.equal(mastra.stats().length, before);
    const life = owner.lifecycle.getSnapshot();
    assert.equal(typeof life.toolCallCompletedAt, 'number');
    assert.equal(life.threadCreatedAt, null);
  }
);

live(
  'a backend tool and shared state read as core snapshot members',
  async (t) => {
    const server = await serverFor(t);
    const owner = session(t, { url: server.url });
    assert.equal(
      await owner.submit('What is the weather in Yosemite?'),
      'success'
    );
    const answered = owner.getSnapshot();
    const call = answered.toolCalls.find(
      (entry) => entry.name === 'check_conditions'
    );
    assert.equal(call.status, 'complete');
    assert.deepEqual(call.args, { location: 'Yosemite Valley' });
    assert.equal(
      answered.messages.at(-1).content,
      'Clear skies at Yosemite Valley with a high of 18°C.'
    );
    // The assistant message that made the call lists it.
    assert.ok(
      answered.messages.some((message) =>
        message.toolCallIds?.includes(call.id)
      )
    );

    // Mastra publishes its working memory as the state document: a snapshot,
    // then a JSON Patch delta, then the closing snapshot.
    const planner = session(t, { url: server.url });
    assert.equal(planner.getSnapshot().state, undefined);
    assert.equal(
      await planner.submit('Start a packing list for the weekend.'),
      'success'
    );
    const events = server.events(planner.threadId).map((event) => event.type);
    assert.ok(
      events.includes('STATE_SNAPSHOT') && events.includes('STATE_DELTA')
    );
    const listed = planner.getSnapshot();
    assert.equal(listed.error, undefined);
    assert.deepEqual(listed.state, {
      packing_list: {
        title: 'Yosemite Weekend',
        items: [
          { name: 'tent', qty: 1 },
          { name: 'sleeping bag', qty: 2 },
        ],
      },
    });
    assert.ok(Object.isFrozen(listed.state));
  }
);

// The core contract's base checks, against a session on the live service.
test(
  'core session conformance on the live Mastra endpoint',
  { timeout: 180000 },
  async (t) => {
    const scenarios = runtime.agentSessionConformanceScenarios(() =>
      runtime.createSession({ url: mastra.url, headers: mastra.headers })
    );
    for (const [name, scenario] of scenarios)
      await t.test(name, () => bounded(scenario(), name, 60000));
  }
);
