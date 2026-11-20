/**
 * Live: real sessions against the cockpit Python backends, each the unchanged
 * graph behind the real `ag-ui-langgraph` bridge, with the model replayed from
 * the recorded fixtures the cockpit e2e setups use. No browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { backends, here } from './configuration.mjs';
import {
  bounded,
  startModel,
  startPythonBackend,
  startRecordingServer,
} from './services.mjs';
import { loadSession } from './session.mjs';

const REFUND = 'Refund cus_a8x2k for the duplicate charge on their last order.';
const REFUNDED =
  'Refund of $47.50 issued to `cus_a8x2k`. Refund ID: `re_demo__a8x2k`.';
const WEATHER = "What's the weather in San Francisco?";
const WEATHER_ANSWER = "It's 68°F and sunny in San Francisco right now.";
const approve = (interrupt) => [
  { interruptId: interrupt.id, status: 'resolved', value: { approved: true } },
];
const weatherSpec = {
  name: 'get_weather',
  description: 'Reads the weather where the person is.',
  parameters: {
    type: 'object',
    properties: { location: { type: 'string' } },
    required: ['location'],
  },
};
const texts = (snapshot) =>
  snapshot.messages.map((message) => [message.role, message.content]);

let runtime, removeBundle;
const services = [];
const own = (service) => (services.push(service), service);
let interrupts, clientTools, activity;
/** A server in front of a backend, stopped when the test ends. */
async function serverFor(t, backend) {
  const server = await startRecordingServer({ target: backend.url + '/' });
  t.after(() => server.stop());
  return server;
}
/** A session disposed when the test ends. */
function session(t, options, tools) {
  const created =
    tools === undefined
      ? runtime.createSession(options)
      : runtime.createSession(options, tools);
  t.after(() => created.dispose());
  return created;
}
/** Every snapshot a session publishes from now on. */
function published(target) {
  const seen = [];
  target.subscribe(() => seen.push(target.getSnapshot()));
  return seen;
}
const live = (name, body) =>
  test(name, { timeout: 120000 }, (t) => bounded(body(t), name, 110000));

test.before(async () => {
  ({ runtime, remove: removeBundle } = await loadSession());
  const start = async ({ cwd, fixtures }, extra = {}, model = {}) => {
    const recorded = own(await startModel([fixtures], model));
    const backend = own(
      await startPythonBackend({ cwd, model: recorded, ...extra })
    );
    return { ...backend, model: recorded.mock };
  };
  [interrupts, clientTools, activity] = await Promise.all([
    start(backends.interrupts),
    // Small chunks, so a tool call's arguments arrive in several deltas.
    start(backends.clientTools, {}, { chunkSize: 6 }),
    start(backends.subagents, { app: 'activity_service:app', appDir: here }),
  ]);
});
test.after(async () => {
  await Promise.all(services.reverse().map((service) => service.stop()));
  await removeBundle?.();
});

// ── interrupt resume profiles ───────────────────────────────────────────────

for (const interruptTransport of ['legacy-command', 'auto'])
  live(
    `${interruptTransport} answers the bridge's on_interrupt notice with a command`,
    async (t) => {
      const server = await serverFor(t, interrupts);
      const owner = session(t, {
        url: server.url + 'agent',
        interruptTransport,
      });
      assert.equal(await owner.submit(REFUND), 'paused');
      const paused = owner.getSnapshot();
      assert.equal(paused.status, 'idle');
      assert.equal(paused.inputBlocked?.reason, 'decision');
      assert.equal(paused.interrupts.length, 1);
      const [interrupt] = paused.interrupts;
      assert.equal(interrupt.reason, 'on_interrupt');
      assert.deepEqual(interrupt.value, {
        kind: 'refund_approval',
        amount: 47.5,
        customer_id: 'cus_a8x2k',
        reason: 'Customer was charged twice for the same order.',
      });
      assert.equal(paused.decision.command.transport, interruptTransport);
      // The refusal the block explains: nothing is sent.
      assert.equal(await owner.submit('Skip the approval'), 'error');
      assert.equal(server.requests.length, 1);

      assert.equal(await owner.resume(approve(interrupt)), 'success');
      const answer = server.requests[1];
      assert.deepEqual(answer.forwardedProps, {
        command: { resume: { approved: true } },
      });
      assert.equal(answer.resume, undefined);
      const settled = owner.getSnapshot();
      assert.equal(settled.inputBlocked, undefined);
      assert.equal(settled.interrupts, undefined);
      assert.equal(settled.error, undefined);
      assert.equal(settled.messages.at(-1).content, REFUNDED);
      const life = owner.lifecycle.getSnapshot();
      assert.ok(life.streamStartedAt <= life.interruptReceivedAt);
      assert.ok(life.interruptReceivedAt <= life.interruptResolvedAt);
      // The session named this thread itself.
      assert.equal(typeof life.threadCreatedAt, 'number');
    }
  );

