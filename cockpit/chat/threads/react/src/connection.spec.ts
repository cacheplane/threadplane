import { beforeEach, expect, it, vi } from 'vitest';
import { createThreadsClient, threadsConnection } from './connection';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  session: vi.fn(),
  client: vi.fn(),
}));
vi.mock('@langchain/langgraph-sdk', () => ({
  Client: class {
    threads = { create: mocks.create, get: mocks.get };
    constructor(options: unknown) {
      mocks.client(options);
    }
  },
}));
vi.mock('@threadplane/langgraph', () => ({ createSession: mocks.session }));
const configuration = {
  apiUrl: 'https://developer.test',
  headers: { 'x-api-key': 'fictional' },
};
function validSession() {
  return {
    getSnapshot: () => ({
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
      subgraphs: [],
      history: undefined,
    }),
    subscribe: () => () => undefined,
    submit: async () => 'paused',
    load: async () => undefined,
    stop: async () => undefined,
    dispose: vi.fn(async () => undefined),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockImplementation(async ({ threadId }) => ({
    thread_id: threadId,
  }));
  mocks.session.mockReturnValue(validSession());
});
it('uses the shared proxy or the explicitly configured LangSmith endpoint', () => {
  expect(threadsConnection({ status: 'default' } as never)).toEqual({
    apiUrl: new URL('/api', window.location.origin).href,
    headers: {},
  });
  expect(
    threadsConnection({
      status: 'configured',
      target: {
        kind: 'langsmith',
        apiUrl: configuration.apiUrl,
        apiKey: 'fictional',
      },
    } as never)
  ).toEqual(configuration);
  expect(() => threadsConnection({ status: 'error' } as never)).toThrow();
  expect(() =>
    threadsConnection({
      status: 'configured',
      target: { kind: 'ag-ui' },
    } as never)
  ).toThrow();
});
it('constructs an inert retry-disabled client and keeps credentials in headers', () => {
  createThreadsClient(configuration);
  expect(mocks.client).toHaveBeenCalledWith({
    apiUrl: configuration.apiUrl,
    apiKey: null,
    defaultHeaders: configuration.headers,
    callerOptions: { maxRetries: 0 },
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
});
it('creates exactly one confirmed random-ID thread with raise-on-conflict', async () => {
  const client = createThreadsClient(configuration),
    signal = new AbortController().signal,
    id = await client.createThread(signal);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create).toHaveBeenCalledWith({
    threadId: id,
    ifExists: 'raise',
    signal,
  });
  expect(JSON.stringify(mocks.create.mock.calls)).not.toContain('fictional');
});
it('rejects mismatched creation without registering that thread', async () => {
  mocks.create.mockResolvedValue({ thread_id: 'foreign' });
  const client = createThreadsClient(configuration);
  await expect(
    client.createThread(new AbortController().signal)
  ).rejects.toThrow('Conversation creation was not confirmed.');
  expect(() => client.sessionFactory('foreign')).toThrow();
  expect(mocks.session).not.toHaveBeenCalled();
});
it('does not create after an already aborted signal and hides provider diagnostics', async () => {
  const client = createThreadsClient(configuration),
    aborted = new AbortController();
  aborted.abort();
  await expect(client.createThread(aborted.signal)).rejects.toThrow();
  expect(mocks.create).not.toHaveBeenCalled();
  mocks.create.mockRejectedValue(new Error('PRIVATE fictional'));
  await expect(
    client.createThread(new AbortController().signal)
  ).rejects.toThrow('Conversation creation was not confirmed.');
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it('installs only known threads on c-threads with zero runtime retries', async () => {
  const client = createThreadsClient(configuration);
  expect(() => client.sessionFactory('unknown')).toThrow();
  expect(mocks.session).not.toHaveBeenCalled();
  const id = await client.createThread(new AbortController().signal);
  const session = client.sessionFactory(id);
  expect(session).toBe(mocks.session.mock.results[0].value);
  expect(mocks.session).toHaveBeenCalledWith({
    assistantId: 'c-threads',
    threadId: id,
    apiUrl: configuration.apiUrl,
    clientOptions: { maxRetries: 0, defaultHeaders: configuration.headers },
  });
});
it('disposes a rejected session and returns a generic diagnostic', async () => {
  const bad = {
    getSnapshot: () => {
      throw new Error('PRIVATE fictional');
    },
    dispose: vi.fn(async () => undefined),
  };
  mocks.session.mockReturnValue(bad);
  const client = createThreadsClient(configuration),
    id = await client.createThread(new AbortController().signal);
  expect(() => client.sessionFactory(id)).toThrow(
    'Runtime session is unavailable.'
  );
  expect(bad.dispose).toHaveBeenCalledTimes(1);
});
it('reads optional metadata only for known confirmed IDs with the caller signal', async () => {
  const client = createThreadsClient(configuration),
    signal = new AbortController().signal;
  expect(await client.readTitle('unknown', signal)).toBeUndefined();
  expect(mocks.get).not.toHaveBeenCalled();
  const id = await client.createThread(signal),
    raw = { thread_id: id, metadata: { title: 'Literal' } };
  mocks.get.mockResolvedValue(raw);
  expect(await client.readTitle(id, signal)).toEqual(raw);
  expect(mocks.get).toHaveBeenCalledWith(id, { signal });
  expect(mocks.get).toHaveBeenCalledTimes(1);
});
it('ignores failed, aborted and late metadata without retrying', async () => {
  const client = createThreadsClient(configuration),
    signal = new AbortController().signal,
    id = await client.createThread(signal);
  mocks.get.mockRejectedValue(new Error('PRIVATE fictional'));
  expect(await client.readTitle(id, signal)).toBeUndefined();
  const aborted = new AbortController();
  aborted.abort();
  expect(await client.readTitle(id, aborted.signal)).toBeUndefined();
  expect(mocks.get).toHaveBeenCalledTimes(1);
  let resolve!: (value: unknown) => void;
  mocks.get.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const controller = new AbortController(),
    pending = client.readTitle(id, controller.signal);
  controller.abort();
  resolve({ thread_id: id, metadata: { title: 'Late' } });
  expect(await pending).toBeUndefined();
  expect(mocks.get).toHaveBeenCalledTimes(2);
});
