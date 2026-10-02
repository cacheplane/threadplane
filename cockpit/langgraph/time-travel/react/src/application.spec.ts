import { expect, it, vi } from 'vitest';
import type {
  AgentSnapshot,
  CompleteOutcome,
  Message,
} from '@threadplane/core';
import { createTimeTravelApplication } from './application';
import type { ForkSource } from './checkpoint-history';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
async function tick() {
  for (let n = 0; n < 8; n++) await Promise.resolve();
}
type State = AgentSnapshot & {
  values?: Readonly<Record<string, unknown>>;
  history?: unknown;
  interrupts: readonly unknown[];
};
const source = (id = 'checkpoint-A'): ForkSource => ({
  thread_id: 'thread-A',
  checkpoint_ns: '',
  checkpoint_id: id,
  checkpoint_map: { '': id },
});
const history = () => [
  {
    checkpoint: source(),
    parent_checkpoint: null,
    created_at: '<literal date>',
    next: [],
  },
];

function setup() {
  let sequence = 0;
  const sessions: ReturnType<typeof fake>[] = [];
  const saved = new Map<string, readonly Message[]>();
  function fake() {
    let releaseHook: (() => void) | undefined;
    let state: State = {
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
    };
    const listeners = new Set<() => void>();
    const runs: ReturnType<typeof deferred<CompleteOutcome>>[] = [];
    const read = deferred<void>();
    function replace(update: Partial<State>) {
      state = { ...state, ...update };
      for (const notify of listeners) notify();
    }
    function begin(text: string, prefix = state.messages) {
      const number = ++sequence;
      const human: Message = {
        id: 'human-' + number,
        role: 'user',
        content: text,
        delivery: {
          generation: 'generation-' + number,
          phase: 'complete',
          outcome: 'success',
        },
      };
      const pending = deferred<CompleteOutcome>();
      runs.push(pending);
      replace({ status: 'running', messages: [...prefix, human] });
      return pending.promise;
    }
    const session = {
      getSnapshot: () => state,
      subscribe: vi.fn((notify: () => void) => {
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
          releaseHook?.();
        };
      }),
      submit: vi.fn((text: string, _options?: { signal?: AbortSignal }) =>
        begin(text)
      ),
      fork: vi.fn(
        (
          checkpoint: ForkSource,
          text: string,
          _options?: { signal?: AbortSignal }
        ) =>
          begin(
            text,
            (saved.get(checkpoint.checkpoint_id) ?? []).map((message) => ({
              ...message,
              delivery: {
                generation: message.id,
                phase: 'complete',
                outcome: 'success',
              },
            }))
          )
      ),
      load: vi.fn(async (_options?: { signal?: AbortSignal }) => {
        await read.promise;
      }),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    function final(
      update: Partial<State> = {},
      outcome: CompleteOutcome = 'success'
    ) {
      const human = state.messages
        .filter((message) => message.role === 'user')
        .at(-1)!;
      const answer: Message = {
        id: 'answer-' + human.id,
        role: 'assistant',
        content: 'Answer to ' + human.content,
        delivery: {
          generation: human.delivery.generation,
          phase: 'complete',
          outcome: 'success',
        },
      };
      const messages = [...state.messages, answer];
      replace({
        status: 'idle',
        messages,
        values: {
          completed_turn_id: human.id,
          completed_answer_id: answer.id,
          completed_message_ids: messages.map((message) => message.id),
        },
        ...update,
      });
      runs.at(-1)!.resolve(outcome);
    }
    return {
      session,
      replace,
      final,
      runs,
      read,
      state: () => state,
      onRelease: (hook: () => void) => {
        releaseHook = hook;
      },
    };
  }
  const createThread = vi.fn(async (_signal: AbortSignal) => 'thread-A');
  const factory = vi.fn((_id: string) => {
    const selected = fake();
    sessions.push(selected);
    return selected.session;
  });
  const app = createTimeTravelApplication({
    createThread,
    sessionFactory: factory,
  });
  async function send(text = 'A') {
    const promise = app.submit(text);
    await tick();
    sessions[0].final();
    await promise;
  }
  async function refresh(page: unknown = history()) {
    const promise = app.refreshHistory();
    await tick();
    const reader = sessions.at(-1)!;
    reader.replace({ history: page });
    reader.read.resolve();
    await promise;
    return reader;
  }
  return { app, sessions, saved, createThread, factory, fake, send, refresh };
}

