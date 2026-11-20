import { runAgentSessionConformance } from '@threadplane/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selectBranch } from '../src/runtime/create-session';
import {
  liveSession,
  recordSnapshots,
  settled,
  startLiveBackend,
  type LiveBackend,
} from './backend';

/**
 * History with state, branches, per-run settings, queueing, joining a run,
 * automatic loading, structured content and failures, against the time-travel
 * graph: one model node that answers and is checkpointed.
 */
let backend: LiveBackend;
const sessions: { dispose(): Promise<void> }[] = [];
const track = <S extends { dispose(): Promise<void> }>(session: S): S => {
  sessions.push(session);
  return session;
};

beforeAll(async () => {
  backend = await startLiveBackend({
    python: 'cockpit/langgraph/time-travel/python',
    graph: 'time-travel',
    fixtures: [
      'libs/langgraph/live/fixtures/time-travel-live.json',
      'cockpit/langgraph/time-travel/angular/e2e/fixtures/time-travel.json',
    ],
  });
});
afterAll(async () => {
  await Promise.allSettled(sessions.map((session) => session.dispose()));
  await backend?.stop();
});

// The replies the recorded fixtures give.
const HI =
  'Hi! How can I help you today?\n\nQuick note: every response here is saved as a checkpoint snapshot. If you want to explore a different path later, you can inspect the conversation history and branch from any previous checkpoint using stream.setBranch(checkpointId) to create an alternate timeline.';
// The core contract's checks, on a session whose backend is the real server.
runAgentSessionConformance(
  'LangGraph session on a live backend',
  () => liveSession(backend, { historyState: true }),
  { describe, it }
);

const ORIGINAL = 'This reply belongs only to the original path.';
const FORKED = 'This reply belongs to the checkpoint fork.';
const texts = (messages: readonly { role: string; content: string }[]) =>
  messages.map((message) => [message.role, message.content]);
const messagesOf = (values: Readonly<Record<string, unknown>>) =>
  (values['messages'] as { type: string; id: string; content: string }[]) ?? [];

