import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { createSession, selectBranch } from './create-session';
import {
  projectBranchTree,
  projectCheckpoints,
  projectMessageCheckpoints,
} from './checkpoint-tree';
import type { AgentTransport } from './transport.types';

const sessions: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

const saved = (
  id: string,
  parent: string | null,
  messages: unknown[],
  next: string[] = []
): ThreadState =>
  ({
    values: { topic: id, messages },
    next,
    tasks: [],
    metadata: {},
    created_at: null,
    checkpoint: { thread_id: 'thread', checkpoint_ns: '', checkpoint_id: id },
    parent_checkpoint: parent
      ? { thread_id: 'thread', checkpoint_ns: '', checkpoint_id: parent }
      : null,
  } as unknown as ThreadState);

const user = { type: 'human', id: 'u1', content: 'Hi' };
const first = { type: 'ai', id: 'a1', content: 'Hello' };
const second = { type: 'ai', id: 'a2', content: 'Hello again' };
/** Newest first: c1 -> c2 -> c3, and c2 -> c4 as a later alternative. */
const page = () => [
  saved('c4', 'c2', [user, second]),
  saved('c3', 'c2', [user, first]),
  saved('c2', 'c1', [user], ['agent']),
  saved('c1', null, [], ['__start__']),
];

function fixture(historyState: boolean, history = page()) {
  const getHistory = vi.fn<NonNullable<AgentTransport['getHistory']>>(
    async () => history
  );
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    historyState,
    transport: {
      async *stream() {
        yield {
          type: 'values',
          data: { messages: [{ type: 'ai', id: 'a9', content: 'Done' }] },
        };
      },
      getHistory,
    },
  });
  sessions.push(session);
  return { session, getHistory };
}