for (const interruptTransport of [undefined, 'protocol', 'auto'])
  live(
    `${
      interruptTransport ?? 'no profile'
    } answers the protocol's interrupt outcome natively`,
    async (t) => {
      const server = await serverFor(t, interrupts);
      const owner = session(t, {
        url: server.url + 'agent/native',
        ...(interruptTransport && { interruptTransport }),
      });
      assert.equal(await owner.submit(REFUND), 'paused');
      const [interrupt] = owner.getSnapshot().interrupts;
      assert.equal(
        interrupt.reason,
        'Customer was charged twice for the same order.'
      );
      // The core value is what the backend sent with the pause: its metadata.
      assert.equal(interrupt.value, interrupt.metadata);
      assert.deepEqual(interrupt.value.langgraph.raw, {
        kind: 'refund_approval',
        amount: 47.5,
        customer_id: 'cus_a8x2k',
        reason: 'Customer was charged twice for the same order.',
      });
      assert.equal(owner.getSnapshot().decision.command, undefined);
      assert.equal(await owner.resume(approve(interrupt)), 'success');
      assert.deepEqual(server.requests[1].resume, [
        {
          interruptId: interrupt.id,
          status: 'resolved',
          payload: { approved: true },
        },
      ]);
      assert.deepEqual(server.requests[1].forwardedProps, {});
      assert.equal(owner.getSnapshot().messages.at(-1).content, REFUNDED);
    }
  );

live(
  'protocol does not answer a notice: the run settles as the backend ended it',
  async (t) => {
    const server = await serverFor(t, interrupts);
    const owner = session(t, {
      url: server.url + 'agent',
      interruptTransport: 'protocol',
    });
    // The bridge sends its notice and then finishes the run in the ordinary way.
    assert.equal(await owner.submit(REFUND), 'success');
    const snapshot = owner.getSnapshot();
    // The notice is kept as evidence, and nothing is offered to answer.
    assert.equal(snapshot.run.legacyInterrupt.name, 'on_interrupt');
    assert.equal(snapshot.decision, undefined);
    assert.equal(snapshot.interrupts, undefined);
    assert.equal(snapshot.inputBlocked, undefined);
    await assert.rejects(
      owner.resume([
        { interruptId: 'any', status: 'resolved', value: { approved: true } },
      ]),
      /No interrupt is waiting/
    );
    assert.equal(server.requests.length, 1);
  }
);

// ── resume options, and retry of an answer the server refused ───────────────

live('resume sends a message and a state patch with the answers', async (t) => {
  const server = await serverFor(t, interrupts);
  const owner = session(t, { url: server.url + 'agent/native' });
  await owner.submit(REFUND);
  const [interrupt] = owner.getSnapshot().interrupts;
  const before = server.requests[0];
  assert.equal(
    await owner.resume(approve(interrupt), {
      message: 'Approved by Ada.',
      state: { reviewer: 'Ada' },
    }),
    'success'
  );
  const answer = server.requests[1];
  assert.equal(answer.resume.length, 1);
  assert.equal(answer.state.reviewer, 'Ada');
  const sent = answer.messages.filter((message) => message.role === 'user');
  assert.deepEqual(
    sent.map((message) => message.content),
    [REFUND, 'Approved by Ada.']
  );
  assert.equal(before.messages.length, 1);
  const settled = owner.getSnapshot();
  assert.equal(settled.error, undefined);
  assert.equal(settled.interrupts, undefined);
  assert.ok(texts(settled).some(([, content]) => content === REFUNDED));
});