it('creates lazily, admits one command synchronously and reuses the confirmed primary', async () => {
  const f = setup();
  expect(f.createThread).not.toHaveBeenCalled();
  const first = f.app.submit('A'),
    competing = f.app.submit('B');
  await tick();
  expect(f.createThread).toHaveBeenCalledOnce();
  expect(f.sessions[0].session.submit).toHaveBeenCalledOnce();
  f.sessions[0].final();
  await Promise.all([first, competing]);
  await f.send('C');
  expect(f.createThread).toHaveBeenCalledOnce();
  expect(f.factory).toHaveBeenCalledOnce();
  expect(f.app.getSnapshot().canSubmit).toBe(true);
});

it('refresh is a separate same-UUID read-only session, and selection causes no I/O', async () => {
  const f = setup();
  await f.app.refreshHistory();
  expect(f.factory).not.toHaveBeenCalled();
  await f.send();
  const reader = await f.refresh();
  expect(f.factory.mock.calls.map((args) => args[0])).toEqual([
    'thread-A',
    'thread-A',
  ]);
  expect(reader.session.load).toHaveBeenCalledOnce();
  expect(reader.session.dispose).toHaveBeenCalledOnce();
  expect(reader.session.submit).not.toHaveBeenCalled();
  expect(reader.session.fork).not.toHaveBeenCalled();
  expect(f.sessions[0].session.load).not.toHaveBeenCalled();
  const rows = f.app.getSnapshot().rows;
  f.app.selectCheckpoint(0);
  expect(f.app.getSnapshot().selectedSource).toEqual(source());
  expect(f.app.getSnapshot().rows).toBe(rows);
  expect(f.sessions[0].session.fork).not.toHaveBeenCalled();
});