describe('history with state and branches', () => {
  it('publishes checkpoints with their state, relates messages to them, runs from a checkpoint and selects a branch', async () => {
    const createdThreads: string[] = [];
    const session = track(
      liveSession(backend, {
        historyState: true,
        onThreadId: (id) => createdThreads.push(id),
      })
    );
    expect(session.threadId).toBeUndefined();
    expect(session.getSnapshot().checkpoints).toBeUndefined();

    expect(await session.submit('Hello')).toBe('success');
    expect(createdThreads).toEqual([session.threadId]);
    // The page is read again after the run; the transcript stays the stream's.
    const first = await settled(
      session,
      (snapshot) => (snapshot.checkpoints?.length ?? 0) >= 2
    );
    const hello = first.messages[1];
    expect(texts(first.messages)).toEqual([
      ['user', 'Hello'],
      ['assistant', HI],
    ]);

    // Oldest first, each with the state it saved, as the core contract lists them.
    const checkpoints = first.checkpoints ?? [];
    expect(Object.isFrozen(checkpoints)).toBe(true);
    const sizes = checkpoints.map(
      (checkpoint) => messagesOf(checkpoint.values).length
    );
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(sizes.at(-1)).toBe(2);
    const completed = checkpoints.at(-1);
    expect(typeof completed?.id).toBe('string');
    expect(completed?.label).toBeUndefined();
    expect(messagesOf(completed?.values ?? {}).at(-1)?.id).toBe(hello.id);
    // The graph's own state is in the checkpoint, not only its messages.
    expect(completed?.values['completed_answer_id']).toBe(hello.id);
    expect(completed?.saved.checkpoint.checkpoint_id).toBe(completed?.id);
    expect(first.history).toHaveLength(checkpoints.length);

    // Each assistant message names a listed checkpoint that ends with it.
    expect(first.messageCheckpoints).toEqual({ [hello.id]: completed?.id });

    expect(await session.submit('Continue the original path.')).toBe('success');
    const second = await settled(session, (snapshot) =>
      (snapshot.checkpoints ?? []).some(
        (checkpoint) => messagesOf(checkpoint.values).length === 4
      )
    );
    expect(second.messages.at(-1)?.content).toBe(ORIGINAL);
    const original = second.messages.at(-1);
    for (const [messageId, checkpointId] of Object.entries(
      second.messageCheckpoints ?? {}
    )) {
      const checkpoint = second.checkpoints?.find(
        (entry) => entry.id === checkpointId
      );
      const assistants = messagesOf(checkpoint?.values ?? {}).filter(
        (message) => message.type === 'ai'
      );
      expect(assistants.at(-1)?.id).toBe(messageId);
    }
    expect(Object.keys(second.messageCheckpoints ?? {}).sort()).toEqual(
      [hello.id, original?.id].sort()
    );
    // One line of history so far: no fork.
    expect(second.branchTree?.items.every((item) => item.type === 'node')).toBe(
      true
    );

    // Run from the checkpoint the first turn completed at. The session holds
    // that checkpoint's state, so the transcript goes back to it first.
    const from = second.checkpoints?.find(
      (checkpoint) =>
        messagesOf(checkpoint.values).length === 2 &&
        checkpoint.label === undefined
    );
    expect(from?.id).toBe(completed?.id);
    const recorded = recordSnapshots(session);
    expect(
      await session.submit('Try a different approach from here.', {
        run: { checkpointId: from?.id },
      })
    ).toBe('success');
    recorded.release();
    expect(texts(session.getSnapshot().messages)).toEqual([
      ['user', 'Hello'],
      ['assistant', HI],
      ['user', 'Try a different approach from here.'],
      ['assistant', FORKED],
    ]);
    // The original path's answer never showed beside the fork's prompt.
    expect(
      recorded.snapshots
        .slice(1)
        .some((snapshot) =>
          snapshot.messages.some((message) => message.content === ORIGINAL)
        )
    ).toBe(false);

    // The thread now forks at that checkpoint.
    const forked = await settled(session, (snapshot) =>
      (snapshot.branchTree?.items ?? []).some((item) => item.type === 'fork')
    );
    const tree = forked.branchTree;
    const fork = tree?.items.find((item) => item.type === 'fork');
    if (!tree || fork?.type !== 'fork') throw new Error('Expected a fork.');
    expect(fork.items).toHaveLength(2);
    const branches = fork.items.map((sequence) => {
      const node = sequence.items[0];
      if (node.type !== 'node') throw new Error('Expected a node.');
      return node.path.join('>');
    });
    const endings = branches.map(
      (branch) =>
        messagesOf(selectBranch(tree, branch).at(-1)?.values ?? {}).at(-1)
          ?.content
    );
    expect([...endings].sort()).toEqual([FORKED, ORIGINAL].sort());
    // Unnamed, the newest continuation is followed.
    expect(
      messagesOf(selectBranch(tree).at(-1)?.values ?? {}).at(-1)?.content
    ).toBe(FORKED);
    // Every branch starts from the same first checkpoints, oldest first.
    expect(selectBranch(tree, branches[0])[0]).toBe(forked.checkpoints?.[0]);

    // Selecting a branch is a view choice: published, and nothing is requested.
    const originalBranch = branches[endings.indexOf(ORIGINAL)];
    const transcript = session.getSnapshot().messages;
    await session.setBranch(originalBranch);
    expect(session.getSnapshot().branch).toBe(originalBranch);
    expect(session.getSnapshot().messages).toBe(transcript);
    await session.setBranch('');
    expect('branch' in session.getSnapshot()).toBe(false);

    // The server agrees: the thread's newest state is the fork.
    const saved = await backend.saved(session.threadId as string);
    expect(
      messagesOf(saved.values as Record<string, unknown>).at(-1)?.content
    ).toBe(FORKED);
  });

  it('loads automatically when asked, publishing loading while the read is in flight', async () => {
    const author = track(liveSession(backend));
    expect(await author.submit('Hello')).toBe('success');
    const threadId = author.threadId as string;

    const session = track(
      liveSession(backend, { threadId, autoLoad: true, historyState: true })
    );
    // Construction itself reads nothing.
    expect(session.getSnapshot().messages).toEqual([]);
    const recorded = recordSnapshots(session);
    const loaded = await settled(
      session,
      (snapshot) => snapshot.messages.length === 2 && !snapshot.loading
    );
    recorded.release();
    expect(
      recorded.snapshots.some((snapshot) => snapshot.loading === true)
    ).toBe(true);
    expect('loading' in loaded).toBe(false);
    expect(texts(loaded.messages)[0]).toEqual(['user', 'Hello']);
    expect(loaded.status).toBe('idle');
    expect(loaded.checkpoints?.length).toBeGreaterThanOrEqual(2);
    // Restored messages are settled deliveries, not a stream.
    expect(
      loaded.messages.every((message) => message.delivery.phase === 'complete')
    ).toBe(true);

    // Without the option, a session with a thread id reads nothing by itself.
    const inert = track(liveSession(backend, { threadId }));
    await new Promise((done) => setTimeout(done, 300));
    expect(inert.getSnapshot().messages).toEqual([]);
    expect('loading' in inert.getSnapshot()).toBe(false);
  });
});