live(
  'retry sends again an answer the server refused before any run',
  async (t) => {
    const server = await serverFor(t, interrupts);
    const owner = session(t, { url: server.url + 'agent/native' });
    await owner.submit(REFUND);
    const [interrupt] = owner.getSnapshot().interrupts;
    server.refuseNext();
    assert.equal(
      await owner.resume(approve(interrupt), { message: 'Approved.' }),
      'error'
    );
    const failed = owner.getSnapshot();
    assert.equal(failed.error.message, 'The server is restarting. Try again.');
    assert.equal(failed.error.recovery, 'retry');
    assert.deepEqual(failed.errorDiagnostic, {
      name: 'RunError',
      message: 'The server is restarting. Try again.',
      code: 'unavailable',
    });
    // Nothing took the answer: the pause is pending again.
    assert.equal(failed.interrupts.length, 1);
    assert.equal(failed.inputBlocked.reason, 'decision');
    assert.equal(
      typeof owner.lifecycle.getSnapshot().streamErrorAt.at,
      'number'
    );

    assert.equal(await owner.retry(), 'success');
    const [, refused, retried] = server.requests;
    assert.deepEqual(retried.resume, refused.resume);
    assert.deepEqual(retried.messages, refused.messages);
    assert.deepEqual(retried.state, refused.state);
    // The message travelled once in each request, never twice.
    assert.equal(
      retried.messages.filter((message) => message.content === 'Approved.')
        .length,
      1
    );
    const settled = owner.getSnapshot();
    assert.equal(settled.error, undefined);
    assert.equal(settled.errorDiagnostic, undefined);
    assert.equal(settled.interrupts, undefined);
    assert.ok(texts(settled).some(([, content]) => content === REFUNDED));
  }
);

// ── checkStatus, persistence and replay across a reload ─────────────────────

/** Asks the server what it recorded for the thread, as a reconciler does. */
function reconcilerFor(server, threadId) {
  return async () => {
    const reader = runtime.createSession({
      url: server.url + 'agent/native',
      threadId,
      replay: runtime.httpReplay({ url: server.eventsUrl }),
    });
    try {
      await reader.ready;
      const { transcript, state, interrupts } = reader.getSnapshot();
      // The server's record ends in a pause, or the answer's run finished.
      return interrupts?.length
        ? { status: 'unknown' }
        : { status: 'completed', messages: transcript, state };
    } finally {
      await reader.dispose();
    }
  };
}

live(
  'checkStatus settles an answer whose connection dropped, from the server record',
  async (t) => {
    const server = await serverFor(t, interrupts);
    const threadId = `live-check-${crypto.randomUUID()}`;
    const memory = runtime.memoryStore();
    let ask = async () => ({ status: 'unknown' });
    const owner = session(t, {
      url: server.url + 'agent/native',
      threadId,
      persistence: {
        namespace: 'live',
        store: memory.store,
        reconcile: () => ask(),
      },
    });
    await owner.ready;
    assert.equal(await owner.submit(REFUND), 'paused');
    const [interrupt] = owner.getSnapshot().interrupts;

    // The backend finishes the answering run; the client never reads its end.
    server.dropTerminalNext();
    assert.equal(await owner.resume(approve(interrupt)), 'interrupted');
    // The automatic check has asked, and the reconciler did not know.
    await bounded(
      (async () => {
        while (owner.getSnapshot().inputBlocked?.reason !== 'decision')
          await new Promise((resolve) => setTimeout(resolve, 10));
      })(),
      'the automatic check'
    );
    const uncertain = owner.getSnapshot();
    assert.equal(uncertain.status, 'error');
    assert.equal(uncertain.error.kind, 'interrupted');
    assert.equal(uncertain.error.recovery, 'check');
    assert.equal(
      runtime.interruptSession(uncertain).phase,
      'recovery-required'
    );
    // The answer is never sent twice.
    await assert.rejects(owner.retry(), /cannot be retried/);
    await assert.rejects(owner.resume(approve(interrupt)));
    assert.equal(await owner.submit('Anything else?'), 'error');
    assert.equal(server.requests.length, 2);

    // Now the reconciler asks the server, which recorded the finished run.
    ask = reconcilerFor(server, threadId);
    const seen = published(owner);
    await owner.checkStatus();
    assert.ok(
      seen.some((snapshot) => snapshot.inputBlocked?.reason === 'checking')
    );
    const settled = owner.getSnapshot();
    assert.equal(settled.status, 'idle');
    assert.equal(settled.error, undefined);
    assert.equal(settled.inputBlocked, undefined);
    assert.equal(settled.interrupts, undefined);
    assert.equal(settled.messages.at(-1).content, REFUNDED);
    assert.equal(server.requests.length, 2);
  }
);

