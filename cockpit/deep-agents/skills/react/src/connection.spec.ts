import { it, expect, vi, beforeEach } from 'vitest';
const construct = vi.fn();
const create = vi.fn(),
  getState = vi.fn(),
  getHistory = vi.fn();
vi.mock('@langchain/langgraph-sdk', () => ({
  Client: class {
    threads = { create, getState, getHistory };
    constructor(options: unknown) {
      construct(options);
    }
  },
}));
vi.mock('@threadplane/langgraph', () => ({ createSession: vi.fn() }));
import { createSession } from '@threadplane/langgraph';
import { createSkillsClient } from './connection';
beforeEach(() => {
  vi.clearAllMocks();
});
it('reads only threads it explicitly created and owns immutable credentials', async () => {
  const headers = { 'x-api-key': 'original' };
  const c = createSkillsClient({ apiUrl: 'https://example.test', headers });
  headers['x-api-key'] = 'changed';
  expect(construct.mock.calls[0][0]).toMatchObject({
    apiUrl: 'https://example.test',
    defaultHeaders: { 'x-api-key': 'original' },
    callerOptions: { maxRetries: 0 },
  });
  const signal = new AbortController().signal;
  await expect(c.readCurrent('foreign', signal)).rejects.toThrow();
  expect(getState).not.toHaveBeenCalled();
  create.mockImplementation(async ({ threadId }) => ({ thread_id: threadId }));
  const id = await c.createThread(signal);
  vi.mocked(createSession).mockReturnValue({
    getSnapshot: () => ({
      messages: [],
      toolCalls: [],
      interrupts: [],
      subgraphs: [],
    }),
    subscribe: vi.fn(),
    submit: vi.fn(),
    load: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  } as never);
  c.sessionFactory(id);
  expect(createSession).toHaveBeenCalledWith({
    assistantId: 'da-skills',
    threadId: id,
    apiUrl: 'https://example.test',
    clientOptions: {
      maxRetries: 0,
      defaultHeaders: { 'x-api-key': 'original' },
    },
  });
  getHistory.mockResolvedValue([]);
  await c.readHistory(id, signal);
  expect(getHistory).toHaveBeenCalledWith(id, { limit: 1, signal });
  await expect(
    c.readCheckpoint(
      { thread_id: id, checkpoint_ns: 'child' as '', checkpoint_id: 'bad' },
      signal
    )
  ).rejects.toThrow();
  expect(getState).not.toHaveBeenCalled();
});
it('captures checkpoint getters without evaluating them', async () => {
  let reads = 0;
  const c = createSkillsClient({
    apiUrl: 'https://example.test',
    headers: {},
  });
  const signal = new AbortController().signal;
  const bad = Object.defineProperty({}, 'thread_id', {
    get() {
      reads++;
      return 'bad';
    },
    enumerable: true,
  });
  await expect(c.readCheckpoint(bad as never, signal)).rejects.toThrow();
  expect(reads).toBe(0);
});

it('aborted pending owned read cannot return authority', async () => {
  const c = createSkillsClient({
    apiUrl: 'https://example.test',
    headers: {},
  });
  const controller = new AbortController();
  create.mockImplementation(async ({ threadId }) => ({ thread_id: threadId }));
  const id = await c.createThread(controller.signal);
  let finish: ((value: unknown) => void) | undefined;
  getState.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = c.readCurrent(id, controller.signal);
  controller.abort();
  finish?.({ checkpoint: { thread_id: id } });
  await expect(pending).rejects.toThrow('Conversation unavailable');
});