describe('run settings', () => {
  it('passes metadata, config and run settings to the run it creates, and continues a breakpoint without a message', async () => {
    const session = track(liveSession(backend));
    const created: { run_id: string; thread_id?: string }[] = [];
    // A static breakpoint before the only node: the run saves the input and stops.
    const outcome = await session.submit('Wait for me before answering.', {
      metadata: { source: 'live-suite' },
      config: { tags: ['live'], configurable: { reviewer: 'Ada' } },
      run: {
        interruptBefore: ['generate'],
        onRunCreated: (run) => created.push(run),
      },
    });
    expect(created).toHaveLength(1);
    expect(created[0].thread_id).toBe(session.threadId);
    const run = await backend.client.runs.get(
      session.threadId as string,
      created[0].run_id
    );
    expect(run.metadata).toMatchObject({ source: 'live-suite' });
    const kwargs = (run as unknown as { kwargs?: Record<string, unknown> })
      .kwargs;
    expect(kwargs?.['interrupt_before']).toEqual(['generate']);
    expect(
      (kwargs?.['config'] as { tags?: string[] } | undefined)?.tags
    ).toContain('live');

    // The graph stopped before answering.
    const paused = session.getSnapshot();
    expect(outcome).toBe('paused');
    expect(texts(paused.messages)).toEqual([
      ['user', 'Wait for me before answering.'],
    ]);
    expect(paused.interrupts.map((interrupt) => interrupt.id)).toEqual([
      'breakpoint',
    ]);
    const saved = await backend.saved(session.threadId as string);
    expect(saved.next).toEqual(['generate']);

    // The core command for a run without a message continues from there.
    expect(await session.runWithoutMessage()).toBe('success');
    expect(texts(session.getSnapshot().messages)).toEqual([
      ['user', 'Wait for me before answering.'],
      ['assistant', 'Answered after the breakpoint.'],
    ]);
    expect(session.getSnapshot().interrupts).toEqual([]);
  });

  it('merges a state given to a run without a message', async () => {
    const session = track(liveSession(backend));
    expect(await session.submit('Hello')).toBe('success');
    const before = session.getSnapshot().messages;
    // The state is the run's input: the graph runs again on the conversation
    // as it stands, with the key merged, and no user message is added.
    expect(
      await session.runWithoutMessage({
        state: { completed_turn_id: 'set-by-the-caller' },
      })
    ).toBe('success');
    const after = session.getSnapshot();
    expect(
      after.messages.filter((message) => message.role === 'user')
    ).toHaveLength(1);
    expect(after.messages.length).toBe(before.length + 1);
    const saved = await backend.saved(session.threadId as string);
    const values = saved.values as Record<string, unknown>;
    expect(
      messagesOf(values).filter((message) => message.type === 'human')
    ).toHaveLength(1);
  });
});

