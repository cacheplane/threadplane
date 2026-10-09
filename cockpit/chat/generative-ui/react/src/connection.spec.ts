import { beforeEach, expect, it, vi } from 'vitest';
import { createGenerativeUiClient, generativeUiConnection } from './connection';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getState: vi.fn(),
  session: vi.fn(),
  client: vi.fn(),
}));
vi.mock('@langchain/langgraph-sdk', () => ({
  Client: class {
    threads = { create: mocks.create, getState: mocks.getState };
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
    fork: async () => 'success',
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
  expect(
    generativeUiConnection({
      status: 'configured',
      target: {
        kind: 'langsmith',
        apiUrl: configuration.apiUrl,
        apiKey: 'fictional',
      },
    } as never)
  ).toEqual(configuration);
  expect(() => generativeUiConnection({ status: 'error' } as never)).toThrow();
  expect(() =>
    generativeUiConnection({
      status: 'configured',
      target: { kind: 'ag-ui' },
    } as never)
  ).toThrow();
});
it('constructs an inert retry-disabled client and keeps credentials in headers', () => {
  createGenerativeUiClient(configuration);
  expect(mocks.client).toHaveBeenCalledWith({
    apiUrl: configuration.apiUrl,
    apiKey: null,
    defaultHeaders: configuration.headers,
    callerOptions: { maxRetries: 0 },
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.getState).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
});
it('creates exactly one confirmed random-ID thread with raise-on-conflict', async () => {
  const client = createGenerativeUiClient(configuration),
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
  const client = createGenerativeUiClient(configuration);
  await expect(
    client.createThread(new AbortController().signal)
  ).rejects.toThrow('Conversation creation was not confirmed.');
  expect(() => client.sessionFactory('foreign')).toThrow();
  expect(mocks.session).not.toHaveBeenCalled();
});
it('does not create after an already aborted signal and hides provider diagnostics', async () => {
  const client = createGenerativeUiClient(configuration),
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
it('installs only known threads on c-generative-ui with zero runtime retries', async () => {
  const client = createGenerativeUiClient(configuration);
  expect(() => client.sessionFactory('unknown')).toThrow();
  expect(mocks.session).not.toHaveBeenCalled();
  const id = await client.createThread(new AbortController().signal);
  const session = client.sessionFactory(id);
  expect(session).toBe(mocks.session.mock.results[0].value);
  expect(mocks.session).toHaveBeenCalledWith({
    assistantId: 'c-generative-ui',
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
  const client = createGenerativeUiClient(configuration),
    id = await client.createThread(new AbortController().signal);
  expect(() => client.sessionFactory(id)).toThrow(
    'Runtime session is unavailable.'
  );
  expect(bad.dispose).toHaveBeenCalledTimes(1);
});
it('reads known checkpoint state without executing and passes the exact source and signal', async () => {
  const client = createGenerativeUiClient(configuration),
    signal = new AbortController().signal;
  const id = await client.createThread(signal);
  const source = {
    thread_id: id,
    checkpoint_ns: '',
    checkpoint_id: 'cp',
    checkpoint_map: { '': 'cp' },
  } as const;
  mocks.getState.mockResolvedValue({ next: [] });
  expect(await client.readCheckpoint(source, signal)).toEqual({ next: [] });
  expect(mocks.getState).toHaveBeenCalledWith(id, source, { signal });
  expect(mocks.session).not.toHaveBeenCalled();
  await expect(
    client.readCheckpoint({ ...source, thread_id: 'unknown' }, signal)
  ).rejects.toThrow();
  expect(mocks.getState).toHaveBeenCalledTimes(1);
});
it('owns connection configuration against later caller mutation', async () => {
  const config = { ...configuration, headers: { ...configuration.headers } };
  const client = createGenerativeUiClient(config);
  config.apiUrl = 'https://changed.test';
  config.headers['x-api-key'] = 'changed';
  const id = await client.createThread(new AbortController().signal);
  client.sessionFactory(id);
  expect(mocks.session.mock.calls[0][0].apiUrl).toBe(configuration.apiUrl);
  expect(mocks.session.mock.calls[0][0].clientOptions.defaultHeaders).toEqual(
    configuration.headers
  );
});