live(
  'persistence restores a pause after a reload, and the restored session answers it',
  async (t) => {
    const server = await serverFor(t, interrupts);
    const threadId = `live-persist-${crypto.randomUUID()}`;
    const memory = runtime.memoryStore();
    const options = {
      url: server.url + 'agent/native',
      threadId,
      persistence: { namespace: 'live', store: memory.store },
    };
    const first = session(t, options);
    await first.ready;
    assert.equal(await first.submit(REFUND), 'paused');
    const before = first.getSnapshot();
    // The reload: the page goes away with its session.
    await first.dispose();

    const second = session(t, options);
    assert.equal(second.getSnapshot().inputBlocked?.reason, 'hydrating');
    await second.ready;
    const restored = second.getSnapshot();
    assert.deepEqual(texts(restored), texts(before));
    assert.deepEqual(
      restored.interrupts.map(({ id, reason, value }) => ({
        id,
        reason,
        value,
      })),
      before.interrupts.map(({ id, reason, value }) => ({ id, reason, value }))
    );
    assert.equal(restored.inputBlocked.reason, 'decision');
    const life = second.lifecycle.getSnapshot();
    assert.equal(typeof life.threadPersistedAt, 'number');
    // A given thread was not created by this session.
    assert.equal(life.threadCreatedAt, null);

    assert.equal(
      await second.resume(approve(restored.interrupts[0])),
      'success'
    );
    assert.equal(second.getSnapshot().messages.at(-1).content, REFUNDED);
    assert.equal(server.requests.length, 2);

    // A third session finds the finished thread, and `load` reads it again.
    const third = session(t, options);
    await third.ready;
    assert.equal(third.getSnapshot().messages.at(-1).content, REFUNDED);
    assert.equal(third.getSnapshot().interrupts, undefined);
    const seen = published(third);
    await third.load();
    assert.ok(
      seen.some((snapshot) => snapshot.inputBlocked?.reason === 'hydrating')
    );
    assert.equal(third.getSnapshot().inputBlocked, undefined);
    assert.equal(third.getSnapshot().messages.at(-1).content, REFUNDED);
  }
);

live(
  'replay rebuilds the thread from the server record after a reload',
  async (t) => {
    const server = await serverFor(t, interrupts);
    const threadId = `live-replay-${crypto.randomUUID()}`;
    const url = server.url + 'agent/native';
    const first = session(t, { url, threadId });
    assert.equal(await first.submit(REFUND), 'paused');
    const before = first.getSnapshot();
    await first.dispose();

    const raw = [];
    const second = session(t, {
      url,
      threadId,
      replay: runtime.httpReplay({ url: server.eventsUrl }),
    });
    second.onRawEvent((event) => raw.push(event.type));
    await second.ready;
    const restored = second.getSnapshot();
    assert.deepEqual(texts(restored), texts(before));
    assert.deepEqual(
      restored.interrupts.map((interrupt) => interrupt.id),
      before.interrupts.map((interrupt) => interrupt.id)
    );
    // The replayed events are delivered once the snapshot shows them.
    assert.equal(raw[0], 'RUN_STARTED');
    assert.equal(raw.at(-1), 'RUN_FINISHED');
    assert.equal(
      typeof second.lifecycle.getSnapshot().threadPersistedAt,
      'number'
    );

    assert.equal(
      await second.resume(approve(restored.interrupts[0])),
      'success'
    );
    assert.equal(second.getSnapshot().messages.at(-1).content, REFUNDED);

    // A thread the server has no record of starts empty.
    const fresh = session(t, {
      url,
      threadId: `live-none-${crypto.randomUUID()}`,
      replay: runtime.httpReplay({ url: server.eventsUrl }),
    });
    await fresh.ready;
    assert.deepEqual(fresh.getSnapshot().messages, []);
    assert.equal(fresh.lifecycle.getSnapshot().threadPersistedAt, null);
  }
);