describe('history with state', () => {
  it('publishes each checkpoint with its state, label and saved record', async () => {
    const { session } = fixture(true);
    await session.load?.();
    const { checkpoints, messageCheckpoints, history } = session.getSnapshot();
    // Oldest first, as the core contract lists a history.
    expect(checkpoints?.map(({ id, label }) => [id, label])).toEqual([
      ['c1', '__start__'],
      ['c2', 'agent'],
      ['c3', undefined],
      ['c4', undefined],
    ]);
    expect(checkpoints?.[3].values).toEqual({
      topic: 'c4',
      messages: [user, second],
    });
    expect(checkpoints?.[3].saved.parent_checkpoint?.checkpoint_id).toBe('c2');
    expect(Object.isFrozen(checkpoints?.[3].values['messages'])).toBe(true);
    expect(messageCheckpoints).toEqual({ a1: 'c3', a2: 'c4' });
    expect(history).toHaveLength(4);
  });

  it('keeps only metadata without the option', async () => {
    const { session, getHistory } = fixture(false);
    await session.load?.();
    const snapshot = session.getSnapshot();
    expect(snapshot.history).toHaveLength(4);
    expect('checkpoints' in snapshot).toBe(false);
    expect('messageCheckpoints' in snapshot).toBe(false);
    expect('branchTree' in snapshot).toBe(false);
    await session.submit('Go');
    await Promise.resolve();
    expect(getHistory).toHaveBeenCalledTimes(1);
  });

  it('arranges the page as a tree that forks where a checkpoint has two children', async () => {
    const { session } = fixture(true);
    await session.load?.();
    const tree = session.getSnapshot().branchTree;
    expect(tree?.items.map((item) => item.type)).toEqual([
      'node',
      'node',
      'fork',
    ]);
    const fork = tree?.items[2];
    if (fork?.type !== 'fork') throw new Error('Expected a fork.');
    expect(
      fork.items.map((sequence) =>
        sequence.items.map((item) =>
          item.type === 'node' ? [item.value.id, item.path] : item.type
        )
      )
    ).toEqual([[['c3', ['c3']]], [['c4', ['c4']]]]);
    // A node is the published checkpoint, not a copy of it.
    const node = tree?.items[0];
    expect(node?.type === 'node' && node.value).toBe(
      session.getSnapshot().checkpoints?.[0]
    );
  });

  it('selects the checkpoints of a branch, oldest first', () => {
    const tree = projectBranchTree(projectCheckpoints(undefined, page()));
    const ids = (branch?: string) =>
      selectBranch(tree, branch).map((checkpoint) => checkpoint.id);
    // Unnamed, and at a fork the branch does not name, the newest
    // continuation is followed: c4 was saved after c3.
    expect(ids()).toEqual(['c1', 'c2', 'c4']);
    expect(ids('c4')).toEqual(['c1', 'c2', 'c4']);
    expect(ids('c3')).toEqual(['c1', 'c2', 'c3']);
    expect(ids('missing')).toEqual(['c1', 'c2', 'c4']);
    expect(
      selectBranch(projectBranchTree(projectCheckpoints(undefined, [])))
    ).toEqual([]);
  });

  it('roots a page that starts mid-thread at its newest lineage', () => {
    const tree = projectBranchTree(
      projectCheckpoints(undefined, [
        saved('c3', 'c2', [user, first]),
        saved('c2', 'c1', [user]),
      ])
    );
    expect(
      tree.items.map((item) => item.type === 'node' && item.value.id)
    ).toEqual(['c2', 'c3']);
  });

  it('skips checkpoints without an id when pairing messages', () => {
    const checkpoints = projectCheckpoints(undefined, [
      { ...saved('x', null, [user, first]), checkpoint: undefined } as never,
    ]);
    expect(checkpoints[0].id).toBeUndefined();
    expect(projectMessageCheckpoints(checkpoints)).toEqual({});
  });

  it('keeps references when the same page is read again', async () => {
    const { session } = fixture(true);
    await session.load?.();
    const before = session.getSnapshot();
    await session.load?.();
    const after = session.getSnapshot();
    expect(after.checkpoints).toBe(before.checkpoints);
    expect(after.branchTree).toBe(before.branchTree);
    expect(after.messageCheckpoints).toBe(before.messageCheckpoints);
  });

  it('reads the page again after a run, without touching the transcript', async () => {
    const history = page();
    const { session, getHistory } = fixture(true, history);
    await session.load?.();
    history.unshift(
      saved('c5', 'c4', [user, second, { type: 'ai', id: 'a9' }])
    );
    expect(await session.submit('Go')).toBe('success');
    const transcript = session.getSnapshot().messages;
    await vi.waitFor(() =>
      expect(session.getSnapshot().checkpoints?.at(-1)?.id).toBe('c5')
    );
    expect(getHistory).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().messages).toBe(transcript);
    expect(session.getSnapshot().status).toBe('idle');
    expect(session.getSnapshot().messageCheckpoints?.['a9']).toBe('c5');
  });

  it('drops a page read that a newer command overtakes', async () => {
    const history = page();
    let release!: (value: ThreadState[]) => void;
    const getHistory = vi
      .fn<NonNullable<AgentTransport['getHistory']>>()
      .mockResolvedValueOnce(history)
      .mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve))
      )
      .mockResolvedValue(history);
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      historyState: true,
      transport: {
        async *stream() {
          yield {
            type: 'values',
            data: { messages: [{ type: 'ai', id: 'a9' }] },
          };
        },
        getHistory,
      },
    });
    sessions.push(session);
    await session.load?.();
    await session.submit('One');
    await vi.waitFor(() => expect(getHistory).toHaveBeenCalledTimes(2));
    await session.stop();
    release([saved('stale', null, [])]);
    await Promise.resolve();
    await Promise.resolve();
    expect(session.getSnapshot().checkpoints?.at(-1)?.id).toBe('c4');
  });
});

describe('branch selection', () => {
  it('publishes the selected branch and removes the default one', async () => {
    const { session } = fixture(false);
    const notify = vi.fn();
    session.subscribe(notify);
    expect('branch' in session.getSnapshot()).toBe(false);
    await session.setBranch('c4');
    expect(session.getSnapshot().branch).toBe('c4');
    await session.setBranch('c4');
    expect(notify).toHaveBeenCalledTimes(1);
    await session.setBranch('');
    expect('branch' in session.getSnapshot()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('keeps the published status and error, and rejects a non-string', async () => {
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: {
        // eslint-disable-next-line require-yield
        async *stream() {
          throw Object.assign(new Error('Denied'), { status: 403 });
        },
      },
    });
    sessions.push(session);
    expect(await session.submit('Go')).toBe('error');
    const { error } = session.getSnapshot();
    await session.setBranch('c4');
    expect(session.getSnapshot().status).toBe('error');
    expect(session.getSnapshot().error).toBe(error);
    await expect(session.setBranch(1 as never)).rejects.toBeInstanceOf(
      TypeError
    );
    await session.dispose();
    await session.setBranch('after');
    expect(session.getSnapshot().branch).toBe('c4');
  });
});
