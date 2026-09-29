import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createApplication } from './application.js';
import { createThreadDirectory } from './directory.js';
import {
  formatTripSummary,
  applicationTools,
  type ApplicationToolCall,
} from './trip-summary.js';
import { startProofServer, threadEnvelope } from '../tooling/proof-server.mjs';

async function until(predicate: () => boolean) {
  const end = Date.now() + 4000;
  while (!predicate()) {
    assert.ok(Date.now() < end, 'Expected summary application state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Owned HTTP gate exceeded deadline')),
          4000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
const args = {
  title: ' City break ',
  days: [{ day: 1, places: [' Museum '] }],
  note: ' Walk ',
};
const readable = 'City break\nDay 1: Museum\nWalk';
const call = (id = 'summary-call', input: unknown = args) => ({
  id,
  name: 'show_trip_summary',
  args: input,
});
const assistant = (calls = [call()]) => ({
  type: 'ai',
  id: 'summary-message',
  content: '',
  tool_calls: calls,
});
const final = (calls = [call()]) => ({
  event: 'values',
  data: { messages: [assistant(calls)] },
});
const result = (id = 'summary-call', content = readable) => ({
  id: `client-tool-result-${id}`,
  role: 'tool',
  type: 'tool',
  tool_call_id: id,
  content,
});
const lookup = (id: string) => ({
  method: 'GET',
  path: `/api/threads/${id}`,
  body: threadEnvelope(id),
});
const history = (id: string, body: unknown = []) => ({
  method: 'POST',
  path: `/api/threads/${id}/history`,
  payload: { limit: 10 },
  body,
});
const search = {
  method: 'POST',
  path: '/api/threads/search',
  payload: { limit: 50, offset: 0 },
  body: [],
};
const run = (events = [final()], text = 'Recap') => ({
  method: 'POST',
  path: '/api/threads/a/runs/stream',
  events,
  assertPayload(payload: unknown) {
    const id = (payload as { input: { messages: { id: string }[] } }).input
      .messages[0].id;
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    assert.deepEqual(payload, {
      assistant_id: 'assistant',
      input: {
        messages: [{ type: 'human', id, content: text }],
        client_tools: expectedClientTools,
      },
      stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
      stream_subgraphs: true,
      stream_resumable: true,
      on_disconnect: 'continue',
    });
  },
});
const write = (messages = [result()], extra = {}) => ({
  method: 'POST',
  path: '/api/threads/a/state',
  payload: { values: { messages } },
  body: { checkpoint_id: 'saved' },
  ...extra,
});
async function fixture(
  t: TestContext,
  following: Parameters<typeof startProofServer>[0],
  initialHistory: unknown = []
) {
  const server = await startProofServer([
    { ...search, concurrentGroup: 'start' },
    { ...lookup('a'), concurrentGroup: 'start' },
    history('a', initialHistory),
    ...following!,
  ]);
  let url = server.origin + '/?thread=a';
  const app = createApplication({
    assistantId: 'assistant',
    apiUrl: server.origin + '/api',
    directory: createThreadDirectory({
      apiBase: server.origin + '/api',
      browserOrigin: server.origin,
    }),
    history: {
      currentUrl: () => url,
      push(next) {
        url = next;
      },
      subscribe: () => () => {},
    },
  });
  t.after(async () => {
    app.dispose();
    await server.close();
  });
  app.start();
  await until(() => app.getSnapshot().selection.status === 'ready');
  return { app, server };
}
const summaries = (app: ReturnType<typeof createApplication>) =>
  app.getSnapshot().messages.flatMap((row) => row.tripSummaries);

test(
  'summary default owner persists one terminal result despite duplicate finalized events',
  { timeout: 10000 },
  async (t) => {
    const { app, server } = await fixture(t, [
      run([final(), final()]),
      write(),
    ]);
    const completed = new Set<ApplicationToolCall>();
    const cards = new Set<unknown>();
    const off = app.subscribe(() => {
      for (const call of app.getSnapshot().runtime?.toolCalls ?? [])
        if (call.status === 'complete') completed.add(call);
      for (const card of summaries(app)) cards.add(card);
    });
    assert.equal(app.submit('Recap'), true);
    await until(() => !app.getSnapshot().submission.active);
    assert.equal(
      server.requests.filter((request) => request.path.endsWith('/state'))
        .length,
      1,
      'Authored terminal handler must persist exactly once'
    );
    assert.equal(app.getSnapshot().submission.outcome, 'success');
    assert.equal(completed.size, 1);
    assert.equal(cards.size, 1);
    assert.equal(summaries(app)[0].text, readable);
    const retained = app.getSnapshot();
    const row = retained.messages.find((row) => row.tripSummaries.length)!;
    const bytes = JSON.stringify(retained);
    off();
    const offAgain = app.subscribe(() => {});
    assert.strictEqual(app.getSnapshot(), retained);
    offAgain();
    app.dispose();
    assert.equal(JSON.stringify(retained), bytes);
    assert.equal(row.tripSummaries.length, 1);
    server.verify();
  }
);

test('summary held terminal persistence retains active command while local card exists', async (t) => {
  const { app, server } = await fixture(t, [
    run(),
    write(undefined, { holdBody: true }),
    search,
  ]);
  assert.equal(app.submit('Recap'), true);
  await deadline(server.steps[4].received);
  assert.deepEqual(app.getSnapshot().submission, {
    active: true,
    outcome: null,
  });
  assert.equal(app.canSubmit(), false);
  assert.equal(app.submit('Must not overtake'), false);
  const row = app
    .getSnapshot()
    .messages.find((row) => row.tripSummaries.length)!;
  assert.equal(row.tripSummaries[0].text, readable);
  app.refresh();
  await until(() => app.getSnapshot().list.status === 'ready');
  assert.strictEqual(
    app.getSnapshot().messages.find((item) => item.id === row.id),
    row
  );
  server.steps[4].releaseBody();
  await until(() => app.getSnapshot().submission.outcome === 'success');
  assert.strictEqual(summaries(app)[0], row.tripSummaries[0]);
  server.verify();
});

test('summary failed terminal write reports error without automatic retry or model continuation', async (t) => {
  const { app, server } = await fixture(t, [
    run(),
    write(undefined, { status: 503 }),
  ]);
  assert.equal(app.submit('Recap'), true);
  await until(() => !app.getSnapshot().submission.active);
  assert.equal(app.getSnapshot().submission.outcome, 'error');
  assert.equal(summaries(app).length, 1);
  assert.equal(app.canSubmit(), true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  server.verify();
});

test('summary Stop settles command but pending persistence honestly rejects a new run', async (t) => {
  // Delay delivery of the real HTTP response to the SDK. A held socket alone
  // is insufficient: abort can reject fetch before the next app command.
  // This gate isolates the real runtime's pending-write admission boundary.
  let release!: () => void;
  const delivered = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const atBoundary = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const actualFetch = globalThis.fetch;
  t.mock.method(
    globalThis,
    'fetch',
    async (...input: Parameters<typeof fetch>) => {
      const response = await actualFetch(...input);
      if (response.url.endsWith('/api/threads/a/state')) {
        entered();
        await delivered;
      }
      return response;
    }
  );
  t.after(() => release());
  const { app, server } = await fixture(t, [
    run(),
    write(undefined, { holdBody: true }),
  ]);
  app.submit('Recap');
  await deadline(atBoundary);
  app.stop();
  await until(() => app.getSnapshot().submission.outcome === 'aborted');
  assert.equal(app.canSubmit(), true);
  assert.equal(app.submit('Cannot overtake private persistence'), true);
  await until(() => app.getSnapshot().submission.outcome === 'error');
  assert.equal(server.requests.length, 5);
  const retained = app.getSnapshot();
  release();
  server.steps[4].releaseBody();
  await deadline(server.steps[4].closed);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(app.getSnapshot().submission.outcome, 'error');
  assert.strictEqual(
    summaries(app)[0],
    retained.messages.flatMap((row) => row.tripSummaries)[0]
  );
  server.verify();
});

test('summary late old terminal completion cannot publish into a selected replacement', async (t) => {
  const { app, server } = await fixture(t, [
    run(),
    write(undefined, { holdBody: true }),
    lookup('b'),
    history('b'),
  ]);
  app.submit('Recap');
  await deadline(server.steps[4].received);
  const retained = app.getSnapshot();
  const bytes = JSON.stringify(retained);
  app.select('b');
  await until(
    () =>
      app.getSnapshot().selection.id === 'b' &&
      app.getSnapshot().selection.status === 'ready'
  );
  const replacement = app.getSnapshot();
  server.steps[4].releaseBody();
  await deadline(server.steps[4].closed);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.strictEqual(app.getSnapshot(), replacement);
  assert.deepEqual(summaries(app), []);
  assert.equal(JSON.stringify(retained), bytes);
  server.verify();
});

test('summary multiple calls project at their assistant row and never duplicate on saved ToolMessages', async (t) => {
  const calls = [call(), call('second', { title: 'Empty', days: [] })];
  const { app, server } = await fixture(t, [
    run([final(calls)]),
    write([result(), result('second', 'Empty')]),
  ]);
  app.submit('Recap');
  await until(() => !app.getSnapshot().submission.active);
  const row = app
    .getSnapshot()
    .messages.find((row) => row.id === 'summary-message')!;
  assert.deepEqual(
    row.tripSummaries.map((card) => card.callId),
    ['summary-call', 'second']
  );
  assert.deepEqual(
    row.tripSummaries.map((card) => card.text),
    [readable, 'Empty']
  );
  assert.equal(summaries(app).length, 2);
  for (const tool of app
    .getSnapshot()
    .messages.filter((row) => row.role === 'tool'))
    assert.deepEqual(tool.tripSummaries, []);
  server.verify();
});

test('summary fresh history remains literal readable text without execution, cards or writes', async (t) => {
  const saved = [
    {
      values: { messages: [assistant(), result()] },
      next: [],
      tasks: [],
      checkpoint: { thread_id: 'a', checkpoint_ns: '', checkpoint_id: 'saved' },
      parent_checkpoint: null,
      metadata: { source: 'input', step: 0, parents: {} },
      created_at: '2026-09-28T00:00:00.000Z',
    },
  ];
  const { app, server } = await fixture(t, [], saved);
  const tool = app.getSnapshot().messages.find((row) => row.role === 'tool')!;
  assert.equal(tool.message.toolCallId, 'summary-call');
  assert.equal(tool.markdown.document.content, readable);
  assert.deepEqual(app.getSnapshot().runtime!.toolCalls, []);
  assert.deepEqual(summaries(app), []);
  server.verify();
});

for (const [field, input] of [
  ['title', { ...args, title: {} }],
  ['day', { ...args, days: [{ day: '1', places: [] }] }],
  ['place', { ...args, days: [{ day: 1, places: [{}] }] }],
  ['note', { ...args, note: {} }],
] as const)
  test(`summary malformed ${field} fails ordinary formatting without card or transcript crash`, async (t) => {
    const { app, server } = await fixture(t, [
      run([final([call('summary-call', input)])]),
      {
        method: 'POST',
        path: '/api/threads/a/state',
        body: { checkpoint_id: 'error-saved' },
        assertPayload(payload: unknown) {
          const body = payload as {
            values: { messages: { content: string }[] };
          };
          assert.match(body.values.messages[0].content, /^Error: /);
          assert.deepEqual(payload, {
            values: {
              messages: [
                result('summary-call', body.values.messages[0].content),
              ],
            },
          });
        },
      },
    ]);
    app.submit('Recap');
    await until(() => !app.getSnapshot().submission.active);
    assert.equal(app.getSnapshot().runtime!.toolCalls[0].status, 'error');
    assert.deepEqual(summaries(app), []);
    assert.ok(
      app.getSnapshot().messages.some((row) => row.id === 'summary-message')
    );
    server.verify();
  });

test('summary formatter preserves literal content, empty lists and fractional or negative day numbers deterministically', () => {
  const args = Object.freeze({
    title: ' <b>Trip</b> ',
    days: Object.freeze([
      Object.freeze({
        day: -1.5,
        places: Object.freeze([' <img src=x> ', ' Park ']),
      }),
      Object.freeze({ day: -1.5, places: Object.freeze([]) }),
    ]),
    note: '  <script>note</script> ',
  });
  const first = formatTripSummary(args);
  assert.deepEqual(first, formatTripSummary(args));
  assert.equal(first.dayCount, 2);
  assert.equal(first.stopCount, 2);
  assert.deepEqual(
    first.days.map((day) => day.label),
    ['Day -1.5', 'Day -1.5']
  );
  assert.equal(
    first.text,
    '<b>Trip</b>\nDay -1.5: <img src=x> → Park\nDay -1.5: No stops\n<script>note</script>'
  );
  assert.deepEqual(formatTripSummary({ title: 'Empty', days: [] }).days, []);
  assert.equal(formatTripSummary({ title: 'Empty', days: [] }).note, undefined);
  const deepFrozen = (value: unknown) => {
    if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value));
      Object.values(value).forEach(deepFrozen);
    }
  };
  deepFrozen(first);
});

// These assertions compile inside both real isolated installed consumers.
if (false) {
  applicationTools.show_trip_summary.handler(
    // @ts-expect-error authored day arguments remain numbers through the catalog
    { title: '', days: [{ day: '1', places: [] }] },
    { signal: new AbortController().signal }
  );
  const wrongResult: ApplicationToolCall = {
    id: 'x',
    name: 'show_trip_summary',
    args: { title: '', days: [] },
    status: 'complete',
    // @ts-expect-error authored results cannot become arbitrary wire objects
    result: {},
  };
  const wrongName: ApplicationToolCall = {
    id: 'x',
    // @ts-expect-error unregistered tool names are excluded from this private application
    name: 'lookup',
    args: { title: '', days: [] },
    status: 'pending',
  };
  void wrongResult;
  void wrongName;
}

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
