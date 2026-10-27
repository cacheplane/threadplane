import { beforeEach, expect, it, vi } from 'vitest';
import { createConnectedApplication, streamingConnection } from './connection';
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@threadplane/ag-ui', async (original) => ({
  ...(await original<object>()),
  createSession: mocks.session,
}));
beforeEach(() => vi.resetAllMocks());
it('uses the fixed sibling agent route or the authored AG-UI developer endpoint', () => {
  expect(
    streamingConnection({
      status: 'configured',
      generation: 1,
      reportOperationFailure: vi.fn(),
      target: { kind: 'shared' },
    })
  ).toEqual({
    url: new URL('/ag-ui/streaming/agent', window.location.origin).href,
    label: 'Shared runtime',
  });
  expect(streamingConnection({ status: 'default' })).toEqual({
    url: new URL('/ag-ui/streaming/agent', window.location.origin).href,
    label: 'Shared runtime',
  });
  expect(
    streamingConnection({
      status: 'configured',
      generation: 1,
      reportOperationFailure: vi.fn(),
      target: {
        kind: 'ag-ui',
        endpoint: 'https://developer.test/agent',
      },
    })
  ).toEqual({
    url: 'https://developer.test/agent',
    label: 'Developer runtime',
  });
});
it.each(['error', 'langsmith'] as const)(
  'protects incompatible %s configuration',
  (kind) => {
    expect(() =>
      streamingConnection(
        kind === 'error'
          ? { status: 'error', code: 'incompatible_bridge' }
          : {
              status: 'configured',
              generation: 1,
              reportOperationFailure: vi.fn(),
              target: {
                kind: 'langsmith',
                apiUrl: 'https://private.test',
                apiKey: 'private-key',
              },
            }
      )
    ).toThrow('Runtime configuration failed.');
  }
);
it('constructs only on Send with its application UUID and exact native endpoint', async () => {
  const snapshot = { status: 'idle', transcript: [], state: {}, subagents: [] };
  const submit = vi.fn(async () => 'interrupted');
  mocks.session.mockReturnValue({
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    submit,
    resume: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  });
  const app = createConnectedApplication({
    url: 'https://developer.test/agent',
    label: 'Developer runtime',
  });
  expect(mocks.session).not.toHaveBeenCalled();
  await app.submit('  Fictional question  ');
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(mocks.session).toHaveBeenCalledWith({
    threadId: app.getSnapshot().threadId,
    url: 'https://developer.test/agent',
  });
  expect(app.getSnapshot().threadId).toMatch(/^[0-9a-f-]{36}$/);
  expect(submit).toHaveBeenCalledWith('  Fictional question  ', {
    signal: expect.any(AbortSignal),
  });
  await app.submit('Replay');
  expect(submit).toHaveBeenCalledTimes(1);
  await app.dispose();
});
it.each([
  undefined,
  {},
  { status: 'idle', transcript: [], subagents: undefined },
])(
  'rejects and releases a malformed native candidate before publishing it: %j',
  async (state) => {
    const dispose = vi.fn(async () => undefined);
    mocks.session.mockReturnValue({ getSnapshot: () => state, dispose });
    const app = createConnectedApplication({
      url: 'https://example.test/agent',
      label: 'Shared runtime',
    });
    await app.submit('Question');
    expect(app.getSnapshot()).toMatchObject({
      threadId: null,
      canSubmit: false,
      outcome: 'error',
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    await app.dispose();
  }
);
