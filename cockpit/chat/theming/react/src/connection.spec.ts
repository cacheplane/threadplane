import { beforeEach, expect, it, vi } from 'vitest';
import { createConnectedApplication, themingConnection } from './connection';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  session: vi.fn(),
  client: vi.fn(),
}));
vi.mock('@langchain/langgraph-sdk', () => ({
  Client: class {
    threads = { create: mocks.create };
    constructor(options: unknown) {
      mocks.client(options);
    }
  },
}));
vi.mock('@threadplane/langgraph', () => ({ createSession: mocks.session }));
beforeEach(() => vi.resetAllMocks());
it('uses the shared proxy or the authored developer LangSmith target', () => {
  expect(themingConnection({ status: 'default' } as never)).toEqual({
    apiUrl: new URL('/api', window.location.origin).href,
    headers: {},
  });
  expect(
    themingConnection({
      status: 'configured',
      target: {
        kind: 'langsmith',
        apiUrl: 'https://developer.test',
        apiKey: 'fictional',
      },
    } as never)
  ).toEqual({
    apiUrl: 'https://developer.test',
    headers: { 'x-api-key': 'fictional' },
  });
  expect(() => themingConnection({ status: 'error' } as never)).toThrow();
  expect(() =>
    themingConnection({
      status: 'configured',
      target: { kind: 'ag-ui' },
    } as never)
  ).toThrow();
});
it('does not retry unconfirmed creation or install a session for a different UUID', async () => {
  mocks.create.mockResolvedValue({ thread_id: 'different' });
  const app = createConnectedApplication({
    apiUrl: 'https://developer.test',
    headers: { 'x-api-key': 'fictional' },
  });
  expect(mocks.create).not.toHaveBeenCalled();
  await app.submit('Question');
  await app.submit('Retry');
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.client).toHaveBeenCalledWith(
    expect.objectContaining({ apiKey: null, callerOptions: { maxRetries: 0 } })
  );
});
it('selects only c-theming with the exact confirmed thread and zero runtime retries', async () => {
  mocks.create.mockImplementation(async ({ threadId }) => ({
    thread_id: threadId,
  }));
  mocks.session.mockReturnValue({
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
    dispose: async () => undefined,
    stop: async () => undefined,
  });
  const app = createConnectedApplication({
    apiUrl: 'https://developer.test',
    headers: { 'x-api-key': 'fictional' },
  });
  await app.submit('Question');
  expect(mocks.session).toHaveBeenCalledWith(
    expect.objectContaining({
      assistantId: 'c-theming',
      threadId: mocks.create.mock.calls[0][0].threadId,
      clientOptions: {
        maxRetries: 0,
        defaultHeaders: { 'x-api-key': 'fictional' },
      },
    })
  );
  await app.dispose();
});

it('captures one target and headers for creation, streaming and history despite caller mutation', async () => {
  mocks.create.mockImplementation(async ({ threadId }) => ({
    thread_id: threadId,
  }));
  mocks.session.mockReturnValue({
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
    dispose: async () => undefined,
    stop: async () => undefined,
  });
  const connection = {
    apiUrl: 'https://original.test',
    headers: { 'x-api-key': 'fictional-original' },
  };
  const app = createConnectedApplication(connection);
  connection.apiUrl = 'https://changed.test';
  connection.headers['x-api-key'] = 'fictional-changed';
  await app.newConversation();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
  await app.submit('Question');
  expect(mocks.client).toHaveBeenCalledWith(
    expect.objectContaining({
      apiUrl: 'https://original.test',
      defaultHeaders: { 'x-api-key': 'fictional-original' },
    })
  );
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      ifExists: 'raise',
      signal: expect.any(AbortSignal),
    })
  );
  expect(mocks.session).toHaveBeenCalledWith(
    expect.objectContaining({
      apiUrl: 'https://original.test',
      clientOptions: {
        maxRetries: 0,
        defaultHeaders: { 'x-api-key': 'fictional-original' },
      },
    })
  );
  await app.dispose();
});
it('leaves rejected candidate cleanup and its failure classification to the application owner', async () => {
  mocks.create.mockImplementation(async ({ threadId }) => ({
    thread_id: threadId,
  }));
  const dispose = vi.fn(async () => {
      throw Error('PRIVATE disposal');
    }),
    stop = vi.fn(async () => undefined);
  mocks.session.mockReturnValue({
    getSnapshot: () => {
      throw Error('PRIVATE snapshot');
    },
    subscribe: () => {
      throw Error('PRIVATE admission');
    },
    submit: async () => 'paused',
    load: async () => undefined,
    dispose,
    stop,
  });
  const app = createConnectedApplication({
    apiUrl: 'https://developer.test',
    headers: {},
  });
  await app.submit('Question');
  await app.newConversation();
  await app.submit('Retry');
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(app.getSnapshot()).toMatchObject({
    canSubmit: false,
    activity: 'cleanup-failed',
  });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(app.getSnapshot())).not.toContain('PRIVATE');
  await app.dispose();
});