describe('queued runs', () => {
  const SLOW = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.';

  it('queues a run behind the active one, lists it, and joins it when the first ends', async () => {
    const threadId = await backend.thread();
    const session = track(liveSession(backend, { threadId }));
    const recorded = recordSnapshots(session);
    const created: string[] = [];
    // The first answer streams slowly, so the run is still going when the
    // second submission arrives.
    const first = session.submit('Take your time answering.');
    const second = session.submit('Queue this behind the first run.', {
      run: {
        multitaskStrategy: 'enqueue',
        onRunCreated: (run) => created.push(run.run_id),
      },
    });
    const waiting = await settled(
      session,
      (snapshot) => (snapshot.queue?.length ?? 0) === 1
    );
    // Queued, not replacing: the first run is still the one streaming.
    expect(waiting.status).toBe('running');
    expect(waiting.queue?.[0]).toMatchObject({
      id: created[0],
      message: 'Queue this behind the first run.',
    });
    expect(typeof waiting.queue?.[0].createdAt).toBe('number');
    expect(
      waiting.messages.some(
        (message) => message.content === 'Queue this behind the first run.'
      )
    ).toBe(false);

    expect(await first).toBe('success');
    expect(await second).toBe('success');
    recorded.release();
    expect('queue' in session.getSnapshot()).toBe(false);

    // The first answer arrived in pieces: the stream was projected live.
    const partial = recorded.snapshots
      .map((snapshot) => snapshot.messages[1]?.content ?? '')
      .filter((content) => content.length > 0 && content.length < SLOW.length);
    expect(partial.length).toBeGreaterThan(1);
    expect(partial.every((content) => SLOW.startsWith(content))).toBe(true);

    // Both turns are in the transcript, in the order they ran.
    expect(texts(session.getSnapshot().messages)).toEqual([
      ['user', 'Take your time answering.'],
      ['assistant', SLOW],
      ['user', 'Queue this behind the first run.'],
      ['assistant', 'This reply came from the queued run.'],
    ]);
    // The backend ran two runs on the thread; the session created both.
    const runs = await backend.client.runs.list(threadId);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.run_id)).toContain(created[0]);
    expect(runs.every((run) => run.status === 'success')).toBe(true);
  });

  it('cancels a queued run on request and resolves its submission aborted', async () => {
    const threadId = await backend.thread();
    const session = track(liveSession(backend, { threadId }));
    const first = session.submit('Take your time answering.');
    const second = session.submit('Queue this behind the first run.', {
      run: { multitaskStrategy: 'enqueue' },
    });
    const waiting = await settled(
      session,
      (snapshot) => (snapshot.queue?.length ?? 0) === 1
    );
    const id = waiting.queue?.[0].id as string;
    expect(await session.cancelQueued(id)).toBe(true);
    expect(await second).toBe('aborted');
    expect('queue' in session.getSnapshot()).toBe(false);
    // The active run is untouched and finishes.
    expect(await first).toBe('success');
    expect(texts(session.getSnapshot().messages)).toEqual([
      ['user', 'Take your time answering.'],
      ['assistant', SLOW],
    ]);
    // The backend no longer runs the cancelled one.
    const runs = await backend.client.runs.list(threadId);
    const cancelled = runs.find((run) => run.run_id === id);
    expect(cancelled?.status ?? 'deleted').not.toBe('success');
    const saved = await backend.saved(threadId);
    expect(messagesOf(saved.values as Record<string, unknown>)).toHaveLength(2);
  });
});

describe('joining a run by id', () => {
  it('projects a run another client started, from its first event', async () => {
    const threadId = await backend.thread();
    const run = await backend.client.runs.create(threadId, backend.graph, {
      input: {
        messages: [
          {
            type: 'human',
            id: 'outside',
            content: 'Start outside the session.',
          },
        ],
      },
      streamResumable: true,
      streamMode: ['values', 'messages-tuple', 'updates', 'custom'],
    });
    const session = track(liveSession(backend, { threadId }));
    expect(session.getSnapshot().messages).toEqual([]);
    expect(await session.joinStream(run.run_id)).toBe('success');
    const snapshot = session.getSnapshot();
    // Joining adds no user message of its own: the transcript is the run's.
    expect(texts(snapshot.messages)).toEqual([
      ['user', 'Start outside the session.'],
      ['assistant', 'This run was started by another client.'],
    ]);
    expect(snapshot.messages[0].id).toBe('outside');
    expect(snapshot.status).toBe('idle');
    // No second run was created to do it.
    expect(await backend.client.runs.list(threadId)).toHaveLength(1);
  });

  it('rejects an id that is not a run id without a request', async () => {
    const session = track(
      liveSession(backend, { threadId: await backend.thread() })
    );
    await expect(session.joinStream('')).rejects.toThrow();
  });
});

