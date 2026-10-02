import { beforeEach, expect, it, vi } from 'vitest';
import { createConnectedApplication, durableConnection } from './connection';
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
beforeEach(() => vi.clearAllMocks());
it.each([undefined, true, 'check'])(
  'requires a callable status reader: %j',
  async (checkStatus) => {
    mocks.create.mockImplementation(async ({ threadId }) => ({
      thread_id: threadId,
    }));
    mocks.session.mockReturnValue({
      checkStatus,
      dispose: vi.fn(async () => undefined),
    });
    const application = createConnectedApplication({
      apiUrl: 'https://example.test',
      headers: {},
    });
    await application.submit('A fictional project');
    expect(application.getSnapshot()).toMatchObject({
      threadId: null,
      canSubmit: false,
      canCheck: false,
      outcome: 'error',
    });
    await application.dispose();
  }
);
it('requires exact confirmed creation without retries or session construction', async () => {
  mocks.create.mockResolvedValue({ thread_id: 'different' });
  const application = createConnectedApplication({
    apiUrl: 'https://example.test',
    headers: { 'x-api-key': 'fictional-key' },
  });
  await application.submit('A fictional project');
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
it('rejects incompatible or failed runtime configuration', () => {
  expect(() =>
    durableConnection({
      status: 'error',
      error: 'configuration_failed',
    } as never)
  ).toThrow('Runtime configuration failed.');
  expect(() =>
    durableConnection({
      status: 'configured',
      target: { kind: 'ag-ui' },
    } as never)
  ).toThrow('Runtime configuration failed.');
});