// ── client tools ────────────────────────────────────────────────────────────

live(
  'the clientTools capability declares, lists, settles and continues',
  async (t) => {
    const server = await serverFor(t, clientTools);
    const owner = session(t, { url: server.url + 'agent' });
    assert.equal(owner.getSnapshot().pendingClientTools, undefined);
    owner.clientTools.setCatalog([weatherSpec]);
    const seen = published(owner);
    assert.equal(await owner.submit(WEATHER), 'success');
    assert.deepEqual(server.requests[0].tools, [weatherSpec]);

    // The arguments streamed: the call was listed apart until they were final.
    // The bridge's closing snapshot re-serializes the arguments, so compare
    // against them without its spacing.
    const finalArguments = JSON.stringify(
      JSON.parse(
        owner
          .getSnapshot()
          .transcript.find((record) => record.toolCalls?.length).toolCalls[0]
          .function.arguments
      )
    );
    const streaming = seen.filter(
      (snapshot) => snapshot.streamingToolCalls?.length
    );
    assert.ok(streaming.length > 0, 'no snapshot listed a streaming call');
    for (const snapshot of streaming) {
      const [call] = snapshot.streamingToolCalls;
      assert.equal(call.name, 'get_weather');
      assert.ok(finalArguments.startsWith(call.argsText), call.argsText);
      assert.ok(!snapshot.toolCalls.some((final) => final.id === call.id));
      // Not actionable while the run is going.
      assert.deepEqual(snapshot.pendingClientTools, []);
    }
    assert.ok(
      streaming.some(
        (snapshot) => snapshot.streamingToolCalls[0].args !== undefined
      ),
      'no partial arguments were read'
    );

    const waiting = owner.getSnapshot();
    assert.equal(waiting.streamingToolCalls, undefined);
    assert.equal(waiting.pendingClientTools.length, 1);
    const [call] = waiting.pendingClientTools;
    assert.deepEqual(
      { name: call.name, args: call.args, status: call.status },
      {
        name: 'get_weather',
        args: { location: 'San Francisco' },
        status: 'pending',
      }
    );
    assert.equal(call, waiting.toolCalls[0]);
    assert.throws(() =>
      owner.clientTools.settle('unknown', { ok: true, value: 1 })
    );

    owner.clientTools.resolve(call.id, {
      ok: true,
      value: { temperatureF: 68, conditions: 'Sunny' },
    });
    assert.deepEqual(owner.getSnapshot().pendingClientTools, []);
    await bounded(
      (async () => {
        while (owner.getSnapshot().messages.at(-1).content !== WEATHER_ANSWER)
          await new Promise((resolve) => setTimeout(resolve, 10));
        while (owner.getSnapshot().status !== 'idle')
          await new Promise((resolve) => setTimeout(resolve, 10));
      })(),
      'the continued run'
    );
    // The continuation carried the result and no second user message.
    const continued = server.requests[1];
    assert.deepEqual(
      continued.messages.map((message) => message.role),
      ['user', 'assistant', 'tool']
    );
    assert.equal(
      continued.messages.at(-1).content,
      '{"temperatureF":68,"conditions":"Sunny"}'
    );
    const settled = owner.getSnapshot();
    assert.equal(settled.error, undefined);
    assert.deepEqual(settled.toolCalls[0].result, {
      temperatureF: 68,
      conditions: 'Sunny',
    });
    const life = owner.lifecycle.getSnapshot();
    assert.ok(life.toolCallStartedAt <= life.toolCallCompletedAt);
  }
);

