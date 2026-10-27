import { beforeEach, expect, it, vi } from 'vitest';
import { createConnectedApplication, strandsConnection } from './connection';
const native = vi.hoisted(() => vi.fn());
vi.mock('@threadplane/ag-ui', async (original) => ({
  ...(await original<object>()),
  createSession: native,
}));
beforeEach(() => vi.resetAllMocks());
it('selects the current-origin shared endpoint or configured AG-UI developer endpoint', () => {
  expect(strandsConnection({ status: 'default' })).toEqual({
    url: new URL('/runtimes/aws-strands/agent', window.location.origin).href,
    label: 'Shared runtime',
  });
  expect(
    strandsConnection({
      status: 'configured',
      generation: 1,
      reportOperationFailure: vi.fn(),
      target: { kind: 'shared' },
    }).label
  ).toBe('Shared runtime');
  expect(
    strandsConnection({
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
it('rejects error and LangSmith configurations before any native allocation', () => {
  expect(() =>
    strandsConnection({ status: 'error', code: 'incompatible_bridge' })
  ).toThrow('Runtime configuration failed.');
  expect(() =>
    strandsConnection({
      status: 'configured',
      generation: 1,
      reportOperationFailure: vi.fn(),
      target: {
        kind: 'langsmith',
        apiUrl: 'https://private.test',
        apiKey: 'secret',
      },
    })
  ).toThrow('Runtime configuration failed.');
  expect(native).not.toHaveBeenCalled();
});
it('allocates only on valid explicit Send and passes only threadId and URL', async () => {
  const dispose = vi.fn(async () => undefined);
  native.mockReturnValue({
    getSnapshot: () => ({
      status: 'idle',
      transcript: [],
      state: {},
      subagents: [],
    }),
    subscribe: () => () => undefined,
    submit: vi.fn(async () => 'success'),
    resume: vi.fn(),
    stop: vi.fn(),
    dispose,
  });
  const app = createConnectedApplication({
    url: 'https://developer.test/agent',
    label: 'Developer runtime',
  });
  await app.newConversation();
  await app.submit(' ');
  await app.submit('stale', -1);
  expect(native).not.toHaveBeenCalled();
  await app.submit('Book a fictional meeting');
  expect(native).toHaveBeenCalledTimes(1);
  expect(native).toHaveBeenCalledWith({
    threadId: app.getSnapshot().threadId,
    url: 'https://developer.test/agent',
  });
  expect(app.getSnapshot().threadId).toMatch(/^[0-9a-f-]{36}$/);
  expect(app.getSnapshot().status).toBe('unconfirmed');
  await app.submit('No implicit retry');
  expect(native).toHaveBeenCalledTimes(1);
  await app.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
});
