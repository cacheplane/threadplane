import { beforeEach, expect, it, vi } from 'vitest';
import { createConnectedApplication, inputConnection } from './connection';
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
  expect(inputConnection({ status: 'default' } as never)).toEqual({
    apiUrl: new URL('/api', window.location.origin).href,
    headers: {},
  });
  expect(
    inputConnection({
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
  expect(() => inputConnection({ status: 'error' } as never)).toThrow();
  expect(() =>
    inputConnection({
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
it('selects only c-input with the exact confirmed thread and zero runtime retries', async () => {
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
      assistantId: 'c-input',
      threadId: mocks.create.mock.calls[0][0].threadId,
      clientOptions: {
        maxRetries: 0,
        defaultHeaders: { 'x-api-key': 'fictional' },
      },
    })
  );
  await app.dispose();
});
