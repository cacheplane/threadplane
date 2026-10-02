import { beforeEach, expect, it, vi } from 'vitest';
import { createConnectedApplication, deploymentConnection } from './connection';
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
it('uses the same-origin proxy until an authored developer target is supplied', () => {
  expect(deploymentConnection({ status: 'default' } as never)).toEqual({
    apiUrl: new URL('/api', window.location.origin).href,
    headers: {},
    label: 'Shared runtime',
  });
  expect(
    deploymentConnection({
      status: 'configured',
      target: {
        kind: 'langsmith',
        apiUrl: 'https://developer.test',
        apiKey: 'fictional-key',
      },
    } as never)
  ).toEqual({
    apiUrl: 'https://developer.test',
    headers: { 'x-api-key': 'fictional-key' },
    label: 'Developer runtime',
  });
});
it.each(['error', 'incompatible'])(
  'rejects %s runtime configuration',
  (kind) => {
    expect(() =>
      deploymentConnection(
        kind === 'error'
          ? ({ status: 'error', error: 'configuration_failed' } as never)
          : ({ status: 'configured', target: { kind: 'ag-ui' } } as never)
      )
    ).toThrow('Runtime configuration failed.');
  }
);
it('creates lazily and accepts only the exact requested UUID without retries', async () => {
  mocks.create.mockResolvedValue({ thread_id: 'different' });
  const application = createConnectedApplication({
    label: 'Developer runtime',
    apiUrl: 'https://example.test',
    headers: { 'x-api-key': 'fictional-key' },
  });
  expect(mocks.create).not.toHaveBeenCalled();
  await application.submit('Fictional question');
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
    threadId: expect.any(String),
    signal: expect.any(AbortSignal),
  });
  expect(application.getSnapshot().canSubmit).toBe(false);
  await application.dispose();
});
it.each([
  undefined,
  {},
  { messages: [], toolCalls: [], interrupts: undefined },
])(
  'rejects and disposes an adapter without a coherent extended snapshot: %j',
  async (state) => {
    mocks.create.mockImplementation(async ({ threadId }) => ({
      thread_id: threadId,
    }));
    const dispose = vi.fn(async () => undefined);
    mocks.session.mockReturnValue({ getSnapshot: () => state, dispose });
    const application = createConnectedApplication({
      label: 'Shared runtime',
      apiUrl: 'https://example.test',
      headers: {},
    });
    await application.submit('Fictional question');
    expect(application.getSnapshot()).toMatchObject({
      canSubmit: false,
      threadId: null,
      outcome: 'error',
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    await application.dispose();
  }
);
it('binds the confirmed thread to the existing Deployment Runtime assistant and private SDK defaults', async () => {
  mocks.create.mockImplementation(async ({ threadId }) => ({
    thread_id: threadId,
  }));
  const state = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    subgraphs: [],
    interrupts: [],
  };
  const submit = vi.fn(async () => 'interrupted');
  mocks.session.mockReturnValue({
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    submit,
    dispose: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  });
  const application = createConnectedApplication({
    label: 'Developer runtime',
    apiUrl: 'https://developer.test',
    headers: { 'x-api-key': 'fictional-key' },
  });
  await application.submit('Fictional question');
  expect(mocks.session).toHaveBeenCalledWith({
    assistantId: 'deployment-runtime',
    threadId: mocks.create.mock.calls[0][0].threadId,
    apiUrl: 'https://developer.test',
    clientOptions: {
      maxRetries: 0,
      defaultHeaders: { 'x-api-key': 'fictional-key' },
    },
  });
  expect(submit).toHaveBeenCalledWith('Fictional question', {
    signal: expect.any(AbortSignal),
  });
  await application.dispose();
});

it('rejects a snapshot-only adapter and disposes it before subscribing or publishing a UUID', async () => {
  mocks.create.mockImplementation(async ({ threadId }) => ({
    thread_id: threadId,
  }));
  const dispose = vi.fn(async () => undefined);
  mocks.session.mockReturnValue({
    getSnapshot: () => ({
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
    }),
    dispose,
  });
  const application = createConnectedApplication({
    label: 'Shared runtime',
    apiUrl: 'https://example.test',
    headers: {},
  });
  await application.submit('Fictional question');
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(application.getSnapshot()).toMatchObject({
    threadId: null,
    canSubmit: false,
    outcome: 'error',
  });
  await application.dispose();
});