describe('structured content', () => {
  // A one-pixel image, inline, so nothing is fetched.
  const url =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('sends submitted blocks and reads them back from the stream and from history', async () => {
    const session = track(liveSession(backend, { rawMessages: true }));
    const blocks = [
      { type: 'text', text: 'Describe this picture.' },
      { type: 'image', url },
    ] as const;
    expect(
      await session.submit({ message: 'Describe this picture.', blocks })
    ).toBe('success');
    const live = session.getSnapshot();
    expect(texts(live.messages)).toEqual([
      ['user', 'Describe this picture.'],
      ['assistant', 'It is a small test image.'],
    ]);
    expect(live.messages[0].blocks).toEqual(blocks);
    // The assistant answered in text, so it carries no blocks.
    expect('blocks' in live.messages[1]).toBe(false);
    // With raw messages kept, the wire extras are published too.
    expect(live.messages[1].extra).toMatchObject({
      response_metadata: expect.any(Object),
    });
    expect(live.langGraphMessages?.[0]['content']).toEqual([
      { type: 'text', text: 'Describe this picture.' },
      { type: 'image_url', image_url: { url } },
    ]);

    // The server saved the content as blocks, and a reload reads them back.
    const saved = await backend.saved(session.threadId as string);
    expect(
      messagesOf(saved.values as Record<string, unknown>)[0].content
    ).toEqual([
      { type: 'text', text: 'Describe this picture.' },
      { type: 'image_url', image_url: { url } },
    ]);
    const reloaded = track(
      liveSession(backend, { threadId: session.threadId })
    );
    await reloaded.load?.();
    const [user, assistant] = reloaded.getSnapshot().messages;
    expect(user.content).toBe('Describe this picture.');
    expect(user.blocks).toEqual(blocks);
    expect('blocks' in assistant).toBe(false);
    // Extras are published only on a session that keeps raw messages.
    expect('extra' in assistant).toBe(false);
  });
});

describe('failures', () => {
  it('describes a failure the server reported and offers no blind retry', async () => {
    const session = track(
      liveSession({ ...backend, graph: 'no-such-graph' } as LiveBackend)
    );
    const outcome = await session.submit('Hello');
    const snapshot = session.getSnapshot();
    expect(outcome).toBe('error');
    expect(snapshot.status).toBe('error');
    expect(snapshot.error).toMatchObject({ kind: 'server', retryable: false });
    // The diagnostic describes what the error was classified from.
    expect(snapshot.errorDiagnostic).toBeDefined();
    expect(typeof snapshot.errorDiagnostic?.message).toBe('string');
    expect(snapshot.errorDiagnostic?.status).toBe(snapshot.error?.status);
    expect(Object.isFrozen(snapshot.errorDiagnostic)).toBe(true);
    // The user message stays, marked as a failed delivery.
    expect(texts(snapshot.messages)).toEqual([['user', 'Hello']]);
  });

  it('keeps a protected transport generic: no diagnostic is published', async () => {
    const session = track(
      liveSession({ ...backend, graph: 'no-such-graph' } as LiveBackend, {
        clientOptions: { defaultHeaders: { 'x-live': '1' } },
      })
    );
    expect(await session.submit('Hello')).toBe('error');
    expect(session.getSnapshot().error).toMatchObject({
      kind: 'server',
      message: 'The LangGraph request failed.',
    });
    expect(session.getSnapshot().errorDiagnostic).toBeUndefined();
  });

  it('publishes an error when a history load fails, and a later load clears it', async () => {
    const missing = track(
      liveSession(backend, {
        threadId: '00000000-0000-4000-8000-000000000000',
      })
    );
    await expect(missing.load?.()).rejects.toThrow();
    expect(missing.getSnapshot()).toMatchObject({
      status: 'error',
      error: {
        kind: 'server',
        message: 'The conversation could not be loaded.',
        recovery: 'none',
      },
      messages: [],
    });
    expect(missing.getSnapshot().errorDiagnostic).toBeUndefined();

    const empty = track(
      liveSession(backend, { threadId: await backend.thread() })
    );
    await empty.load?.();
    expect(empty.getSnapshot().status).toBe('idle');
    expect(empty.getSnapshot().error).toBeUndefined();
  });
});
