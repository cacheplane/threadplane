import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { a2uiConnection, createConnectedApplication } from './connection';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@threadplane/ag-ui', () => ({ createSession: mocks.create }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('window', { location: { origin: 'https://cockpit.test' } });
});
afterEach(() => vi.unstubAllGlobals());
const configured = (endpoint: string) => ({
  status: 'configured' as const,
  generation: 1,
  reportOperationFailure: vi.fn(),
  target: { kind: 'ag-ui' as const, endpoint },
});
it('resolves the exact same-origin AG-UI A2UI route and established bridge labels', () => {
  expect(a2uiConnection({ status: 'default' })).toEqual({
    url: 'https://cockpit.test/ag-ui/a2ui/agent',
    label: 'Shared runtime',
  });
  expect(
    a2uiConnection({
      status: 'configured',
      generation: 1,
      reportOperationFailure: vi.fn(),
      target: { kind: 'shared' },
    })
  ).toEqual({
    url: 'https://cockpit.test/ag-ui/a2ui/agent',
    label: 'Shared runtime',
  });
  expect(a2uiConnection(configured('https://developer.test/agent'))).toEqual({
    url: 'https://developer.test/agent',
    label: 'Developer runtime',
  });
  expect(Object.isFrozen(a2uiConnection({ status: 'default' }))).toBe(true);
});
it.each([
  'javascript:alert(1)',
  'file:///private/tmp/agent',
  'https://user:password@developer.test/agent',
  'https://user@developer.test/agent',
  '/relative-agent',
  'not a URL',
])('rejects incompatible endpoint %s', (endpoint) => {
  expect(() => a2uiConnection(configured(endpoint))).toThrow(
    'Runtime configuration failed.'
  );
});
it('rejects error and LangSmith bridge targets', () => {
  expect(() =>
    a2uiConnection({ status: 'error', code: 'incompatible_bridge' })
  ).toThrow('Runtime configuration failed.');
  expect(() =>
    a2uiConnection({
      status: 'configured',
      generation: 1,
      reportOperationFailure: vi.fn(),
      target: {
        kind: 'langsmith',
        apiUrl: 'https://private.test',
        apiKey: 'private-key',
      },
    })
  ).toThrow('Runtime configuration failed.');
});
it('lazily constructs real native Session with exactly one {threadId,url} argument', async () => {
  const state = { status: 'idle', transcript: [], state: {}, subagents: [] };
  const submit = vi.fn(async () => 'interrupted');
  mocks.create.mockReturnValue({
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    submit,
    resume: vi.fn(),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  });
  const app = createConnectedApplication({
    url: 'https://developer.test/agent',
    label: 'Developer runtime',
  });
  expect(mocks.create).not.toHaveBeenCalled();
  await app.submit('  flight please  ');
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0]).toEqual([
    {
      threadId: app.getSnapshot().threadId,
      url: 'https://developer.test/agent',
    },
  ]);
  expect(submit).toHaveBeenCalledWith('  flight please  ', {
    signal: expect.any(AbortSignal),
  });
  await app.dispose();
});
it('revalidates directly supplied connection data before any native work', () => {
  expect(() =>
    createConnectedApplication({
      url: 'https://user:password@developer.test/agent',
      label: 'Developer runtime',
    })
  ).toThrow('Runtime configuration failed.');
  expect(mocks.create).not.toHaveBeenCalled();
});