live(
  'retry and regenerate with client tools run each handler once per call',
  async (t) => {
    const server = await serverFor(t, clientTools);
    let calls = 0;
    const owner = session(
      t,
      { url: server.url + 'agent' },
      {
        get_weather: {
          description: weatherSpec.description,
          parameters: weatherSpec.parameters,
          handler: ({ location }) => {
            calls++;
            return { location, temperatureF: 68, conditions: 'Sunny' };
          },
        },
      }
    );
    // The server turns the first request away with its own RUN_ERROR.
    server.refuseNext();
    assert.equal(await owner.submit(WEATHER), 'error');
    const failed = owner.getSnapshot();
    assert.equal(failed.run.terminal.type, 'RUN_ERROR');
    assert.equal(failed.error.recovery, 'retry');
    assert.equal(failed.errorDiagnostic.name, 'RunError');
    assert.equal(failed.errorDiagnostic.message, failed.error.message);
    assert.equal(failed.inputBlocked.reason, 'client-tools');
    assert.equal(calls, 0);

    // The retry reaches the backend: it calls the tool, the handler runs, and
    // the command continues with the result.
    assert.equal(await owner.retry(), 'success');
    assert.equal(calls, 1);
    const answered = owner.getSnapshot();
    assert.equal(answered.error, undefined);
    assert.equal(answered.errorDiagnostic, undefined);
    assert.equal(answered.inputBlocked, undefined);
    assert.deepEqual(
      texts(answered).filter(([role]) => role === 'user'),
      [['user', WEATHER]]
    );
    assert.equal(answered.messages.at(-1).content, WEATHER_ANSWER);
    assert.equal(answered.clientTools.calls.length, 1);
    assert.equal(answered.clientTools.calls[0].status, 'complete');
    assert.deepEqual(answered.toolCalls[0].result, {
      location: 'San Francisco',
      temperatureF: 68,
      conditions: 'Sunny',
    });
    // The refused request, its retry, and the continuation with the result.
    assert.equal(server.requests.length, 3);
    assert.deepEqual(server.requests[1].messages, server.requests[0].messages);
    assert.deepEqual(server.requests[1].tools, server.requests[0].tools);
    assert.deepEqual(
      server.requests[2].messages.map((message) => message.role),
      ['user', 'assistant', 'tool']
    );

    const answer = answered.messages.at(-1);
    assert.equal(await owner.regenerate(answer.id), 'success');
    // The request ends at the prompt: the earlier answer and its call are not sent.
    const regenerated = server.requests[3];
    assert.deepEqual(regenerated.messages, server.requests[0].messages);
    const again = owner.getSnapshot();
    assert.equal(again.error, undefined);
    assert.equal(again.inputBlocked, undefined);
    assert.equal(again.messages.at(-1).content, WEATHER_ANSWER);
    assert.notEqual(again.messages.at(-1).id, answer.id);
    assert.deepEqual(
      texts(again).filter(([role]) => role === 'user'),
      [['user', WEATHER]]
    );
    // A handler runs once for each call the backend made, never twice for one.
    const made = again.transcript.flatMap((record) => record.toolCalls ?? []);
    assert.equal(calls, made.length);
    // This bridge keeps the thread itself: it answers from its own history,
    // where the tool result already is, and its closing snapshot lists the
    // earlier answer beside the new one. See the report on this suite.
    assert.equal(made.length, 1);
    assert.equal(
      again.messages.filter((message) => message.content === WEATHER_ANSWER)
        .length,
      2
    );
  }
);

live(
  'a dropped connection is not retried, and its cause is described',
  async (t) => {
    const owner = session(t, { url: clientTools.url + '/agent' });
    owner.clientTools.setCatalog([weatherSpec]);
    // The model fails. This bridge then closes the connection with no RUN_ERROR.
    clientTools.model.nextRequestError(400, {
      message: 'The model rejected the request.',
      type: 'invalid_request_error',
    });
    assert.equal(await owner.submit(WEATHER), 'error');
    const failed = owner.getSnapshot();
    assert.equal(failed.run.terminal, undefined);
    assert.equal(failed.error.kind, 'server');
    assert.equal(failed.error.retryable, false);
    assert.equal(failed.error.recovery, 'none');
    // What the transport failed with, as plain data and never the thrown value.
    assert.equal(typeof failed.errorDiagnostic.message, 'string');
    assert.equal(typeof failed.errorDiagnostic.name, 'string');
    assert.ok(Object.isFrozen(failed.errorDiagnostic));
    assert.ok(!(failed.errorDiagnostic instanceof Error));
    await assert.rejects(owner.retry(), /cannot be retried/);
    assert.equal(
      typeof owner.lifecycle.getSnapshot().streamErrorAt.at,
      'number'
    );
    // Nothing blocks the next submission, which the backend answers.
    assert.equal(failed.inputBlocked, undefined);
    assert.equal(await owner.submit(WEATHER), 'success');
    assert.equal(owner.getSnapshot().error, undefined);
    assert.equal(owner.getSnapshot().errorDiagnostic, undefined);
  }
);

