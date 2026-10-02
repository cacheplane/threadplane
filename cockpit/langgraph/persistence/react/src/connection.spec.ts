import { beforeEach, expect, it, vi } from 'vitest';
import {
  createConnectedApplication,
  persistenceConnection,
} from './connection';

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
beforeEach(() => {
  vi.clearAllMocks();
});

it.each([undefined, true, 'load'])(
  'requires a callable history reader before publishing a session: %j',
  async (load) => {
    mocks.create.mockImplementation(async ({ threadId }) => ({
      thread_id: threadId,
    }));
    mocks.session.mockReturnValue({
      load,
      getSnapshot: () => ({
        status: 'idle',
        messages: [],
        toolCalls: [],
        interrupts: [],
      }),
      subscribe: () => () => undefined,
      submit: async () => 'success',
      stop: async () => undefined,
      dispose: async () => undefined,
    });
    const application = createConnectedApplication({
      apiUrl: 'https://example.test',
      headers: {},
    });
    await application.submit('A fictional fact');
    expect(application.getSnapshot()).toMatchObject({
      conversations: [],
      canSubmit: false,
      outcome: 'error',
    });
    await application.dispose();
  }
);

it('rejects an unconfirmed thread ID without constructing a session or replaying creation', async () => {
  mocks.create.mockResolvedValue({ thread_id: 'different-thread' });
  const application = createConnectedApplication({
    apiUrl: 'https://example.test',
    headers: { 'x-api-key': 'fictional-key' },
  });
  await application.submit('A fictional fact');
  await application.submit('Retry');
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.client).toHaveBeenCalledWith(
    expect.objectContaining({
      apiKey: null,
      callerOptions: { maxRetries: 0 },
      defaultHeaders: { 'x-api-key': 'fictional-key' },
    })
  );
  expect(mocks.create.mock.calls[0][0]).toMatchObject({
    ifExists: 'raise',
    signal: expect.any(AbortSignal),
  });
  await application.dispose();
});

it('does not connect an AG-UI runtime to the LangGraph history reader', () => {
  expect(() =>
    persistenceConnection({
      status: 'error',
      error: 'configuration_failed',
    } as never)
  ).toThrow('Runtime configuration failed.');
  expect(() =>
    persistenceConnection({
      status: 'configured',
      target: { kind: 'ag-ui' },
    } as never)
  ).toThrow('Runtime configuration failed.');
});
