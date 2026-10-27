// @vitest-environment jsdom
// eslint-disable-next-line @nx/enforce-module-boundaries -- Test validates the internal bridge contract.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
import { afterEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  getState: vi.fn(),
  native: vi.fn(),
  constructor: vi.fn(),
}));
vi.mock('@langchain/langgraph-sdk', () => ({
  Client: class {
    threads = { create: sdk.create, getState: sdk.getState };
    constructor(options: unknown) {
      sdk.constructor(options);
    }
  },
}));
vi.mock('@threadplane/langgraph', () => ({ createSession: sdk.native }));
import { filesystemConnection, createFilesystemClient } from './connection';
afterEach(() => vi.resetAllMocks());
it('resolves shared proxy and developer target, rejecting incompatible configuration', () => {
  expect(
    filesystemConnection({
      status: 'unconfigured',
    } as unknown as RuntimeBridgeConfiguration).apiUrl
  ).toMatch(/\/api$/);
  expect(
    filesystemConnection({
      status: 'configured',
      target: {
        kind: 'langsmith',
        apiUrl: 'https://authored.invalid',
        apiKey: 'secret',
      },
    } as unknown as RuntimeBridgeConfiguration)
  ).toEqual({
    apiUrl: 'https://authored.invalid',
    headers: { 'x-api-key': 'secret' },
  });
  expect(() =>
    filesystemConnection({
      status: 'error',
    } as unknown as RuntimeBridgeConfiguration)
  ).toThrow('Runtime');
  expect(() =>
    filesystemConnection({
      status: 'configured',
      target: { kind: 'ag-ui' },
    } as unknown as RuntimeBridgeConfiguration)
  ).toThrow('Runtime');
});
it('client construction makes no request; confirmed creation owns native sessions and state reads', async () => {
  const headers = { 'x-api-key': 'secret' },
    client = createFilesystemClient({
      apiUrl: 'https://authored.invalid',
      headers,
    });
  headers['x-api-key'] = 'changed';
  expect(sdk.create).not.toHaveBeenCalled();
  expect(sdk.getState).not.toHaveBeenCalled();
  expect(() => client.sessionFactory('unknown')).toThrow();
  sdk.create.mockImplementation(async ({ threadId }: { threadId: string }) => ({
    thread_id: threadId,
  }));
  const controller = new AbortController();
  const id = await client.createThread(controller.signal);
  sdk.native.mockReturnValue({
    getSnapshot: () => ({
      messages: [],
      toolCalls: [],
      interrupts: [],
      subgraphs: [],
    }),
    subscribe: () => () => undefined,
    submit: async () => 'success',
    resume: async () => 'success',
    load: async () => undefined,
    stop: async () => undefined,
    dispose: async () => undefined,
  });
  client.sessionFactory(id);
  expect(sdk.native.mock.calls[0][0]).toMatchObject({
    assistantId: 'da-filesystem',
    threadId: id,
    clientOptions: { maxRetries: 0, defaultHeaders: { 'x-api-key': 'secret' } },
  });
  sdk.getState.mockResolvedValue({});
  await client.readCurrent(id, controller.signal);
  expect(sdk.getState.mock.calls[0][1]).toBeUndefined();
  await client.readCheckpoint(
    { thread_id: id, checkpoint_ns: '', checkpoint_id: 'cp' },
    controller.signal
  );
  expect(sdk.getState.mock.calls[1][1]).toMatchObject({ checkpoint_id: 'cp' });
});
it('failed/mismatched/aborted creation never installs ownership and can retry', async () => {
  const client = createFilesystemClient({
      apiUrl: 'https://authored.invalid',
      headers: {},
    }),
    signal = new AbortController().signal;
  sdk.create.mockResolvedValue({ thread_id: 'wrong' });
  await expect(client.createThread(signal)).rejects.toThrow('not confirmed');
  expect(() => client.sessionFactory('wrong')).toThrow();
  sdk.create.mockImplementation(async ({ threadId }: { threadId: string }) => ({
    thread_id: threadId,
  }));
  expect(await client.createThread(signal)).toBeTruthy();
  const abort = new AbortController();
  abort.abort();
  const count = sdk.create.mock.calls.length;
  await expect(client.createThread(abort.signal)).rejects.toThrow();
  expect(sdk.create).toHaveBeenCalledTimes(count);
});
it('unknown, malformed, or aborted checkpoint reads remain inert', async () => {
  const client = createFilesystemClient({
      apiUrl: 'https://authored.invalid',
      headers: {},
    }),
    signal = new AbortController().signal;
  await expect(client.readCurrent('unknown', signal)).rejects.toThrow();
  await expect(
    client.readCheckpoint(
      { thread_id: 'unknown', checkpoint_ns: '', checkpoint_id: 'cp' },
      signal
    )
  ).rejects.toThrow();
  expect(sdk.getState).not.toHaveBeenCalled();
});
it('foreign preloaded or incompatible native sessions are disposed before installation', async () => {
  const client = createFilesystemClient({
    apiUrl: 'https://authored.invalid',
    headers: {},
  });
  sdk.create.mockImplementation(async ({ threadId }: { threadId: string }) => ({
    thread_id: threadId,
  }));
  const id = await client.createThread(new AbortController().signal);
  for (const foreign of [true, false]) {
    const dispose = vi.fn(async () => undefined);
    sdk.native.mockReturnValue({
      getSnapshot: () => ({
        status: 'idle',
        messages: [],
        toolCalls: [],
        interrupts: [],
        subgraphs: [],
        history: foreign
          ? [
              {
                checkpoint: {
                  thread_id: 'foreign',
                  checkpoint_ns: '',
                  checkpoint_id: 'old',
                },
              },
            ]
          : [],
      }),
      subscribe: () => () => undefined,
      submit: async () => 'success',
      ...(foreign ? { resume: async () => 'success' } : {}),
      load: async () => undefined,
      stop: async () => undefined,
      dispose,
    });
    expect(() => client.sessionFactory(id)).toThrow('unavailable');
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledOnce();
  }
});