live(
  'a response that ended before any event is sent again by retry',
  async (t) => {
    const server = await serverFor(t, clientTools);
    for (const tools of [false, true]) {
      const owner = tools
        ? session(
            t,
            { url: server.url + 'agent' },
            {
              get_weather: {
                description: weatherSpec.description,
                parameters: weatherSpec.parameters,
                handler: ({ location }) => ({
                  location,
                  temperatureF: 68,
                  conditions: 'Sunny',
                }),
              },
            }
          )
        : session(t, { url: server.url + 'agent' });
      const from = server.requests.length;
      // The server ends the response with nothing in it; no run was started.
      server.closeNext();
      assert.equal(await owner.submit(WEATHER), 'interrupted');
      const failed = owner.getSnapshot();
      assert.equal(failed.run.terminal, undefined);
      assert.deepEqual(failed.error, {
        kind: 'interrupted',
        message: 'The response was interrupted before it started. Try again.',
        retryable: true,
        recovery: 'retry',
      });
      assert.equal(failed.inputBlocked?.reason, tools ? 'client-tools' : undefined);

      // The retry reaches the backend with the same request, and is answered.
      assert.equal(await owner.retry(), 'success');
      const [first, second] = server.requests.slice(from);
      assert.deepEqual(second.messages, first.messages);
      assert.notEqual(second.runId, first.runId);
      const answered = owner.getSnapshot();
      assert.equal(answered.error, undefined);
      assert.equal(answered.inputBlocked, undefined);
      assert.deepEqual(
        texts(answered).filter(([role]) => role === 'user'),
        [['user', WEATHER]]
      );
      if (tools) assert.equal(answered.messages.at(-1).content, WEATHER_ANSWER);
    }
  }
);

live('a host that cannot be reached is a connection error', async (t) => {
  // A port nothing listens on: the server that was there has stopped.
  const gone = await startRecordingServer({ target: 'http://127.0.0.1:1/' });
  await gone.stop();
  const owner = session(t, { url: gone.url + 'agent' });
  assert.equal(await owner.submit(WEATHER), 'error');
  const failed = owner.getSnapshot();
  assert.deepEqual(failed.error, {
    kind: 'connection',
    message: "Can't reach the server. Check your connection and try again.",
    retryable: false,
    recovery: 'none',
  });
  // What the AG-UI example's error-handling e2e looks for.
  assert.match(
    failed.error.message,
    /can't reach|connection|server|interrupted|try again/i
  );
  assert.equal(failed.run.failure, undefined);
  await assert.rejects(owner.retry(), /cannot be retried/);
});

live(
  'runWithoutMessage and structured content reach the backend',
  async (t) => {
    const server = await serverFor(t, clientTools);
    const owner = session(t, { url: server.url + 'agent' });
    const blocks = [
      { type: 'text', text: WEATHER },
      { type: 'image', url: 'https://example.invalid/skyline.png' },
    ];
    owner.clientTools.setCatalog([weatherSpec]);
    assert.equal(await owner.submit({ message: WEATHER, blocks }), 'success');
    assert.deepEqual(server.requests[0].messages[0].content, [
      { type: 'text', text: WEATHER },
      {
        type: 'image',
        source: { type: 'url', value: 'https://example.invalid/skyline.png' },
      },
    ]);
    const asked = owner.getSnapshot();
    assert.equal(asked.error, undefined);
    assert.deepEqual(asked.messages[0].blocks, blocks);
    assert.equal(asked.messages[0].content, runtime.contentBlocksText(blocks));
    // The backend read the text and answered with the tool call.
    assert.equal(asked.pendingClientTools.length, 1);

    // Settle without running, then run on the conversation as it stands.
    owner.clientTools.settle(asked.pendingClientTools[0].id, {
      ok: true,
      value: { temperatureF: 68, conditions: 'Sunny' },
    });
    assert.equal(server.requests.length, 1);
    assert.equal(
      await owner.runWithoutMessage({ state: { units: 'imperial' } }),
      'success'
    );
    const run = server.requests[1];
    assert.equal(run.state.units, 'imperial');
    assert.deepEqual(
      run.messages.map((message) => message.role),
      ['user', 'assistant', 'tool']
    );
    const settled = owner.getSnapshot();
    assert.equal(settled.error, undefined);
    assert.equal(settled.messages.at(-1).content, WEATHER_ANSWER);
    assert.equal(
      settled.messages.filter((message) => message.role === 'user').length,
      1
    );
  }
);

