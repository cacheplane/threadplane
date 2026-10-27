import { expect, it, vi } from 'vitest';
import { staticDelivery, type Message } from '@threadplane/core';
import {
  createFilesystemApplication,
  type FilesystemSession,
} from './application';
import type { FilesystemSnapshot } from './authority';
// Synthetic boundary tests; actual native graph proof lives in connection.integration.spec.
function harness(files: unknown = {}) {
  let state: FilesystemSnapshot = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
  };
  let raw: unknown;
  let count = 0;
  const listeners = new Set<() => void>();
  const emit = (next: FilesystemSnapshot) => {
    state = next;
    for (const callback of listeners) callback();
  };
  const session = {
    getSnapshot: () => state,
    subscribe: (callback: () => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    submit: vi.fn(async (text: string) => {
      const messages = [
        { id: 'human' + ++count, type: 'human', content: text },
        {
          id: 'answer' + count,
          type: 'ai',
          content: 'Actual answer',
          tool_calls: [],
        },
      ];
      const checkpoint = {
        thread_id: 'owned',
        checkpoint_ns: '',
        checkpoint_id: 'cp' + count,
      };
      raw = { checkpoint, values: { messages, files }, next: [], tasks: [] };
      emit({
        status: 'idle',
        messages: messages.map((m) => ({
          id: m.id,
          role: m.type === 'human' ? 'user' : 'assistant',
          content: m.content,
          delivery: staticDelivery(m.id),
          ...(m.type === 'ai' ? { toolCallIds: [] } : {}),
        })) as Message[],
        toolCalls: [],
        interrupts: [],
        subgraphs: [],
        values: { files },
        history: [{ checkpoint, next: [] }],
      });
      return 'success' as const;
    }),
    resume: vi.fn(async () => 'success' as const),
    load: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  } as unknown as FilesystemSession;
  const client = {
    createThread: vi.fn(async () => 'owned'),
    sessionFactory: vi.fn(() => session),
    readCurrent: vi.fn(async () => raw),
    readCheckpoint: vi.fn(async () => raw),
  };
  return { app: createFilesystemApplication(client), client, session, emit };
}
it('initial mount and New remain inert without creation, load or submission', async () => {
  const h = harness();
  await h.app.newConversation();
  expect(h.client.createThread).not.toHaveBeenCalled();
  expect(h.session.load).not.toHaveBeenCalled();
  expect(h.session.submit).not.toHaveBeenCalled();
  expect(h.app.getSnapshot().phase).toBe('idle');
  await h.app.dispose();
});
it('valid empty is confirmed while malformed files stay unconfirmed and require New', async () => {
  for (const files of [{}, null]) {
    const h = harness(files);
    expect(await h.app.submit('Files')).toBe(files !== null);
    expect(h.app.getSnapshot().phase).toBe(
      files === null ? 'unconfirmed' : 'saved'
    );
    expect(h.app.getSnapshot().canSubmit).toBe(files !== null);
    await h.app.dispose();
  }
});
it('legacy text and unavailable encodings remain literal checkpoint-backed projections', async () => {
  const h = harness({
    '/legacy': { content: ['<h1>literal</h1>', 'second'] },
    '/binary': { content: 'bytes', encoding: 'base64' },
  });
  expect(await h.app.submit('Files')).toBe(true);
  expect(h.app.getSnapshot().savedWorkspace.files).toEqual([
    { path: '/binary', kind: 'unavailable', reason: 'Unsupported encoding' },
    { path: '/legacy', kind: 'text', content: '<h1>literal</h1>\nsecond' },
  ]);
  await h.app.dispose();
});
it('new during lazy creation prevents installing a late returned owner', async () => {
  const h = harness();
  let release!: (id: string) => void;
  h.client.createThread.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const pending = h.app.submit('Files');
  await h.app.newConversation();
  const fresh = h.app.getSnapshot();
  release('owned');
  expect(await pending).toBe(false);
  expect(h.app.getSnapshot()).toBe(fresh);
  expect(h.client.sessionFactory).not.toHaveBeenCalled();
  await h.app.dispose();
});
it('live files do not claim Saved while exact confirmation is held', async () => {
  const h = harness({ '/actual': { content: 'actual' } });
  let release!: (value: unknown) => void;
  const actual = h.client.readCheckpoint.getMockImplementation();
  h.client.readCheckpoint.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const pending = h.app.submit('Files');
  await vi.waitFor(() => expect(h.app.getSnapshot().phase).toBe('confirming'));
  expect(h.app.getSnapshot().observedWorkspace.files).toHaveLength(1);
  expect(h.app.getSnapshot().savedWorkspace.files).toHaveLength(0);
  release(await actual!());
  expect(await pending).toBe(true);
  await h.app.dispose();
});
it('disposal prevents late native subscriber publications', async () => {
  const h = harness();
  await h.app.submit('Files');
  await h.app.dispose();
  const saved = h.app.getSnapshot();
  h.emit({
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
    values: { files: { '/late': { content: 'late' } } },
  });
  expect(h.app.getSnapshot()).toBe(saved);
});
