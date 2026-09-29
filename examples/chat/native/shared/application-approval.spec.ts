// Independent wire expectation; do not derive this from the authored catalog.
const expectedClientTools = [
  {
    name: 'show_trip_summary',
    description:
      'Show a supplied trip recap with days and places. This terminal summary needs no follow-up; it does not plan or change an itinerary.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        days: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day: { type: 'integer', minimum: 1 },
              places: { type: 'array', items: { type: 'string' } },
            },
            required: ['day', 'places'],
          },
        },
        note: { type: 'string' },
      },
      required: ['title', 'days'],
    },
  },
];
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createSession } from '@threadplane/langgraph';
import type { ApplicationSession } from './application.js';
import { applicationTools } from './trip-summary.js';
import { createMarkdown } from '@threadplane/content/markdown';
import { createApplication, type ApplicationOptions } from './application.js';
import { createThreadDirectory } from './directory.js';
import { startProofServer, threadEnvelope } from '../tooling/proof-server.mjs';

const id = '0123456789abcdef0123456789abcdef';
const reason = '<img src=x onerror=alert(1)> Review this exact request.';
const approval = { id, value: { type: 'approval_request', reason } };
type App = ReturnType<typeof createApplication>;
const search = (extra = {}) => ({
  method: 'POST',
  path: '/api/threads/search',
  payload: { limit: 50, offset: 0 },
  body: [],
  ...extra,
});
const lookup = (thread: string, extra = {}) => ({
  method: 'GET',
  path: `/api/threads/${thread}`,
  body: threadEnvelope(thread),
  ...extra,
});
const saved = (thread: string, interrupts: unknown[] = [approval]) => [
  {
    values: {
      messages: [{ id: 'saved', type: 'ai', content: '# Review' }],
      ...(interrupts.length ? { __interrupt__: interrupts } : {}),
    },
    next: ['pending-node'],
    tasks: [],
    checkpoint: {
      thread_id: thread,
      checkpoint_ns: '',
      checkpoint_id: 'checkpoint',
    },
    parent_checkpoint: null,
    metadata: { source: 'input', step: 0, parents: {} },
    created_at: '2026-09-29T00:00:00.000Z',
  },
];
const history = (
  thread: string,
  interrupts: unknown[] = [approval],
  extra = {}
) => ({
  method: 'POST',
  path: `/api/threads/${thread}/history`,
  payload: { limit: 10 },
  body: saved(thread, interrupts),
  ...extra,
});
const reply = [
  {
    event: 'values',
    data: {
      messages: [{ type: 'ai', id: 'reply', content: 'Decision recorded.' }],
    },
  },
];
const paused = [{ event: 'updates', data: { __interrupt__: [approval] } }];
const resume = (thread: string, answer = 'approved', extra = {}) => ({
  method: 'POST',
  path: `/api/threads/${thread}/runs/stream`,
  payload: {
    assistant_id: 'assistant',
    input: null,
    command: { resume: { [id]: answer } },
    stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
    stream_subgraphs: true,
    stream_resumable: true,
    on_disconnect: 'continue',
  },
  events: reply,
  ...extra,
});
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((yes) => {
    release = yes;
  });
  return { promise, release };
}
async function until(predicate: () => boolean) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < end, 'Expected approval state before deadline');
    await new Promise((yes) => setTimeout(yes, 5));
  }
}
async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_yes, no) => {
        timer = setTimeout(
          () => no(new Error('Approval operation exceeded deadline')),
          3000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
async function fixture(
  t: TestContext,
  steps: Parameters<typeof startProofServer>[0],
  configure?: (o: ApplicationOptions) => ApplicationOptions
) {
  const server = await startProofServer(
    steps!.map((step, index) =>
      index < 2 ? { ...step, concurrentGroup: 'start' } : step
    )
  );
  let url = server.origin + '/?thread=a';
  const sessions: ApplicationSession[] = [];
  const options: ApplicationOptions = {
    assistantId: 'assistant',
    apiUrl: server.origin + '/api',
    directory: createThreadDirectory({
      apiBase: server.origin + '/api',
      browserOrigin: server.origin,
    }),
    history: {
      currentUrl: () => url,
      push: (next) => {
        url = next;
      },
      subscribe: () => () => {},
    },
    sessionFactory(threadId) {
      const actual = createSession({
        tools: applicationTools,
        assistantId: 'assistant',
        apiUrl: server.origin + '/api',
        threadId,
        clientOptions: { maxRetries: 0 },
      });
      sessions.push(actual);
      return actual;
    },
  };
  const app = createApplication(
    configure ? configure(options) : options
  ) as App;
  t.after(async () => {
    app.dispose();
    await server.close();
  });
  return { app, server, sessions };
}
const ready = (app: App, thread = 'a') =>
  until(
    () =>
      app.getSnapshot().selection.status === 'ready' &&
      app.getSnapshot().selection.id === thread
  );
function decision(app: App) {
  const value = app.getSnapshot().decision;
  assert.ok(value, 'A supported loaded approval must be published');
  return value;
}

for (const action of ['approve', 'decline'] as const) {
  test(`approval ${action} uses one exact addressed response and no human message`, async (t) => {
    const { app, server } = await fixture(t, [
      search(),
      lookup('a'),
      history('a'),
      resume('a', action === 'approve' ? 'approved' : 'denied'),
    ]);
    app.start();
    await ready(app);
    const original = app.getSnapshot();
    const card = decision(app);
    assert.equal(card.reason, reason);
    assert.equal(card.canRespond, true);
    assert.ok(Object.isFrozen(card));
    assert.equal(app.canSubmit(), false);
    assert.equal(app.submit('not a decision'), false);
    assert.equal(app.respond(Symbol('wrong'), action), false);
    assert.equal(app.respond(card.token, 'other' as 'approve'), false);
    assert.equal(app.respond(card.token, action), true);
    assert.equal(app.getSnapshot().submissionKind, 'decision');
    assert.equal(app.respond(card.token, action), false);
    assert.equal(app.submit('duplicate'), false);
    await until(() => app.getSnapshot().submission.outcome === 'success');
    assert.equal(app.getSnapshot().submissionKind, 'decision');
    assert.equal(
      app.getSnapshot().runtime?.messages.some((m) => m.role === 'user'),
      false
    );
    assert.equal(app.getSnapshot().decision, null);
    assert.equal(app.canSubmit(), true);
    assert.strictEqual(original.decision, card);
    assert.equal(card.canRespond, true);
    server.verify();
  });
}

for (const [name, interrupts] of Object.entries({
  unsupported: [{ id, value: { kind: 'refund_approval', reason } }],
  anonymous: [{ value: approval.value }],
  malformed: [{ id: 'pause-1', value: approval.value }],
  uppercase: [{ id: id.toUpperCase(), value: approval.value }],
  multiple: [approval, { ...approval, id: 'f'.repeat(32) }],
  static: [{ when: 'breakpoint' }],
})) {
  test(`approval ${name} root pause blocks Send and cannot respond`, async (t) => {
    const { app, server } = await fixture(t, [
      search(),
      lookup('a'),
      history('a', interrupts),
    ]);
    app.start();
    await ready(app);
    assert.equal(app.canSubmit(), false);
    assert.equal(app.getSnapshot().decision, null);
    assert.equal(app.submit('new turn'), false);
    assert.equal(app.respond(Symbol(), 'approve'), false);
    server.verify();
  });
}

test('approval child-only observations and next metadata do not gate text or authorize decisions', async (t) => {
  const body = saved('a', []);
  Object.assign(body[0], {
    tasks: [
      {
        id: 'parent-task',
        name: 'child',
        state: {
          values: { __interrupt__: [approval] },
          tasks: [{ interrupts: [approval] }],
        },
      },
    ],
  });
  const { app, server } = await fixture(t, [
    search(),
    lookup('a'),
    history('a', [], { body }),
  ]);
  app.start();
  await ready(app);
  assert.equal(app.getSnapshot().decision, null);
  assert.equal(app.canSubmit(), true);
  assert.equal(app.respond(Symbol(), 'approve'), false);
  server.verify();
});

for (const state of ['held', 'failed'] as const) {
  test(`approval ${state} history cannot admit a response`, async (t) => {
    const { app, server } = await fixture(t, [
      search(),
      lookup('a'),
      history(
        'a',
        [approval],
        state === 'held' ? { holdBody: true } : { status: 400 }
      ),
    ]);
    app.start();
    await deadline(server.steps[2].headersSent);
    if (state === 'failed')
      await until(() => app.getSnapshot().selection.status === 'error');
    assert.equal(app.respond(Symbol(), 'approve'), false);
    assert.equal(app.canSubmit(), false);
    assert.ok(!app.getSnapshot().decision?.canRespond);
    app.dispose();
    if (state === 'held')
      assert.deepEqual(await deadline(server.steps[2].closed), {
        finished: false,
      });
    server.verify();
  });
}

test('approval survives same-ID refresh, borrowed remount and unrelated runtime publication without parsing', async (t) => {
  let created = 0,
    updated = 0;
  const { app, server, sessions } = await fixture(
    t,
    [search(), lookup('a'), history('a'), search()],
    (o) => ({
      ...o,
      markdownFactory(document, options) {
        created++;
        const actual = createMarkdown(document, options);
        return {
          ...actual,
          update(next) {
            updated++;
            actual.update(next);
          },
        };
      },
    })
  );
  app.start();
  await ready(app);
  await until(() => app.getSnapshot().list.status === 'ready');
  const before = app.getSnapshot(),
    card = decision(app),
    work = [created, updated];
  const release = app.subscribe(() => {});
  release();
  app.subscribe(() => {});
  app.select('a');
  assert.strictEqual(app.getSnapshot(), before);
  await sessions[0].stop();
  assert.strictEqual(decision(app), card);
  app.refresh();
  assert.strictEqual(decision(app), card);
  await until(() => app.getSnapshot().list.status === 'ready');
  assert.strictEqual(decision(app), card);
  assert.strictEqual(app.getSnapshot().messages, before.messages);
  assert.deepEqual([created, updated], work);
  assert.equal(sessions.length, 1);
  server.verify();
});

test('approval repeat pause gets a fresh occurrence even when ID and reason are identical', async (t) => {
  const { app, server } = await fixture(t, [
    search(),
    lookup('a'),
    history('a'),
    resume('a', 'approved', { events: paused }),
    resume('a', 'denied'),
  ]);
  app.start();
  await ready(app);
  const first = decision(app);
  assert.equal(app.respond(first.token, 'approve'), true);
  await until(() => app.getSnapshot().submission.outcome === 'paused');
  const second = decision(app);
  assert.equal(second.id, first.id);
  assert.equal(second.reason, first.reason);
  assert.notEqual(second.token, first.token);
  assert.equal(second.canRespond, true);
  assert.equal(app.respond(first.token, 'decline'), false);
  assert.equal(app.respond(second.token, 'decline'), true);
  await until(() => app.getSnapshot().submission.outcome === 'success');
  server.verify();
});

test('approval observed during text streaming cannot respond until that text operation settles', async (t) => {
  const text = '  Review this please.\n';
  const { app, server } = await fixture(t, [
    search(),
    lookup('a'),
    history('a', []),
    {
      method: 'POST',
      path: '/api/threads/a/runs/stream',
      holdBody: true,
      events: paused,
      assertPayload(value: unknown) {
        const body = value as {
          input: { messages: { id: string; content: string }[] };
        };
        const message = body.input.messages[0];
        assert.equal(message.content, text);
        assert.equal('command' in body, false);
        assert.deepEqual(value, {
          assistant_id: 'assistant',
          input: {
            messages: [{ type: 'human', id: message.id, content: text }],
            client_tools: expectedClientTools,
          },
          stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
          stream_subgraphs: true,
          stream_resumable: true,
          on_disconnect: 'continue',
        });
      },
    },
    resume('a'),
  ]);
  app.start();
  await ready(app);
  assert.equal(app.submit(text), true);
  await until(() => !!app.getSnapshot().decision);
  const pending = decision(app);
  assert.equal(app.getSnapshot().submissionKind, 'text');
  assert.equal(pending.canRespond, false);
  assert.equal(app.respond(pending.token, 'approve'), false);
  server.steps[3].releaseBody();
  await until(() => app.getSnapshot().submission.outcome === 'paused');
  assert.equal(app.canSubmit(), false);
  assert.equal(decision(app).token, pending.token);
  assert.equal(app.respond(pending.token, 'approve'), true);
  await until(() => app.getSnapshot().submission.outcome === 'success');
  server.verify();
});

test('approval rejected completion suppresses a real replacement pause even when runtime is idle', async (t) => {
  const { app, server } = await fixture(
    t,
    [
      search(),
      lookup('a'),
      history('a'),
      resume('a', 'approved', { events: paused }),
      search(),
    ],
    (o) => ({
      ...o,
      sessionFactory(thread) {
        const actual = o.sessionFactory!(thread);
        return {
          ...actual,
          async resume(value, options) {
            assert.equal(await actual.resume(value, options), 'paused');
            throw new Error('completion delivery failed');
          },
        };
      },
    })
  );
  app.start();
  await ready(app);
  const old = decision(app);
  assert.equal(app.respond(old.token, 'approve'), true);
  await until(() => app.getSnapshot().submission.outcome === 'error');
  const replacement = decision(app);
  assert.notEqual(replacement.token, old.token);
  assert.equal(app.getSnapshot().runtime?.status, 'idle');
  assert.equal(replacement.canRespond, false);
  assert.equal(app.respond(replacement.token, 'approve'), false);
  app.refresh();
  await until(() => app.getSnapshot().list.status === 'ready');
  assert.strictEqual(decision(app), replacement);
  assert.equal(app.respond(replacement.token, 'decline'), false);
  server.verify();
});

for (const action of ['stop', 'select', 'dispose'] as const) {
  test(`approval reservation reentrant ${action} prevents a stale dispatch`, async (t) => {
    let invocations = 0,
      aborted = false;
    const { app, server } = await fixture(
      t,
      [
        search(),
        lookup('a'),
        history('a'),
        ...(action === 'select' ? [lookup('b'), history('b', [])] : []),
      ],
      (o) => ({
        ...o,
        sessionFactory(thread) {
          const actual = o.sessionFactory!(thread);
          return {
            ...actual,
            resume(value, options) {
              invocations++;
              aborted = options?.signal?.aborted ?? false;
              return actual.resume(value, options);
            },
          };
        },
      })
    );
    app.start();
    await ready(app);
    const card = decision(app);
    let entered = false;
    app.subscribe(() => {
      if (app.getSnapshot().submission.active && !entered) {
        entered = true;
        assert.equal(app.respond(card.token, 'decline'), false);
        assert.equal(app.submit('reentrant'), false);
        if (action === 'stop') app.stop();
        else if (action === 'select') app.select('b');
        else app.dispose();
      }
    });
    assert.equal(app.respond(card.token, 'approve'), action === 'stop');
    if (action === 'stop') {
      await until(() => app.getSnapshot().submission.outcome === 'aborted');
      assert.equal(invocations, 1);
      assert.equal(aborted, true);
      assert.equal(decision(app).canRespond, false);
    } else {
      if (action === 'select') await ready(app, 'b');
      assert.equal(invocations, 0);
    }
    assert.equal(app.respond(card.token, 'approve'), false);
    server.verify();
  });
}

test('approval held resume Stop closes HTTP but cannot release the shared slot before actual completion delivery', async (t) => {
  const gate = deferred(),
    settled = deferred();
  t.after(gate.release);
  const { app, server } = await fixture(
    t,
    [
      search(),
      lookup('a'),
      history('a'),
      resume('a', 'approved', {
        events: [...reply, ...paused],
        holdBody: true,
      }),
    ],
    (o) => ({
      ...o,
      sessionFactory(thread) {
        const actual = o.sessionFactory!(thread);
        return {
          ...actual,
          async resume(value, options) {
            const result = await actual.resume(value, options);
            settled.release();
            await gate.promise;
            return result;
          },
        };
      },
    })
  );
  app.start();
  await ready(app);
  const card = decision(app);
  assert.equal(app.respond(card.token, 'approve'), true);
  await until(
    () =>
      app.getSnapshot().runtime?.messages.some((m) => m.id === 'reply') ===
        true && !!app.getSnapshot().decision
  );
  const during = decision(app);
  assert.equal(during.canRespond, false);
  app.stop();
  assert.deepEqual(await deadline(server.steps[3].closed), { finished: false });
  await deadline(settled.promise);
  assert.equal(app.getSnapshot().submission.active, true);
  assert.equal(app.respond(during.token, 'decline'), false);
  assert.equal(app.submit('next'), false);
  gate.release();
  await until(() => app.getSnapshot().submission.outcome === 'aborted');
  assert.equal(decision(app).canRespond, false);
  assert.equal(app.respond(during.token, 'approve'), false);
  server.verify();
});

for (const outcome of ['error', 'interrupted'] as const) {
  test(`approval ${outcome} cannot re-enable replaced pause evidence or replay`, async (t) => {
    const events =
      outcome === 'error'
        ? [...paused, { event: 'error', data: { message: 'private failure' } }]
        : paused;
    const { app, server } = await fixture(t, [
      search(),
      lookup('a'),
      history('a'),
      resume(
        'a',
        'approved',
        outcome === 'error' ? { events } : { disconnect: true }
      ),
      search(),
    ]);
    app.start();
    await ready(app);
    const card = decision(app);
    assert.equal(app.respond(card.token, 'approve'), true);
    await until(() => !app.getSnapshot().submission.active);
    assert.equal(app.getSnapshot().submission.outcome, outcome);
    assert.ok(!app.getSnapshot().decision?.canRespond);
    assert.equal(app.respond(card.token, 'approve'), false);
    app.refresh();
    await until(() => app.getSnapshot().list.status === 'ready');
    assert.ok(!app.getSnapshot().decision?.canRespond);
    server.verify();
  });
}

for (const rejection of [false, true]) {
  test(`approval delayed ${
    rejection ? 'rejection' : 'completion'
  } from old A cannot settle a replacement A response`, async (t) => {
    const gate = deferred(),
      settled = deferred(),
      delivered = deferred();
    t.after(gate.release);
    let first = true;
    const { app, server, sessions } = await fixture(
      t,
      [
        search(),
        lookup('a'),
        history('a'),
        resume('a'),
        lookup('b'),
        history('b', []),
        lookup('a'),
        history('a'),
        resume('a', 'denied', { holdBody: true }),
      ],
      (o) => ({
        ...o,
        sessionFactory(thread) {
          const actual = o.sessionFactory!(thread),
            delay = first;
          first = false;
          return {
            ...actual,
            async resume(value, options) {
              const result = await actual.resume(value, options);
              if (delay) {
                settled.release();
                await gate.promise;
                delivered.release();
                if (rejection) throw new Error('late private error');
              }
              return result;
            },
          };
        },
      })
    );
    app.start();
    await ready(app);
    const old = decision(app);
    assert.equal(app.respond(old.token, 'approve'), true);
    await deadline(settled.promise);
    app.select('b');
    await ready(app, 'b');
    app.select('a');
    await ready(app);
    assert.equal(sessions.length, 3);
    assert.notStrictEqual(sessions[0], sessions[2]);
    const replacement = decision(app);
    assert.notEqual(old.token, replacement.token);
    assert.equal(app.respond(old.token, 'approve'), false);
    assert.equal(app.respond(replacement.token, 'decline'), true);
    await until(
      () =>
        app.getSnapshot().runtime?.messages.some((m) => m.id === 'reply') ===
        true
    );
    const current = app.getSnapshot();
    gate.release();
    await deadline(delivered.promise);
    await new Promise<void>((yes) => setImmediate(yes));
    assert.strictEqual(app.getSnapshot(), current);
    assert.equal(current.submission.active, true);
    assert.equal(app.submit('duplicate'), false);
    app.stop();
    assert.deepEqual(await deadline(server.steps[8].closed), {
      finished: false,
    });
    await until(() => app.getSnapshot().submission.outcome === 'aborted');
    server.verify();
  });
}