it('fork adopts only selected source history and ordinary Send continues the same primary', async () => {
  const f = setup();
  await f.send('A');
  f.saved.set('checkpoint-A', f.sessions[0].state().messages);
  await f.send('B');
  await f.refresh();
  f.app.selectCheckpoint(0);
  const promise = f.app.forkSelected('C');
  await tick();
  expect(f.sessions[0].session.fork).toHaveBeenCalledWith(
    source(),
    'C',
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  f.sessions[0].final();
  await promise;
  expect(
    f.app
      .getSnapshot()
      .rows.filter((row) => row.role === 'user')
      .map((row) => row.message.content)
  ).toEqual(['A', 'C']);
  await f.send('D');
  expect(
    f.app
      .getSnapshot()
      .rows.filter((row) => row.role === 'user')
      .map((row) => row.message.content)
  ).toEqual(['A', 'C', 'D']);
  expect(f.sessions[0].session.submit).toHaveBeenCalledTimes(3);
  expect(f.createThread).toHaveBeenCalledOnce();
});

it('valid current pair with truncated canonical history blocks all further effects', async () => {
  const f = setup();
  await f.send();
  const promise = f.app.submit('B');
  await tick();
  const human = f.sessions[0].state().messages.at(-1)!;
  f.sessions[0].final({
    values: {
      completed_turn_id: human.id,
      completed_answer_id: 'answer-' + human.id,
      completed_message_ids: [human.id, 'answer-' + human.id],
    },
  });
  await promise;
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  expect(f.app.getSnapshot().error).toBeTruthy();
  await f.app.submit('No replay');
  await f.app.refreshHistory();
  expect(f.sessions[0].session.submit).toHaveBeenCalledTimes(2);
  expect(f.factory).toHaveBeenCalledOnce();
});

it('successful empty history differs from missing history and clears selection at refresh admission', async () => {
  const f = setup();
  await f.send();
  await f.refresh();
  f.app.selectCheckpoint(0);
  const promise = f.app.refreshHistory();
  expect(f.app.getSnapshot().selectedSource).toBeNull();
  await tick();
  f.sessions.at(-1)!.read.resolve();
  await promise;
  expect(f.app.getSnapshot().historyError).toBeTruthy();
  expect(f.app.getSnapshot().canSubmit).toBe(true);
  await f.refresh([]);
  expect(f.app.getSnapshot().historyPage).toEqual([]);
  expect(f.app.getSnapshot().historyError).toBeNull();
});

it('a failed read preserves safe primary continuation and grants no execution outcome', async () => {
  const f = setup();
  await f.send();
  const promise = f.app.refreshHistory();
  await tick();
  f.sessions.at(-1)!.read.reject(new Error('Read unavailable'));
  await promise;
  expect(f.sessions.at(-1)!.session.dispose).toHaveBeenCalledOnce();
  expect(f.app.getSnapshot().canSubmit).toBe(true);
  expect(f.app.getSnapshot().historyError).toBeTruthy();
  expect(f.app.getSnapshot().outcome).toBe('success');
  await f.send('Continue safely');
});

it('Stop revokes a held history read before late settlement and requires New', async () => {
  const f = setup();
  await f.send();
  const promise = f.app.refreshHistory();
  await tick();
  const reader = f.sessions.at(-1)!;
  await f.app.stop();
  const stopped = f.app.getSnapshot();
  reader.replace({ history: history() });
  reader.read.resolve();
  await promise;
  expect(f.app.getSnapshot()).toBe(stopped);
  expect(stopped.canSubmit).toBe(false);
  expect(reader.session.dispose).toHaveBeenCalledOnce();
  await f.app.newConversation();
  expect(f.app.getSnapshot().threadId).toBeNull();
  expect(f.app.getSnapshot().rows).toEqual([]);
  expect(f.app.getSnapshot().historyPage).toBeUndefined();
  expect(f.createThread).toHaveBeenCalledOnce();
});

it.each([
  { toolCallId: 'unexpected' },
  { toolCallIds: ['unexpected'] },
  { role: 'tool' as const },
])(
  'sticky unsupported message evidence blocks commands: %j',
  async (change) => {
    const f = setup();
    const promise = f.app.submit('A');
    await tick();
    const primary = f.sessions[0],
      human = primary.state().messages[0];
    primary.replace({ messages: [{ ...human, ...change }] });
    primary.replace({ messages: [human] });
    primary.final();
    await promise;
    expect(f.app.getSnapshot().canSubmit).toBe(false);
    await f.app.submit('Never');
    expect(primary.session.submit).toHaveBeenCalledOnce();
  }
);

it('reentrant Stop on command admission prevents dispatch', async () => {
  const f = setup();
  await f.send();
  const release = f.app.subscribe(() => {
    if (f.app.getSnapshot().busy) void f.app.stop();
  });
  await f.app.submit('Never dispatched');
  release();
  expect(f.sessions[0].session.submit).toHaveBeenCalledOnce();
  expect(f.app.getSnapshot().canSubmit).toBe(false);
});

it('New reserves replacement before external unsubscribe can submit or create another thread', async () => {
  const f = setup();
  await f.send();
  f.sessions[0].onRelease(() => {
    void f.app.submit('Unauthorized cleanup turn');
  });
  await f.app.newConversation();
  await tick();
  expect(f.createThread).toHaveBeenCalledOnce();
  expect(f.sessions[0].session.submit).toHaveBeenCalledOnce();
  expect(f.app.getSnapshot().threadId).toBeNull();
  expect(f.app.getSnapshot().canSubmit).toBe(true);
});

it('disposal revokes observers and all secondary sessions before late read completion', async () => {
  const f = setup();
  await f.send();
  const promise = f.app.refreshHistory();
  await tick();
  const reader = f.sessions.at(-1)!;
  await f.app.dispose();
  const view = f.app.getSnapshot();
  reader.replace({ history: history() });
  reader.read.resolve();
  await promise;
  expect(f.app.getSnapshot()).toBe(view);
  expect(reader.session.dispose).toHaveBeenCalledOnce();
  expect(f.sessions[0].session.dispose).toHaveBeenCalledOnce();
});

it('disposal reentered from the secondary factory waits for the newly returned reader cleanup', async () => {
  const f = setup();
  await f.send();
  const late = f.fake();
  f.factory.mockImplementationOnce(() => {
    void f.app.dispose();
    return late.session;
  });
  await f.app.refreshHistory();
  await f.app.dispose();
  expect(late.session.dispose).toHaveBeenCalledOnce();
  expect(late.session.load).not.toHaveBeenCalled();
  expect(f.sessions[0].session.dispose).toHaveBeenCalledOnce();
});

it.each([
  { interrupts: [{ value: 'Unsupported pause' }] },
  {
    toolCalls: [
      { id: 'unsupported', name: 'unknown', args: {}, status: 'pending' },
    ],
  },
  {
    error: { kind: 'server', message: 'PRIVATE root error', retryable: false },
  },
])(
  'root evidence stays unsafe after a later clean snapshot: %j',
  async (evidence) => {
    const f = setup();
    const promise = f.app.submit('A');
    await tick();
    f.sessions[0].replace(evidence as Partial<State>);
    f.sessions[0].replace({ interrupts: [], toolCalls: [], error: undefined });
    f.sessions[0].final();
    await promise;
    expect(f.app.getSnapshot().canSubmit).toBe(false);
    await f.app.submit('Never replay');
    await f.app.refreshHistory();
    expect(f.sessions[0].session.submit).toHaveBeenCalledOnce();
    expect(f.factory).toHaveBeenCalledOnce();
  }
);
