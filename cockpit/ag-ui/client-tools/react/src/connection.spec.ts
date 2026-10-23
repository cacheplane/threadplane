import { beforeEach, expect, it, vi } from 'vitest';
import {
  clientToolsConnection,
  createConnectedApplication,
} from './connection';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@threadplane/ag-ui', async (original) => ({
  ...(await original<object>()),
  createSession: mocks.create,
}));
beforeEach(() => vi.resetAllMocks());
it('uses authored native developer configuration or the exact fixed shared route', () => {
  expect(clientToolsConnection({ status: 'default' })).toEqual({
    url: new URL('/ag-ui/client-tools/agent', window.location.origin).href,
    label: 'Shared runtime',
  });
  expect(
    clientToolsConnection({
      status: 'configured',
      generation: 1,
      reportOperationFailure: vi.fn(),
      target: { kind: 'ag-ui', endpoint: 'https://developer.test/agent' },
    })
  ).toEqual({
    url: 'https://developer.test/agent',
    label: 'Developer runtime',
  });
});
it.each(['error', 'langsmith', 'invalid-url'] as const)(
  'rejects %s configuration without leaking secrets',
  (kind) => {
    expect(() =>
      clientToolsConnection(
        kind === 'error'
          ? { status: 'error', code: 'incompatible_bridge' }
          : {
              status: 'configured',
              generation: 1,
              reportOperationFailure: vi.fn(),
              target:
                kind === 'langsmith'
                  ? {
                      kind: 'langsmith',
                      apiUrl: 'https://private.test',
                      apiKey: 'SECRET',
                    }
                  : { kind: 'ag-ui', endpoint: 'javascript:SECRET' },
            }
      )
    ).toThrow('Runtime configuration failed.');
  }
);
it('is inert before Send and supplies real five-tool catalog as the native second argument', async () => {
  const native = {
    status: 'idle',
    transcript: [],
    state: {},
    subagents: [],
    clientTools: { calls: [] },
  };
  const submit = vi.fn(async () => 'interrupted');
  const dispose = vi.fn();
  mocks.create.mockReturnValue({
    getSnapshot: () => native,
    subscribe: () => () => undefined,
    submit,
    resume: vi.fn(),
    stop: vi.fn(),
    dispose,
  });
  const app = createConnectedApplication({
    url: 'https://developer.test/agent',
    label: 'Developer runtime',
  });
  expect(mocks.create).not.toHaveBeenCalled();
  await app.submit('  authored  ');
  expect(mocks.create).toHaveBeenCalledWith(
    {
      threadId: app.getSnapshot().threadId,
      url: 'https://developer.test/agent',
    },
    expect.objectContaining({
      confirm_booking: expect.objectContaining({
        handler: expect.any(Function),
      }),
    })
  );
  expect(submit).toHaveBeenCalledWith('  authored  ', {
    signal: expect.any(AbortSignal),
  });
  await app.dispose();
});
it.each([
  undefined,
  {},
  { status: 'idle', transcript: [], subagents: [], clientTools: {} },
])(
  'rejects missing typed native clientTools capability before transport',
  async (native) => {
    const dispose = vi.fn();
    const submit = vi.fn();
    mocks.create.mockReturnValue({
      getSnapshot: () => native,
      submit,
      dispose,
    });
    const app = createConnectedApplication({
      url: 'https://developer.test/agent',
      label: 'Developer runtime',
    });
    await app.submit('no');
    expect(submit).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(app.getSnapshot()).toMatchObject({
      threadId: null,
      canSubmit: false,
      outcome: 'error',
    });
  }
);
