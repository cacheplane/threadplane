import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createSession } from '@threadplane/langgraph';
import type { ApplicationSession } from './application.js';
import { applicationTools } from './trip-summary.js';
import type { CompleteOutcome } from '@threadplane/core';
import { startProofServer, threadEnvelope } from '../tooling/proof-server.mjs';
import { createApplication, type ApplicationOptions } from './application.js';
import { createThreadDirectory } from './directory.js';
import type { BrowserHistory } from './route.js';

const search = (body: unknown = [], extra = {}) => ({
  method: 'POST',
  path: '/api/threads/search',
  payload: { limit: 50, offset: 0 },
  body,
  ...extra,
});
const lookup = (id: string, extra = {}) => ({
  method: 'GET',
  path: `/api/threads/${id}`,
  body: threadEnvelope(id, id),
  ...extra,
});
const history = (id: string, extra = {}) => ({
  method: 'POST',
  path: `/api/threads/${id}/history`,
  payload: { limit: 10 },
  body: [],
  ...extra,
});
const create = (id: string, extra = {}) => ({
  method: 'POST',
  path: '/api/threads',
  payload: { metadata: {} },
  body: threadEnvelope(id, id),
  ...extra,
});
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
const run = (id: string, text: string, extra = {}) => ({
  method: 'POST',
  path: `/api/threads/${id}/runs/stream`,
  assertPayload(payload: unknown) {
    const message = (payload as { input: { messages: { id: string }[] } }).input
      .messages[0];
    assert.match(
      message.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    assert.deepEqual(payload, {
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
  events: [
    {
      event: 'values',
      data: {
        messages: [{ type: 'ai', id: 'answer', content: 'Here is a reply.' }],
      },
    },
  ],
  ...extra,
});
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Owned operation exceeded deadline')),
          2000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
async function until(predicate: () => boolean) {
  const expires = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(
      Date.now() < expires,
      'Expected application state before deadline'
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function navigation(initial: string) {
  let url = initial;
  let reads = 0;
  const pushes: string[] = [];
  const listeners = new Set<() => void>();
  const boundary: BrowserHistory = {
    currentUrl() {
      reads++;
      return url;
    },
    push(next) {
      pushes.push(next);
      url = next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    boundary,
    pushes,
    listeners,
    get reads() {
      return reads;
    },
    get url() {
      return url;
    },
    pop(next: string) {
      url = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
async function fixture(
  t: TestContext,
  expectations: Parameters<typeof startProofServer>[0],
  route = '?theme=dark#bottom',
  configure?: (options: ApplicationOptions) => ApplicationOptions
) {
  const concurrentStart = new URL(
    'http://example.test/' + route
  ).searchParams.get('thread');
  const server = await startProofServer(
    (expectations ?? []).map((expected, index) =>
      concurrentStart && index < 2
        ? { ...expected, concurrentGroup: 'startup' }
        : expected
    )
  );
  const nav = navigation(server.origin + '/chat' + route);
  const sessions: ApplicationSession[] = [];
  const disposed: ApplicationSession[] = [];
  const options: ApplicationOptions = {
    history: nav.boundary,
    directory: createThreadDirectory({
      apiBase: server.origin + '/api',
      browserOrigin: server.origin,
    }),
    apiUrl: server.origin + '/api',
    assistantId: 'assistant',
    sessionFactory(id) {
      const actual = createSession({
        tools: applicationTools,
        assistantId: 'assistant',
        threadId: id,
        apiUrl: server.origin + '/api',
      });
      const owned = {
        ...actual,
        dispose() {
          disposed.push(owned);
          return actual.dispose();
        },
      };
      sessions.push(owned);
      return owned;
    },
  };
  const app = createApplication(configure ? configure(options) : options);
  t.after(async () => {
    app.dispose();
    await server.close();
  });
  return { app, nav, server, sessions, disposed };
}
type App = ReturnType<typeof createApplication>;
const ready = (app: App, id: string) =>
  until(
    () =>
      app.getSnapshot().selection.status === 'ready' &&
      app.getSnapshot().selection.id === id
  );
const listed = (app: App) =>
  until(() => app.getSnapshot().list.status === 'ready');

for (const unavailable of [
  'empty',
  'lookup-held',
  'missing',
  'history-held',
  'history-error',
] as const) {
  test(`submission refuses ${unavailable} history without calling actual runtime`, async (t) => {
    let submissions = 0;
    const expectations =
      unavailable === 'empty'
        ? [search()]
        : [
            search(),
            lookup(
              'a',
              unavailable === 'lookup-held'
                ? { holdHeaders: true }
                : unavailable === 'missing'
                ? { status: 404 }
                : {}
            ),
            ...(['history-held', 'history-error'].includes(unavailable)
              ? [
                  history(
                    'a',
                    unavailable === 'history-held'
                      ? { holdBody: true }
                      : { status: 400 }
                  ),
                ]
              : []),
          ];
    const { app, server } = await fixture(
      t,
      expectations,
      unavailable === 'empty' ? '' : '?thread=a',
      (options) => ({
        ...options,
        sessionFactory(id) {
          const actual = options.sessionFactory!(id);
          return {
            ...actual,
            submit(text) {
              submissions++;
              return actual.submit(text);
            },
          };
        },
      })
    );
    assert.equal(app.submit('Before startup'), false);
    app.start();
    await deadline(server.steps.at(-1)!.received);
    if (unavailable === 'missing' || unavailable === 'history-error')
      await until(() =>
        ['missing', 'error'].includes(app.getSnapshot().selection.status)
      );
    assert.equal(app.submit('Please explain this topic.'), false);
    assert.equal(app.canSubmit(), false);
    assert.equal(submissions, 0);
    assert.equal(app.getSnapshot().submission.active, false);
    app.stop();
    app.dispose();
    if (unavailable === 'lookup-held' || unavailable === 'history-held')
      assert.deepEqual(await deadline(server.steps.at(-1)!.closed), {
        finished: false,
      });
    server.verify();
  });
}

test('submission reserves before duplicate synchronous commands and observer reentry; preserves exact text', async (t) => {
  const text = '  Explain this topic.\nPlease keep the spacing.  ';
  let calls = 0;
  let reentered = false;
  const { app, server } = await fixture(
    t,
    [search(), lookup('a'), history('a'), run('a', text, { holdBody: true })],
    '?thread=a',
    (options) => ({
      ...options,
      sessionFactory(id) {
        const actual = options.sessionFactory!(id);
        return {
          ...actual,
          submit(text) {
            calls++;
            return actual.submit(text);
          },
        };
      },
    })
  );
  app.start();
  await ready(app, 'a');
  const before = app.getSnapshot();
  assert.equal(app.canSubmit(), true);
  app.subscribe(() => {
    if (app.getSnapshot().submission.active && !reentered) {
      reentered = true;
      assert.equal(app.submit('A second question.'), false);
    }
  });
  assert.equal(app.submit(text), true);
  assert.equal(app.submit('Another question.'), false);
  await deadline(server.steps[3].headersSent);
  assert.equal(reentered, true);
  assert.equal(calls, 1);
  assert.equal(app.canSubmit(), false);
  const active = app.getSnapshot();
  assert.deepEqual(active.submission, { active: true, outcome: null });
  server.steps[3].releaseBody();
  await until(() => !app.getSnapshot().submission.active);
  assert.deepEqual(app.getSnapshot().submission, {
    active: false,
    outcome: 'success',
  });
  assert.equal(app.canSubmit(), true);
  assert.deepEqual(before.submission, { active: false, outcome: null });
  assert.deepEqual(active.submission, { active: true, outcome: null });
  assert.ok(Object.isFrozen(active.submission));
  assert.deepEqual(await deadline(server.steps[3].closed), { finished: true });
  server.verify();
});

test('submission rejects blank-only input without touching the runtime', async (t) => {
  const { app, server } = await fixture(
    t,
    [search(), lookup('a'), history('a')],
    '?thread=a'
  );
  app.start();
  await ready(app, 'a');
  const before = app.getSnapshot();
  assert.equal(app.submit(' \n\t '), false);
  assert.strictEqual(app.getSnapshot(), before);
  server.verify();
});

test('stop during submission reservation prevents a later runtime launch and releases only on settlement', async (t) => {
  const gate = deferred();
  const settled = deferred();
  let calls = 0;
  let stops = 0;
  t.after(() => gate.release());
  const { app, server } = await fixture(
    t,
    [search(), lookup('a'), history('a')],
    '?thread=a',
    (options) => ({
      ...options,
      sessionFactory(id) {
        const actual = options.sessionFactory!(id);
        return {
          ...actual,
          async submit(text, runOptions) {
            calls++;
            const outcome = await actual.submit(text, runOptions);
            settled.release();
            await gate.promise;
            return outcome;
          },
          stop() {
            stops++;
            return actual.stop();
          },
        };
      },
    })
  );
  app.start();
  await ready(app, 'a');
  let stopped = false;
  app.subscribe(() => {
    if (app.getSnapshot().submission.active && !stopped) {
      stopped = true;
      app.stop();
    }
  });
  assert.equal(app.submit('Please explain the tides.'), true);
  assert.equal(app.submit('Please explain the moon.'), false);
  await deadline(settled.promise);
  assert.equal(calls, 1);
  assert.equal(stops, 1);
  assert.deepEqual(app.getSnapshot().submission, {
    active: true,
    outcome: null,
  });
  gate.release();
  await until(() => app.getSnapshot().submission.outcome === 'aborted');
  assert.equal(app.canSubmit(), true);
  server.verify();
});

test('stop closes actual held SSE but submission stays active until its own completion settles', async (t) => {
  const gate = deferred();
  const settled = deferred();
  let calls = 0;
  let stops = 0;
  t.after(() => gate.release());
  const { app, server } = await fixture(
    t,
    [
      search(),
      lookup('a'),
      history('a'),
      run('a', 'Tell me a story.', { holdBody: true }),
      run('a', 'Tell me another story.'),
    ],
    '?thread=a',
    (options) => ({
      ...options,
      sessionFactory(id) {
        const actual = options.sessionFactory!(id);
        return {
          ...actual,
          async submit(text) {
            const first = ++calls === 1;
            const result = await actual.submit(text);
            if (first) {
              settled.release();
              await gate.promise;
            }
            return result;
          },
          stop() {
            stops++;
            return actual.stop();
          },
        };
      },
    })
  );
  app.start();
  await ready(app, 'a');
  assert.equal(app.submit('Tell me a story.'), true);
  await deadline(server.steps[3].headersSent);
  await until(
    () =>
      app
        .getSnapshot()
        .runtime?.messages.some(
          (message) => message.content === 'Here is a reply.'
        ) === true
  );
  app.stop();
  app.stop();
  assert.equal(app.submit('Do not lose the first story.'), false);
  await deadline(settled.promise);
  assert.deepEqual(await deadline(server.steps[3].closed), { finished: false });
  assert.equal(stops, 2);
  assert.equal(calls, 1);
  assert.equal(app.canSubmit(), false);
  assert.deepEqual(app.getSnapshot().submission, {
    active: true,
    outcome: null,
  });
  gate.release();
  await until(() => !app.getSnapshot().submission.active);
  assert.equal(app.getSnapshot().submission.outcome, 'aborted');
  app.stop();
  assert.equal(stops, 2);
  assert.equal(app.submit('Tell me another story.'), true);
  await until(() => app.getSnapshot().submission.outcome === 'success');
  server.verify();
});

test('submission selection retires consumed SSE before a replacement submits', async (t) => {
  const { app, server } = await fixture(
    t,
    [
      search(),
      lookup('a'),
      history('a'),
      run('a', 'Explain the night sky.', { holdBody: true }),
      lookup('b'),
      history('b'),
      run('b', 'Explain the garden.'),
    ],
    '?thread=a'
  );
  app.start();
  await ready(app, 'a');
  assert.equal(app.submit('Explain the night sky.'), true);
  await until(
    () =>
      app
        .getSnapshot()
        .runtime?.messages.some(
          (message) => message.content === 'Here is a reply.'
        ) === true
  );
  const outgoing = app.getSnapshot();
  app.select('b');
  assert.deepEqual(await deadline(server.steps[3].closed), { finished: false });
  await ready(app, 'b');
  assert.deepEqual(app.getSnapshot().submission, {
    active: false,
    outcome: null,
  });
  assert.equal(app.submit('Explain the garden.'), true);
  await until(() => app.getSnapshot().submission.outcome === 'success');
  assert.deepEqual(outgoing.submission, { active: true, outcome: null });
  server.verify();
});

for (const destination of [
  'b-ready',
  'b-running',
  'a-running',
  'disposed',
] as const) {
  for (const reject of [false, true]) {
    test(`submission late ${
      reject ? 'rejection' : 'outcome'
    } from A cannot change ${destination}`, async (t) => {
      const gate = deferred();
      const settled = deferred();
      const delivered = deferred();
      let originalSession: ApplicationSession | undefined;
      const stopped: ApplicationSession[] = [];
      const running = destination.endsWith('-running');
      const runStep = destination === 'a-running' ? 8 : 6;
      t.after(() => gate.release());
      const expectations = [
        search(),
        lookup('a'),
        history('a'),
        run('a', 'Explain astronomy.'),
        ...(destination === 'disposed' ? [] : [lookup('b'), history('b')]),
        ...(destination === 'a-running' ? [lookup('a'), history('a')] : []),
        ...(running
          ? [
              run(destination === 'a-running' ? 'a' : 'b', 'Explain botany.', {
                holdBody: true,
              }),
            ]
          : []),
      ];
      const { app, server, sessions, disposed } = await fixture(
        t,
        expectations,
        '?thread=a',
        (options) => ({
          ...options,
          sessionFactory(id) {
            const actual = options.sessionFactory!(id);
            originalSession ??= actual;
            return {
              ...actual,
              async submit(text) {
                const outcome = await actual.submit(text);
                if (actual === originalSession) {
                  settled.release();
                  await gate.promise;
                  delivered.release();
                  if (reject) throw new Error('credential=do-not-expose');
                }
                return outcome;
              },
              stop() {
                stopped.push(actual);
                return actual.stop();
              },
            };
          },
        })
      );
      app.start();
      await ready(app, 'a');
      assert.equal(app.submit('Explain astronomy.'), true);
      await deadline(settled.promise);
      const outgoing = app.getSnapshot();
      if (destination === 'disposed') app.dispose();
      else {
        app.select('b');
        await ready(app, 'b');
        if (destination === 'a-running') {
          app.select('a');
          await ready(app, 'a');
          assert.equal(sessions.length, 3);
          assert.notStrictEqual(sessions[2], sessions[0]);
          assert.deepEqual(disposed, [sessions[0], sessions[1]]);
        }
        assert.deepEqual(app.getSnapshot().submission, {
          active: false,
          outcome: null,
        });
        if (running) {
          assert.equal(app.submit('Explain botany.'), true);
          await deadline(server.steps[runStep].headersSent);
          await until(
            () =>
              app
                .getSnapshot()
                .runtime?.messages.some(
                  (message) => message.content === 'Here is a reply.'
                ) === true
          );
        }
      }
      const current = app.getSnapshot();
      gate.release();
      await deadline(delivered.promise);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(app.getSnapshot(), current);
      assert.deepEqual(outgoing.submission, { active: true, outcome: null });
      if (running) {
        assert.deepEqual(app.getSnapshot().submission, {
          active: true,
          outcome: null,
        });
        assert.equal(app.canSubmit(), false);
        assert.equal(app.submit('Explain chemistry.'), false);
        app.stop();
        assert.deepEqual(stopped, [sessions.at(-1)]);
        assert.deepEqual(await deadline(server.steps[runStep].closed), {
          finished: false,
        });
        await until(() => app.getSnapshot().submission.outcome === 'aborted');
      }
      if (destination === 'disposed') {
        assert.equal(app.submit('Explain physics.'), false);
        assert.equal(app.canSubmit(), false);
        app.stop();
        assert.strictEqual(app.getSnapshot(), current);
      }
      server.verify();
    });
  }
}

for (const action of ['select', 'dispose'] as const) {
  test(`submission observer ${action} reentry prevents dispatch to retired runtime`, async (t) => {
    let calls = 0;
    const { app, server } = await fixture(
      t,
      [
        search(),
        lookup('a'),
        history('a'),
        ...(action === 'select' ? [lookup('b'), history('b')] : []),
      ],
      '?thread=a',
      (options) => ({
        ...options,
        sessionFactory(id) {
          const actual = options.sessionFactory!(id);
          return {
            ...actual,
            submit(text) {
              calls++;
              return actual.submit(text);
            },
          };
        },
      })
    );
    app.start();
    await ready(app, 'a');
    app.subscribe(() => {
      if (app.getSnapshot().submission.active) {
        if (action === 'select') app.select('b');
        else app.dispose();
      }
    });
    assert.equal(app.submit('Explain the ocean.'), false);
    if (action === 'select') await ready(app, 'b');
    assert.equal(calls, 0);
    server.verify();
  });
}

for (const outcome of [
  'success',
  'error',
  'paused',
  'interrupted',
  'rejected',
] as const) {
  test(`submission reports actual ${outcome} safely`, async (t) => {
    const events =
      outcome === 'error'
        ? [{ event: 'error', data: { message: 'credential=do-not-expose' } }]
        : outcome === 'paused'
        ? [
            {
              event: 'values',
              data: { __interrupt__: [{ id: 'question', value: 'Continue?' }] },
            },
          ]
        : outcome === 'interrupted'
        ? [{ event: 'custom', data: { progress: 'Waiting for a response.' } }]
        : undefined;
    const expectations = [
      search(),
      lookup('a'),
      history('a'),
      run('a', 'Explain the seasons.', events ? { events } : {}),
      ...(outcome === 'interrupted' ? [history('a')] : []),
    ];
    let actualOutcome: CompleteOutcome | undefined;
    const { app, server } = await fixture(
      t,
      expectations,
      '?thread=a',
      (options) => ({
        ...options,
        sessionFactory(id) {
          const actual = options.sessionFactory!(id);
          return {
            ...actual,
            async submit(text) {
              actualOutcome = await actual.submit(text);
              if (outcome === 'rejected')
                throw new Error('credential=do-not-expose');
              return actualOutcome;
            },
          };
        },
      })
    );
    app.start();
    await ready(app, 'a');
    assert.equal(app.submit('Explain the seasons.'), true);
    await until(() => !app.getSnapshot().submission.active);
    assert.equal(actualOutcome, outcome === 'rejected' ? 'success' : outcome);
    assert.deepEqual(app.getSnapshot().submission, {
      active: false,
      outcome: outcome === 'rejected' ? 'error' : outcome,
    });
    assert.equal(
      JSON.stringify(app.getSnapshot().submission).includes('credential'),
      false
    );
    server.verify();
  });
}

test('route application construction and borrowed observation are inert; bare start refreshes only once', async (t) => {
  const { app, nav, server, sessions } = await fixture(t, [search()]);
  const initial = app.getSnapshot();
  const callback = () => {};
  const release = app.subscribe(callback);
  app.getSnapshot();
  release();
  app.subscribe(callback)();
  assert.equal(nav.reads, 0);
  assert.equal(nav.listeners.size, 0);
  assert.equal(server.requests.length, 0);
  assert.equal(sessions.length, 0);
  assert.strictEqual(app.getSnapshot(), initial);
  app.start();
  await listed(app);
  const stable = app.getSnapshot();
  app.start();
  app.select(null);
  app.retry();
  app.subscribe(callback)();
  assert.strictEqual(app.getSnapshot(), stable);
  assert.equal(nav.reads, 1);
  assert.equal(nav.listeners.size, 1);
  assert.equal(sessions.length, 0);
  assert.equal(initial.list.status, 'idle');
  assert.ok(Object.isFrozen(stable));
  assert.ok(Object.isFrozen(stable.selection));
  assert.ok(Object.isFrozen(stable.list.rows));
  server.verify();
});

test('route deep link and reload admit actual fresh history without submit or create', async (t) => {
  for (let reload = 0; reload < 2; reload++) {
    const { app, server, nav, sessions } = await fixture(
      t,
      [search(), lookup('a'), history('a')],
      '?theme=dark&thread=a#bottom'
    );
    app.start();
    await ready(app, 'a');
    await listed(app);
    assert.equal(sessions.length, 1);
    assert.deepEqual(app.getSnapshot().runtime?.history, []);
    assert.equal(nav.pushes.length, 0);
    assert.equal(nav.url, server.origin + '/chat?theme=dark&thread=a#bottom');
    server.verify();
    app.dispose();
  }
});

test('selection pushes once, popstate never pushes, same ID and query-only navigation retain session, clearing releases it', async (t) => {
  const { app, server, nav, sessions, disposed } = await fixture(t, [
    search(),
    lookup('a'),
    history('a'),
    lookup('b'),
    history('b'),
  ]);
  app.start();
  await listed(app);
  app.select('a');
  await ready(app, 'a');
  const old = app.getSnapshot();
  app.select('a');
  nav.pop(server.origin + '/chat?theme=light&thread=a#top');
  assert.strictEqual(app.getSnapshot(), old);
  assert.equal(sessions.length, 1);
  nav.pop(server.origin + '/chat?theme=light&thread=b#top');
  await ready(app, 'b');
  assert.deepEqual(nav.pushes, [
    server.origin + '/chat?theme=dark&thread=a#bottom',
  ]);
  assert.equal(disposed.length, 1);
  assert.equal(old.selection.id, 'a');
  assert.equal(old.runtime?.history?.length, 0);
  assert.throws(() => {
    (old.selection as { id: string }).id = 'corrupt';
  }, TypeError);
  app.select(null);
  assert.deepEqual(app.getSnapshot().selection, { status: 'empty', id: null });
  assert.equal(app.getSnapshot().runtime, null);
  assert.equal(nav.pushes[1], server.origin + '/chat?theme=light#top');
  assert.equal(disposed.length, 2);
  server.verify();
});

for (const status of [404, 422, 503]) {
  test(`selection HTTP ${status} remains on route and explicit Retry admits fresh history`, async (t) => {
    const { app, server, sessions, nav } = await fixture(
      t,
      [search(), lookup('a', { status }), lookup('a'), history('a')],
      '?thread=a'
    );
    app.start();
    await until(
      () =>
        app.getSnapshot().selection.status ===
        (status === 503 ? 'error' : 'missing')
    );
    assert.equal(sessions.length, 0);
    const failed = app.getSnapshot();
    app.select('a');
    assert.strictEqual(app.getSnapshot(), failed);
    app.retry();
    await ready(app, 'a');
    assert.equal(sessions.length, 1);
    assert.equal(nav.pushes.length, 0);
    assert.equal(nav.url, server.origin + '/chat?thread=a');
    assert.doesNotMatch(JSON.stringify(failed), /hostile|secret|HTTP/);
    server.verify();
  });
}

test('history failure stays safe and Retry replaces the failed session with a fresh admission', async (t) => {
  const { app, server, sessions, disposed } = await fixture(
    t,
    [
      search(),
      lookup('a'),
      history('a', { status: 503 }),
      lookup('a'),
      history('a'),
    ],
    '?thread=a'
  );
  app.start();
  await until(() => app.getSnapshot().selection.status === 'error');
  const failure = app.getSnapshot();
  assert.equal(failure.runtime?.history, undefined);
  assert.doesNotMatch(JSON.stringify(failure), /hostile|secret|HTTP/);
  app.retry();
  await ready(app, 'a');
  assert.equal(sessions.length, 2);
  assert.equal(disposed.length, 1);
  assert.notStrictEqual(sessions[0], sessions[1]);
  server.verify();
});

for (const phase of ['lookup', 'history'] as const) {
  for (const destination of ['b', 'a'] as const) {
    test(
      `selection ${phase} A→B${
        destination === 'a' ? '→A' : ''
      } physically closes stale HTTP before cleanup`,
      { timeout: 5000 },
      async (t) => {
        const initial =
          phase === 'lookup'
            ? [lookup('a', { holdHeaders: true })]
            : [lookup('a'), history('a', { holdBody: true })];
        const { app, server, nav } = await fixture(t, [
          search(),
          ...initial,
          lookup(destination),
          history(destination),
        ]);
        app.start();
        await listed(app);
        app.select('a');
        const heldIndex = initial.length;
        await deadline(server.steps[heldIndex].received);
        if (phase === 'history')
          await deadline(server.steps[heldIndex].headersSent);
        if (destination === 'a') {
          // A reentrant observer replaces B before its lookup can start.
          const release = app.subscribe(() => {
            if (app.getSnapshot().selection.id === 'b') app.select('a');
          });
          app.select('b');
          release();
        } else app.select('b');
        assert.deepEqual(await deadline(server.steps[heldIndex].closed), {
          finished: false,
        });
        await ready(app, destination);
        assert.equal(app.getSnapshot().selection.id, destination);
        assert.equal(new URL(nav.url).searchParams.get('thread'), destination);
        server.verify();
      }
    );
  }
}

for (const phase of ['lookup', 'history'] as const) {
  for (const failure of [false, true]) {
    for (const destination of ['b', 'a', 'disposed'] as const) {
      test(`selection ignores late ${phase} ${
        failure ? 'failure' : 'success'
      } after ${
        destination === 'disposed'
          ? 'disposal'
          : destination === 'a'
          ? 'A→B→A'
          : 'A→B'
      }`, async (t) => {
        const gate = deferred();
        const completed = deferred();
        const initial =
          phase === 'lookup'
            ? [lookup('a', failure ? { status: 503 } : {})]
            : [lookup('a'), history('a', failure ? { status: 503 } : {})];
        let first = true;
        const replacement =
          destination === 'disposed'
            ? []
            : [
                lookup('b'),
                history('b'),
                ...(destination === 'a' ? [lookup('a'), history('a')] : []),
              ];
        const { app, server, nav } = await fixture(
          t,
          [search(), ...initial, ...replacement],
          '?thread=a',
          (options) => ({
            ...options,
            directory:
              phase !== 'lookup'
                ? options.directory
                : {
                    ...options.directory,
                    async get(id, signal) {
                      const delay = first;
                      first = false;
                      const result = await options.directory.get(id, signal);
                      if (delay) {
                        completed.release();
                        await gate.promise;
                      }
                      return result;
                    },
                  },
            sessionFactory:
              phase !== 'history'
                ? options.sessionFactory
                : (id) => {
                    const actual = options.sessionFactory!(id);
                    const delay = first;
                    first = false;
                    return {
                      ...actual,
                      async load(options) {
                        let rejected = false;
                        try {
                          await actual.load!(options);
                        } catch {
                          rejected = true;
                        }
                        if (delay) {
                          completed.release();
                          await gate.promise;
                        }
                        if (rejected)
                          throw new Error('hostile delayed failure');
                      },
                    };
                  },
          })
        );
        app.start();
        await deadline(completed.promise);
        assert.equal(app.getSnapshot().selection.status, 'pending');
        if (destination === 'disposed') app.dispose();
        else {
          app.select('b');
          await ready(app, 'b');
          if (destination === 'a') {
            app.select('a');
            await ready(app, 'a');
          }
        }
        const current = app.getSnapshot();
        gate.release();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(app.getSnapshot(), current);
        const url = nav.url;
        app.dispose();
        app.select('b');
        app.refresh();
        app.retry();
        app.start();
        nav.pop(server.origin + '/chat?thread=unused');
        assert.strictEqual(app.getSnapshot(), current);
        assert.equal(nav.listeners.size, 0);
        assert.equal(
          new URL(url).searchParams.get('thread'),
          destination === 'b' ? 'b' : 'a'
        );
        server.verify();
      });
    }
  }
}

test(
  'history default application runtime projects actual saved messages while startup list is held',
  { timeout: 5000 },
  async (t) => {
    const saved = [
      {
        values: {
          messages: [
            { type: 'human', id: 'message-1', content: 'Saved conversation' },
          ],
        },
        next: [],
        tasks: [],
        checkpoint: {
          thread_id: 'a',
          checkpoint_ns: '',
          checkpoint_id: 'checkpoint-1',
        },
        parent_checkpoint: null,
        metadata: { source: 'input', step: 0, parents: {} },
        created_at: '2026-09-28T00:00:00.000Z',
      },
    ];
    const { app, server } = await fixture(
      t,
      [
        search([], { holdHeaders: true }),
        lookup('a'),
        history('a', { body: saved }),
        lookup('b'),
        history('b'),
      ],
      '?thread=a',
      (options) => ({ ...options, sessionFactory: undefined })
    );
    app.start();
    await ready(app, 'a');
    const old = app.getSnapshot();
    assert.equal(old.list.status, 'pending');
    assert.equal(old.runtime?.messages[0]?.content, 'Saved conversation');
    assert.ok(Object.isFrozen(old.runtime?.messages[0]));
    app.select('b');
    await ready(app, 'b');
    assert.equal(old.runtime?.messages[0]?.content, 'Saved conversation');
    app.dispose();
    assert.deepEqual(await deadline(server.steps[0].closed), {
      finished: false,
    });
    server.verify();
  }
);

test('selection reentry after session construction retires it before history can begin', async (t) => {
  const { app, server, disposed } = await fixture(t, [
    search(),
    lookup('a'),
    lookup('b'),
    history('b'),
  ]);
  app.start();
  await listed(app);
  app.subscribe(() => {
    if (app.getSnapshot().selection.id === 'a' && app.getSnapshot().runtime)
      app.select('b');
  });
  app.select('a');
  await ready(app, 'b');
  assert.equal(disposed.length, 1);
  server.verify();
});

test(
  'history resolved by actual runtime disposal without accepted history is never ready',
  { timeout: 5000 },
  async (t) => {
    let current!: ApplicationSession;
    const { app, server } = await fixture(
      t,
      [
        search(),
        lookup('a'),
        history('a', { holdHeaders: true }),
        lookup('a'),
        history('a'),
      ],
      '?thread=a',
      (options) => ({
        ...options,
        sessionFactory(id) {
          current = options.sessionFactory!(id);
          return current;
        },
      })
    );
    app.start();
    await deadline(server.steps[2].received);
    await current.dispose();
    assert.deepEqual(await deadline(server.steps[2].closed), {
      finished: false,
    });
    await until(() => app.getSnapshot().selection.status === 'error');
    assert.equal(app.getSnapshot().runtime?.history, undefined);
    app.retry();
    await ready(app, 'a');
    server.verify();
  }
);

test(
  'history disposal closes current held HTTP; cancelled load resolution cannot admit it',
  { timeout: 5000 },
  async (t) => {
    const { app, server, disposed } = await fixture(
      t,
      [search(), lookup('a'), history('a', { holdHeaders: true })],
      '?thread=a'
    );
    app.start();
    await deadline(server.steps[2].received);
    const old = app.getSnapshot();
    app.dispose();
    assert.deepEqual(await deadline(server.steps[2].closed), {
      finished: false,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(app.getSnapshot(), old);
    assert.equal(old.selection.status, 'pending');
    assert.equal(disposed.length, 1);
    server.verify();
  }
);

test('selection reentrant observers and listener failures cannot continue old admission or share subscription releases', async (t) => {
  const { app, server, sessions } = await fixture(t, [
    search(),
    lookup('b'),
    history('b'),
  ]);
  app.start();
  await listed(app);
  const calls: string[] = [];
  const listener = () => {
    calls.push(app.getSnapshot().selection.status);
  };
  const release = app.subscribe(listener);
  app.subscribe(listener);
  release();
  app.subscribe(() => {
    throw new Error('observer failure');
  });
  app.subscribe(() => {
    if (app.getSnapshot().selection.id === 'a') app.select('b');
  });
  app.select('a');
  await ready(app, 'b');
  assert.ok(calls.length > 0);
  assert.equal(sessions.length, 1);
  server.verify();
});

test(
  'selection refresh is independent, retains accepted rows through pending/error and aborts stale search',
  { timeout: 5000 },
  async (t) => {
    const { app, server } = await fixture(
      t,
      [
        search([threadEnvelope('old', 'Old')]),
        lookup('a', { status: 404 }),
        search([], { holdBody: true }),
        search([threadEnvelope('new', 'New')]),
        search([], { status: 503 }),
      ],
      '?thread=a'
    );
    app.start();
    await listed(app);
    await until(() => app.getSnapshot().selection.status === 'missing');
    const old = app.getSnapshot();
    app.refresh();
    assert.strictEqual(app.getSnapshot().list.rows, old.list.rows);
    await deadline(server.steps[2].headersSent);
    app.refresh();
    assert.deepEqual(await deadline(server.steps[2].closed), {
      finished: false,
    });
    await until(() => app.getSnapshot().list.rows[0]?.id === 'new');
    app.refresh();
    await until(() => app.getSnapshot().list.status === 'error');
    assert.equal(app.getSnapshot().list.rows[0]?.id, 'new');
    assert.strictEqual(app.getSnapshot().selection, old.selection);
    assert.equal(old.list.rows[0]?.id, 'old');
    server.verify();
  }
);

for (const failure of [false, true]) {
  test(`selection ignores delayed refresh ${
    failure ? 'failure' : 'success'
  } after a newer refresh`, async (t) => {
    const gate = deferred();
    const completed = deferred();
    let calls = 0;
    const { app, server } = await fixture(
      t,
      [
        search([threadEnvelope('old')]),
        search([threadEnvelope('stale')], failure ? { status: 503 } : {}),
        search([threadEnvelope('new')]),
      ],
      '',
      (options) => ({
        ...options,
        directory: {
          ...options.directory,
          async list(signal) {
            const delay = ++calls === 2;
            const result = await options.directory.list(signal);
            if (delay) {
              completed.release();
              await gate.promise;
            }
            return result;
          },
        },
      })
    );
    app.start();
    await listed(app);
    app.refresh();
    await deadline(completed.promise);
    app.refresh();
    await until(() => app.getSnapshot().list.rows[0]?.id === 'new');
    const current = app.getSnapshot();
    gate.release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(app.getSnapshot(), current);
    server.verify();
  });
}

const settledList = (app: App) =>
  until(() => app.getSnapshot().list.status !== 'pending');

test('selection refresh adopts a changed matching ready title with its list and nothing else', async (t) => {
  const { app, nav, server, sessions, disposed } = await fixture(
    t,
    [
      search(),
      lookup('a'),
      history('a'),
      search([threadEnvelope('b', 'B'), threadEnvelope('a', 'Renamed')]),
    ],
    '?thread=a'
  );
  app.start();
  await ready(app, 'a');
  await listed(app);
  const before = app.getSnapshot();
  const pushes = nav.pushes.length;
  const seen: ReturnType<App['getSnapshot']>[] = [];
  app.subscribe(() => seen.push(app.getSnapshot()));
  app.refresh();
  await settledList(app);
  const after = app.getSnapshot();
  assert.equal(after.list.status, 'ready');
  assert.equal(after.selection.status, 'ready');
  assert.equal(after.selection.id, 'a');
  assert.equal(after.selection.row?.title, 'Renamed');
  assert.strictEqual(after.selection.row, after.list.rows[1]);
  assert.ok(Object.isFrozen(after.selection));
  // One atomic publication: no observer sees the new list with the old title.
  for (const observed of seen)
    assert.equal(
      observed.selection.row?.title,
      observed.list.status === 'ready' ? 'Renamed' : 'a'
    );
  assert.equal(seen.filter((s) => s.list.status === 'ready').length, 1);
  assert.equal(before.selection.row?.title, 'a');
  for (const key of [
    'runtime',
    'messages',
    'submission',
    'creation',
    'decision',
    'submissionKind',
  ] as const)
    assert.strictEqual(after[key], before[key], key);
  assert.equal(sessions.length, 1);
  assert.equal(disposed.length, 0);
  assert.equal(nav.pushes.length, pushes);
  server.verify();
});

test('selection refresh preserves same, omitted and failed titles but adopts a changed Untitled', async (t) => {
  const { app, server } = await fixture(
    t,
    [
      search(),
      lookup('a'),
      history('a'),
      search([threadEnvelope('a', 'a')]),
      search([threadEnvelope('b', 'B')]),
      search([threadEnvelope('a', 'Renamed')], { status: 503 }),
      search([threadEnvelope('a', '  ')]),
    ],
    '?thread=a'
  );
  app.start();
  await ready(app, 'a');
  await listed(app);
  const before = app.getSnapshot().selection;
  for (const expected of ['ready', 'ready', 'error'] as const) {
    app.refresh();
    await settledList(app);
    assert.equal(app.getSnapshot().list.status, expected);
    assert.strictEqual(app.getSnapshot().selection, before);
  }
  app.refresh();
  await settledList(app);
  assert.equal(app.getSnapshot().selection.row?.title, 'Untitled');
  assert.equal(app.getSnapshot().selection.id, 'a');
  server.verify();
});

test('selection refresh begun during pending admission does not adopt after admission completes', async (t) => {
  const { app, server } = await fixture(t, [
    search(),
    lookup('a', { holdBody: true }),
    search([threadEnvelope('a', 'Renamed')], { holdBody: true }),
    history('a'),
  ]);
  app.start();
  await listed(app);
  app.select('a');
  await deadline(server.steps[1].headersSent);
  app.refresh();
  await deadline(server.steps[2].headersSent);
  server.steps[1].releaseBody();
  await ready(app, 'a');
  const selection = app.getSnapshot().selection;
  server.steps[2].releaseBody();
  await settledList(app);
  assert.equal(app.getSnapshot().list.rows[0]?.title, 'Renamed');
  assert.strictEqual(app.getSnapshot().selection, selection);
  assert.equal(selection.row?.title, 'a');
  server.verify();
});

for (const back of [false, true]) {
  test(`selection refresh captured from A does not rename ${
    back ? 'a replacement A' : 'B'
  }`, async (t) => {
    const { app, server } = await fixture(
      t,
      [
        search(),
        lookup('a'),
        history('a'),
        search([threadEnvelope('a', 'A2'), threadEnvelope('b', 'B2')], {
          holdBody: true,
        }),
        lookup('b'),
        history('b'),
        ...(back ? [lookup('a'), history('a')] : []),
      ],
      '?thread=a'
    );
    app.start();
    await ready(app, 'a');
    await listed(app);
    app.refresh();
    await deadline(server.steps[3].headersSent);
    app.select('b');
    await ready(app, 'b');
    if (back) {
      app.select('a');
      await ready(app, 'a');
    }
    const selection = app.getSnapshot().selection;
    server.steps[3].releaseBody();
    await settledList(app);
    assert.equal(app.getSnapshot().list.rows.length, 2);
    assert.strictEqual(app.getSnapshot().selection, selection);
    server.verify();
  });
}

for (const reentry of ['abort listener', 'pending publication'] as const) {
  test(`selection refresh ignores a selection replaced by ${reentry} reentry`, async (t) => {
    const signals: AbortSignal[] = [];
    const { app, server } = await fixture(
      t,
      [
        search(),
        lookup('a'),
        history('a'),
        ...(reentry === 'abort listener'
          ? [search([threadEnvelope('a', 'Stale')], { holdBody: true })]
          : []),
        search([threadEnvelope('a', 'Renamed'), threadEnvelope('b', 'B2')], {
          concurrentGroup: 'reentry',
          holdBody: true,
        }),
        lookup('b', { concurrentGroup: 'reentry' }),
        history('b'),
      ],
      '?thread=a',
      (options) => ({
        ...options,
        directory: {
          ...options.directory,
          list(signal) {
            signals.push(signal);
            return options.directory.list(signal);
          },
        },
      })
    );
    app.start();
    await ready(app, 'a');
    await listed(app);
    if (reentry === 'abort listener') {
      app.refresh();
      await deadline(server.steps[3].headersSent);
      signals.at(-1)!.addEventListener('abort', () => app.select('b'));
    } else {
      const release = app.subscribe(() => {
        if (app.getSnapshot().list.status !== 'pending') return;
        release();
        app.select('b');
      });
    }
    app.refresh();
    const held = server.steps.at(-3)!;
    await deadline(held.headersSent);
    await ready(app, 'b');
    const selection = app.getSnapshot().selection;
    held.releaseBody();
    await until(() => app.getSnapshot().list.rows[0]?.title === 'Renamed');
    assert.strictEqual(app.getSnapshot().selection, selection);
    assert.equal(selection.row?.title, 'b');
    server.verify();
  });
}

test('selection refresh does not publish after disposal', async (t) => {
  const { app, server } = await fixture(
    t,
    [
      search(),
      lookup('a'),
      history('a'),
      search([threadEnvelope('a', 'Renamed')], { holdBody: true }),
    ],
    '?thread=a'
  );
  app.start();
  await ready(app, 'a');
  await listed(app);
  app.refresh();
  await deadline(server.steps[3].headersSent);
  const last = app.getSnapshot();
  app.dispose();
  server.steps[3].releaseBody();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.strictEqual(app.getSnapshot(), last);
  assert.equal(last.selection.row?.title, 'a');
});

test('selection does not await or adopt late disposal completion of the outgoing actual session', async (t) => {
  const gate = deferred();
  const disposing = deferred();
  const completed = deferred();
  let first = true;
  const { app, server } = await fixture(
    t,
    [search(), lookup('a'), history('a'), lookup('b'), history('b')],
    '?thread=a',
    (options) => ({
      ...options,
      sessionFactory(id) {
        const actual = options.sessionFactory!(id);
        const delay = first;
        first = false;
        return {
          ...actual,
          async dispose() {
            await actual.dispose();
            if (delay) {
              disposing.release();
              await gate.promise;
              completed.release();
            }
          },
        };
      },
    })
  );
  app.start();
  await ready(app, 'a');
  app.select('b');
  await deadline(disposing.promise);
  await ready(app, 'b');
  const current = app.getSnapshot();
  gate.release();
  await deadline(completed.promise);
  assert.strictEqual(app.getSnapshot(), current);
  server.verify();
});

test('creation reserves before synchronous duplicates and observer reentry; confirmed ID loads history once', async (t) => {
  const { app, nav, server } = await fixture(t, [
    search(),
    create('created', { holdHeaders: true }),
    lookup('created'),
    history('created', { holdBody: true }),
  ]);
  const initial = app.getSnapshot();
  app.newConversation();
  assert.strictEqual(app.getSnapshot(), initial);
  app.start();
  await listed(app);
  app.subscribe(() => {
    if (app.getSnapshot().creation.status === 'pending') app.newConversation();
  });
  app.newConversation();
  const pending = app.getSnapshot();
  assert.equal(pending.creation.status, 'pending');
  app.newConversation();
  assert.strictEqual(app.getSnapshot(), pending);
  await deadline(server.steps[1].received);
  assert.equal(server.requests.length, 2);
  assert.equal(nav.pushes.length, 0);
  server.steps[1].releaseHeaders();
  await deadline(server.steps[3].headersSent);
  assert.deepEqual(app.getSnapshot().creation, {
    status: 'confirmed',
    id: 'created',
  });
  assert.equal(app.getSnapshot().selection.status, 'pending');
  assert.equal(nav.pushes.length, 1);
  server.steps[3].releaseBody();
  await ready(app, 'created');
  assert.equal(
    nav.url,
    server.origin + '/chat?theme=dark&thread=created#bottom'
  );
  assert.equal(initial.creation.status, 'idle');
  assert.equal(pending.creation.status, 'pending');
  assert.ok(Object.isFrozen(pending.creation));
  assert.throws(() => {
    (pending.creation as { id: string }).id = 'corrupt';
  }, TypeError);
  server.verify();
});

for (const action of ['navigate', 'dispose'] as const) {
  test(`creation pending observer ${action} prevents SDK invocation`, async (t) => {
    const { app, server, nav } = await fixture(t, [
      search(),
      ...(action === 'navigate' ? [lookup('b'), history('b')] : []),
    ]);
    app.start();
    await listed(app);
    app.subscribe(() => {
      if (app.getSnapshot().creation.status === 'pending') {
        if (action === 'navigate') app.select('b');
        else app.dispose();
      }
    });
    app.newConversation();
    assert.notEqual(app.getSnapshot().creation.status, 'idle');
    if (action === 'navigate') {
      await ready(app, 'b');
      assert.equal(app.getSnapshot().creation.status, 'unconfirmed');
      assert.equal(nav.pushes.length, 1);
    } else {
      const retained = app.getSnapshot();
      app.newConversation();
      assert.strictEqual(app.getSnapshot(), retained);
      assert.equal(nav.pushes.length, 0);
    }
    server.verify();
  });
}

for (const action of ['navigate', 'retry', 'dispose'] as const) {
  test(`creation held SDK request closes on ${action} after server acceptance`, async (t) => {
    const { app, server, nav } = await fixture(
      t,
      [
        search(),
        lookup('a', action === 'retry' ? { status: 404 } : {}),
        ...(action === 'retry' ? [] : [history('a')]),
        create('remote', { holdHeaders: true }),
        ...(action === 'dispose'
          ? []
          : [
              lookup(action === 'retry' ? 'a' : 'b'),
              history(action === 'retry' ? 'a' : 'b'),
            ]),
      ],
      '?thread=a'
    );
    app.start();
    await listed(app);
    if (action === 'retry')
      await until(() => app.getSnapshot().selection.status === 'missing');
    else await ready(app, 'a');
    app.newConversation();
    assert.equal(app.getSnapshot().creation.status, 'pending');
    const step = server.steps[action === 'retry' ? 2 : 3];
    await deadline(step.received);
    const pending = app.getSnapshot();
    if (action === 'dispose') app.dispose();
    else if (action === 'retry') app.retry();
    else app.select('b');
    assert.deepEqual(await deadline(step.closed), { finished: false });
    if (action === 'dispose') assert.strictEqual(app.getSnapshot(), pending);
    else {
      await ready(app, action === 'retry' ? 'a' : 'b');
      assert.equal(app.getSnapshot().creation.status, 'unconfirmed');
      assert.equal(app.getSnapshot().creation.id, null);
    }
    assert.equal(nav.pushes.length, action === 'navigate' ? 1 : 0);
    assert.equal(pending.creation.status, 'pending');
    server.verify();
  });
}

for (const outcome of ['success', 'failure', 'rejection'] as const) {
  for (const destination of ['b', 'a', 'disposed'] as const) {
    test(`creation late ${outcome} after A→${destination} cannot change selection or newer operation`, async (t) => {
      const gate = deferred();
      const completed = deferred();
      let calls = 0;
      const { app, server, nav } = await fixture(
        t,
        [
          search(),
          lookup('a'),
          history('a'),
          create('stale', outcome === 'failure' ? { disconnect: true } : {}),
          ...(destination === 'disposed'
            ? []
            : [
                lookup('b'),
                history('b'),
                ...(destination === 'a' ? [lookup('a'), history('a')] : []),
                create('fresh', { holdHeaders: true }),
                lookup('fresh'),
                history('fresh'),
              ]),
        ],
        '?thread=a',
        (options) => ({
          ...options,
          directory: {
            ...options.directory,
            async create(signal) {
              const delay = ++calls === 1;
              const result = await options.directory.create(signal);
              if (delay) {
                completed.release();
                await gate.promise;
                if (outcome === 'rejection') throw new Error('hostile secret');
              }
              return result;
            },
          },
        })
      );
      t.after(gate.release);
      app.start();
      await ready(app, 'a');
      app.newConversation();
      assert.equal(app.getSnapshot().creation.status, 'pending');
      await deadline(completed.promise);
      if (destination === 'disposed') app.dispose();
      else {
        app.select('b');
        await ready(app, 'b');
        if (destination === 'a') {
          app.select('a');
          await ready(app, 'a');
        }
        assert.equal(app.getSnapshot().creation.status, 'unconfirmed');
        app.newConversation();
        assert.equal(app.getSnapshot().creation.status, 'pending');
        await deadline(server.steps[destination === 'a' ? 8 : 6].received);
      }
      const current = app.getSnapshot();
      const currentUrl = nav.url;
      const pushes = nav.pushes.length;
      gate.release();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(app.getSnapshot(), current);
      assert.equal(nav.url, currentUrl);
      assert.equal(nav.pushes.length, pushes);
      app.newConversation();
      assert.strictEqual(app.getSnapshot(), current);
      if (destination !== 'disposed') {
        server.steps[destination === 'a' ? 8 : 6].releaseHeaders();
        await ready(app, 'fresh');
        assert.deepEqual(app.getSnapshot().creation, {
          status: 'confirmed',
          id: 'fresh',
        });
        assert.equal(nav.pushes.length, pushes + 1);
      }
      server.verify();
    });
  }
}

test('creation network uncertainty retains selection; explicit Refresh inspects remote rows; later New is distinct', async (t) => {
  const { app, server, nav } = await fixture(t, [
    search(),
    create('remote', { disconnect: true }),
    search([threadEnvelope('remote')]),
    create('second'),
    lookup('second'),
    history('second'),
  ]);
  app.start();
  await listed(app);
  app.newConversation();
  assert.equal(app.getSnapshot().creation.status, 'pending');
  await until(() => app.getSnapshot().creation.status === 'unconfirmed');
  const uncertain = app.getSnapshot();
  assert.equal(server.requests.length, 2);
  assert.equal(nav.pushes.length, 0);
  assert.equal(uncertain.selection.status, 'empty');
  app.refresh();
  await listed(app);
  assert.strictEqual(app.getSnapshot().creation, uncertain.creation);
  assert.equal(app.getSnapshot().list.rows[0]?.id, 'remote');
  app.newConversation();
  await ready(app, 'second');
  assert.equal(app.getSnapshot().creation.id, 'second');
  assert.equal(nav.pushes.length, 1);
  assert.equal(uncertain.creation.status, 'unconfirmed');
  assert.doesNotMatch(JSON.stringify(uncertain), /hostile|secret|HTTP/);
  server.verify();
});

test('creation confirmed ID survives omitted list rows and a failed explicit refresh', async (t) => {
  const { app, server, nav } = await fixture(t, [
    search(),
    create('created'),
    lookup('created'),
    history('created'),
    search(),
    search([], { status: 503 }),
    create('second'),
    lookup('second'),
    history('second'),
  ]);
  app.start();
  await listed(app);
  app.newConversation();
  assert.equal(app.getSnapshot().creation.status, 'pending');
  await ready(app, 'created');
  const confirmed = app.getSnapshot();
  app.refresh();
  await listed(app);
  assert.deepEqual(app.getSnapshot().list.rows, []);
  assert.strictEqual(app.getSnapshot().creation, confirmed.creation);
  app.refresh();
  await until(() => app.getSnapshot().list.status === 'error');
  assert.strictEqual(app.getSnapshot().creation, confirmed.creation);
  assert.strictEqual(app.getSnapshot().selection, confirmed.selection);
  app.newConversation();
  await ready(app, 'second');
  assert.equal(app.getSnapshot().creation.id, 'second');
  assert.equal(nav.pushes.length, 2);
  assert.equal(confirmed.creation.id, 'created');
  server.verify();
});

for (const action of ['navigate', 'new', 'dispose'] as const) {
  test(`creation confirmed observer ${action} cannot let old success adopt selection`, async (t) => {
    const destination = action === 'new' ? 'second' : 'b';
    const { app, server, nav } = await fixture(t, [
      search(),
      create('first'),
      ...(action === 'new' ? [create('second')] : []),
      ...(action === 'dispose'
        ? []
        : [lookup(destination), history(destination)]),
    ]);
    app.start();
    await listed(app);
    app.subscribe(() => {
      if (app.getSnapshot().creation.id === 'first') {
        if (action === 'new') app.newConversation();
        else if (
          action === 'navigate' &&
          app.getSnapshot().selection.id !== 'b'
        )
          app.select('b');
        else if (action === 'dispose') app.dispose();
      }
    });
    app.newConversation();
    assert.equal(app.getSnapshot().creation.status, 'pending');
    if (action === 'dispose') {
      await until(() => app.getSnapshot().creation.status === 'confirmed');
      assert.equal(nav.pushes.length, 0);
      assert.equal(app.getSnapshot().selection.status, 'empty');
    } else {
      await ready(app, destination);
      assert.equal(nav.pushes.length, 1);
      assert.equal(new URL(nav.url).searchParams.get('thread'), destination);
    }
    server.verify();
  });
}