// ── children from activity records ──────────────────────────────────────────

live('activity records become child agents as they stream', async (t) => {
  const server = await serverFor(t, activity);
  const owner = session(t, { url: server.url + 'agent' });
  const seen = published(owner);
  assert.equal(await owner.submit('Plan a trip from LAX to JFK'), 'success');
  const events = server.events(owner.threadId);
  assert.ok(events.some((event) => event.type === 'ACTIVITY_SNAPSHOT'));
  assert.ok(!events.some((event) => event.type.startsWith('SUBAGENT_')));

  // A child was running, with its text arriving, before it completed.
  const running = seen.find((snapshot) =>
    snapshot.subagents.some(
      (child) => child.status === 'running' && child.messages[0].content
    )
  );
  assert.ok(running, 'no snapshot showed a running child');
  const streamed = running.subagents.find(
    (child) => child.status === 'running'
  );
  assert.equal(streamed.messages[0].delivery.phase, 'streaming');

  const settled = owner.getSnapshot();
  assert.equal(settled.error, undefined);
  assert.deepEqual(
    settled.subagents.map(({ id, name, status, toolCallId }) => ({
      id,
      name,
      status,
      toolCallId,
    })),
    ['research', 'booking', 'itinerary'].map((name) => ({
      id: `call_${name}_001`,
      name,
      status: 'complete',
      toolCallId: `call_${name}_001`,
    }))
  );
  // This backend names the activity record and the delegation's tool result
  // alike. The session keeps one record of each, and the run does not fail.
  for (const child of settled.subagents) {
    assert.deepEqual(
      settled.transcript
        .filter((record) => record.id === child.id)
        .map((record) => record.role)
        .sort(),
      ['activity', 'tool']
    );
    const call = settled.toolCalls.find((call) => call.id === child.id);
    assert.equal(call.status, 'complete');
    assert.ok(String(call.result).length > 0);
  }
  for (const child of settled.subagents) {
    assert.equal(child.messages.length, 1);
    assert.ok(child.messages[0].content.length > 20);
    assert.equal(child.messages[0].delivery.phase, 'complete');
    // The record it was read from stays on the child.
    assert.equal(child.activity.status, 'complete');
    assert.equal(child.activity.text, child.messages[0].content);
    // This convention reports no state for a child that did not fail.
    assert.equal(child.state, undefined);
    // Each child relates to the root tool call that started it.
    assert.ok(settled.toolCalls.some((call) => call.id === child.toolCallId));
  }
  // The records are children, not messages.
  // The only message with a child's id is the tool result that shares it.
  assert.ok(
    !settled.messages.some(
      (message) =>
        message.role !== 'tool' &&
        settled.subagents.some((child) => child.id === message.id)
    )
  );
  assert.ok(!settled.messages.some((message) => message.role === 'activity'));
  assert.equal(
    settled.transcript.filter((record) => record.role === 'activity').length,
    3
  );
  assert.ok(settled.messages.at(-1).content.length > 0);

  // The pair is ordinary history: the session admits the next submission and
  // its request sends the tool results, never the activity records. The
  // recorded model has no answer for this prompt, so only the request is read.
  const sent = server.requests.length;
  await owner.submit('Thanks');
  assert.equal(server.requests.length, sent + 1);
  const next = server.requests.at(-1);
  assert.equal(next.messages.at(-1).content, 'Thanks');
  assert.ok(!next.messages.some((message) => message.role === 'activity'));
  for (const child of settled.subagents)
    assert.ok(
      next.messages.some(
        (message) => message.role === 'tool' && message.id === child.id
      )
    );
});
