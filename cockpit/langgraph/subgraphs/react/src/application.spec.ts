import { expect, it, vi } from 'vitest';
import type {
  AgentSnapshot,
  CompleteOutcome,
  Message,
} from '@threadplane/core';
import { createSubgraphsApplication } from './application';

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
type Child = {
  namespace: readonly string[];
  messages: readonly Message[];
  values?: Readonly<Record<string, unknown>>;
  interrupts: readonly { value?: unknown }[];
  error?: AgentSnapshot['error'];
};
type State = AgentSnapshot & {
  values?: Readonly<Record<string, unknown>>;
  interrupts: readonly { value?: unknown }[];
  subgraphs: readonly Child[];
};
function setup() {
  const creations: ReturnType<typeof deferred<string>>[] = [];
  const sessions: ReturnType<typeof fake>[] = [];
  let sequence = 0;
  function fake(id: string) {
    let state: State = {
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
      subgraphs: [],
    };
    let human: Message;
    const observers = new Set<() => void>(),
      release = vi.fn();
    const runs: ReturnType<typeof deferred<CompleteOutcome>>[] = [];
    const session = {
      getSnapshot: () => state,
      subscribe: vi.fn((notify: () => void) => {
        observers.add(notify);
        return () => {
          observers.delete(notify);
          release();
        };
      }),
      submit: vi.fn(async (text: string) => {
        const turn = ++sequence;
        human = {
          id: 'human-' + turn,
          role: 'user',
          content: text,
          delivery: {
            generation: 'turn-' + turn,
            phase: 'complete',
            outcome: 'success',
          },
        };
        const run = deferred<CompleteOutcome>();
        runs.push(run);
        replace({
          status: 'running',
          error: undefined,
          messages: [...state.messages, human],
          subgraphs: [],
        });
        return run.promise;
      }),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    function replace(update: Partial<State>, notify = true) {
      state = { ...state, ...update };
      if (notify) for (const observer of observers) observer();
    }
    function answer(content = 'Parent answer'): Message {
      return {
        id: 'answer-' + human.id,
        role: 'assistant',
        content,
        delivery: {
          generation: human.delivery.generation,
          phase: 'complete',
          outcome: 'success',
        },
      };
    }
    function child(
      namespace: readonly string[] = ['research:' + human.id],
      topic = 'Topic',
      brief = 'Child brief'
    ): Child {
      return {
        namespace,
        messages: [],
        values: { research_topic: topic, research_brief: brief },
        interrupts: [],
      };
    }
    function research() {
      replace({
        values: {
          ...state.values,
          research_topic: 'Topic',
          research_brief: 'Child brief',
        },
        subgraphs: [child()],
      });
    }
    function final(
      route: 'nested' | 'direct' = 'nested',
      update: Partial<State> = {},
      notify = true
    ) {
      replace(
        {
          status: 'idle',
          error: undefined,
          values: {
            research_topic: route === 'nested' ? 'Topic' : '',
            research_brief: route === 'nested' ? 'Child brief' : '',
            completed_turn_id: human.id,
            completed_answer_id: answer().id,
          },
          messages: [...state.messages, answer()],
          subgraphs: route === 'nested' ? [child()] : [],
          ...update,
        },
        notify
      );
    }
    return {
      id,
      session,
      release,
      runs,
      replace,
      final,
      research,
      child,
      answer,
      human: () => human,
    };
  }
  const createThread = vi.fn((_signal: AbortSignal) => {
    const pending = deferred<string>();
    creations.push(pending);
    return pending.promise;
  });
  const sessionFactory = vi.fn((id: string) => {
    const selected = fake(id);
    sessions.push(selected);
    return selected.session;
  });
  const application = createSubgraphsApplication({
    createThread,
    sessionFactory,
  });
  async function start(text = 'Fictional question') {
    const pending = application.submit(text);
    if (creations.length > sessions.length)
      creations.at(-1)!.resolve('thread-' + creations.length);
    await tick();
    return { pending, selected: sessions.at(-1)! };
  }
  async function complete(route: 'nested' | 'direct' = 'nested') {
    const { pending, selected } = await start();
    selected.final(route);
    selected.runs.at(-1)!.resolve('success');
    await pending;
    return selected;
  }
  return {
    application,
    creations,
    sessions,
    createThread,
    sessionFactory,
    start,
    complete,
  };
}
const contents = (h: ReturnType<typeof setup>) =>
  h.application
    .getSnapshot()
    .rows.map((row: { message: Message }) => row.message.content);

it('starts without I/O and never claims a direct route before a turn', async () => {
  const h = setup();
  await h.application.submit(' ');
  expect(h.application.getSnapshot()).toMatchObject({
    threadId: null,
    rows: [],
    busy: false,
    canSubmit: true,
    route: 'awaiting',
    topic: null,
    brief: null,
    children: [],
  });
  expect(h.createThread).not.toHaveBeenCalled();
});
it('serializes creation and keeps child observations readonly until final binding', async () => {
  const h = setup(),
    pending = h.application.submit('Question');
  await h.application.submit('Duplicate');
  await h.application.newConversation();
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.sessionFactory).not.toHaveBeenCalled();
  h.creations[0].resolve('confirmed');
  await tick();
  const selected = h.sessions[0];
  selected.research();
  expect(h.application.getSnapshot()).toMatchObject({
    route: 'awaiting',
    canSubmit: false,
  });
  expect(h.application.getSnapshot().children[0].namespace).toEqual([
    'research:' + selected.human().id,
  ]);
  selected.final();
  selected.runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    route: 'nested',
    topic: 'Topic',
    brief: 'Child brief',
    canSubmit: true,
  });
  expect(contents(h)).toEqual(['Question', 'Parent answer']);
});
it('research then greeting clears stale boundary and children while preserving parent history', async () => {
  const h = setup(),
    selected = await h.complete();
  const pending = h.application.submit('Hello');
  await tick();
  expect(h.application.getSnapshot()).toMatchObject({
    route: 'awaiting',
    topic: null,
    brief: null,
    children: [],
  });
  selected.final('direct');
  selected.runs[1].resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    route: 'direct',
    topic: '',
    brief: '',
    children: [],
    canSubmit: true,
  });
  expect(contents(h)).toEqual([
    'Fictional question',
    'Parent answer',
    'Hello',
    'Parent answer',
  ]);
  expect(h.createThread).toHaveBeenCalledTimes(1);
});
it('a reentrant old-session observation during admission cannot restore the preceding route', async () => {
  const h = setup(),
    selected = await h.complete();
  let armed = true;
  const routes: string[] = [];
  const release = h.application.subscribe(() => {
    const state = h.application.getSnapshot();
    if (
      armed &&
      state.busy &&
      state.activity === 'running' &&
      state.route === 'awaiting'
    ) {
      armed = false;
      selected.replace({});
      routes.push(h.application.getSnapshot().route);
    }
  });
  const pending = h.application.submit('Hello');
  await tick();
  expect(routes).toEqual(['awaiting']);
  selected.final('direct');
  selected.runs[1].resolve('success');
  await pending;
  release();
});
it('a later nested turn retains the full new namespace and all canonical parent turns', async () => {
  const h = setup();
  await h.complete('direct');
  const { pending, selected } = await h.start('Research next');
  const namespace = ['research:outer|literal', 'research:inner'];
  selected.final('nested', { subgraphs: [selected.child(namespace)] });
  selected.runs.at(-1)!.resolve('success');
  await pending;
  expect(h.application.getSnapshot().children[0].namespace).toEqual(namespace);
  expect(contents(h)).toEqual([
    'Fictional question',
    'Parent answer',
    'Research next',
    'Parent answer',
  ]);
});
for (const fault of [
  'missing-human',
  'stale-human',
  'missing-answer',
  'equal',
  'inherited',
  'duplicate-human',
  'duplicate-answer',
  'wrong-generation',
  'partial',
  'wrong-role',
]) {
  it(`rejects ${fault} final identity proof despite successful promise`, async () => {
    const h = setup(),
      { pending, selected } = await h.start();
    selected.final('nested', {}, false);
    const state = selected.session.getSnapshot(),
      values = { ...state.values },
      messages = [...state.messages];
    if (fault === 'missing-human') delete values.completed_turn_id;
    if (fault === 'stale-human') values.completed_turn_id = 'old';
    if (fault === 'missing-answer') delete values.completed_answer_id;
    if (fault === 'equal') values.completed_answer_id = selected.human().id;
    if (fault === 'inherited') {
      delete values.completed_answer_id;
      Object.setPrototypeOf(values, {
        completed_answer_id: state.values!.completed_answer_id,
      });
    }
    if (fault === 'duplicate-human') messages.push(messages[0]);
    if (fault === 'duplicate-answer') messages.push(messages[1]);
    if (fault === 'wrong-generation')
      messages[1] = {
        ...messages[1],
        delivery: { generation: 'old', phase: 'complete', outcome: 'success' },
      };
    if (fault === 'partial')
      messages[1] = {
        ...messages[1],
        delivery: {
          generation: selected.human().delivery.generation,
          phase: 'streaming',
        },
      };
    if (fault === 'wrong-role') messages[1] = { ...messages[1], role: 'user' };
    selected.replace({ values, messages });
    selected.runs[0].resolve('success');
    await pending;
    expect(h.application.getSnapshot()).toMatchObject({
      canSubmit: false,
      route: 'unconfirmed',
    });
  });
}
for (const fault of [
  'missing-topic',
  'inherited-topic',
  'malformed-brief',
  'child-conflict',
  'no-child',
  'empty-namespace',
]) {
  it(`does not confirm a nested boundary with ${fault}`, async () => {
    const h = setup(),
      { pending, selected } = await h.start();
    selected.final('nested', {}, false);
    const state = selected.session.getSnapshot(),
      values = { ...state.values };
    let children = [...state.subgraphs];
    if (fault === 'missing-topic') delete values.research_topic;
    if (fault === 'inherited-topic') {
      delete values.research_topic;
      Object.setPrototypeOf(values, { research_topic: 'Topic' });
    }
    if (fault === 'malformed-brief') values.research_brief = {};
    if (fault === 'child-conflict')
      children = [selected.child(undefined, 'Other')];
    if (fault === 'no-child') children = [];
    if (fault === 'empty-namespace') children = [selected.child([])];
    selected.replace({ values, subgraphs: children });
    selected.runs[0].resolve('success');
    await pending;
    expect(h.application.getSnapshot()).toMatchObject({
      canSubmit: false,
      route: 'unconfirmed',
    });
  });
}
it('direct final fields cannot suppress a fresh child observation', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  selected.research();
  selected.final('direct');
  selected.runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: false,
    route: 'unconfirmed',
  });
});
it('unbound final chunk IDs never replace the bound answer or reappear next turn', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  selected.final();
  const state = selected.session.getSnapshot(),
    chunk = {
      ...state.messages[1],
      id: 'unbound-chunk',
      content: 'Draft chunk',
    };
  selected.replace({ messages: [state.messages[0], chunk, state.messages[1]] });
  selected.runs[0].resolve('success');
  await pending;
  expect(contents(h)).toEqual(['Fictional question', 'Parent answer']);
  const next = h.application.submit('Next');
  await tick();
  expect(contents(h)).toEqual(['Fictional question', 'Parent answer', 'Next']);
  selected.final('direct');
  selected.runs[1].resolve('success');
  await next;
  expect(contents(h)).toEqual([
    'Fictional question',
    'Parent answer',
    'Next',
    'Parent answer',
  ]);
});
for (const fault of [
  'root-error',
  'root-interrupt',
  'root-tool',
  'root-reference',
  'child-error',
  'child-interrupt',
  'child-reference',
]) {
  it(`keeps ${fault} evidence sticky if later observations clear it`, async () => {
    const h = setup(),
      { pending, selected } = await h.start();
    const error = {
      kind: 'interrupted' as const,
      message: 'PRIVATE',
      retryable: false,
      recovery: 'none' as const,
    };
    const child = selected.child();
    if (fault === 'root-error') selected.replace({ error });
    if (fault === 'root-interrupt')
      selected.replace({ interrupts: [{ value: null }] });
    if (fault === 'root-tool')
      selected.replace({
        toolCalls: [
          {
            id: 'unknown',
            name: 'unknown',
            args: {},
            status: 'complete',
            result: {},
          },
        ],
      });
    if (fault === 'root-reference')
      selected.replace({
        messages: [
          selected.human(),
          { ...selected.answer(), toolCallIds: ['unknown'] },
        ],
      });
    if (fault === 'child-error')
      selected.replace({ subgraphs: [{ ...child, error }] });
    if (fault === 'child-interrupt')
      selected.replace({
        subgraphs: [{ ...child, interrupts: [{ value: null }] }],
      });
    if (fault === 'child-reference')
      selected.replace({
        subgraphs: [
          {
            ...child,
            messages: [{ ...selected.answer(), toolCallIds: ['unknown'] }],
          },
        ],
      });
    selected.final('nested', { interrupts: [], toolCalls: [] });
    selected.runs[0].resolve('success');
    await pending;
    expect(h.application.getSnapshot().canSubmit).toBe(false);
  });
}
it('New clears observations and history without creating and detaches the old owner', async () => {
  const h = setup(),
    selected = await h.complete();
  await h.application.newConversation();
  expect(h.application.getSnapshot()).toMatchObject({
    threadId: null,
    rows: [],
    route: 'awaiting',
    children: [],
    topic: null,
    brief: null,
    canSubmit: true,
  });
  expect(selected.release).toHaveBeenCalledTimes(1);
  expect(selected.session.dispose).toHaveBeenCalledTimes(1);
  expect(h.createThread).toHaveBeenCalledTimes(1);
});
it('uncertain creation is protected and never replayed', async () => {
  const h = setup(),
    pending = h.application.submit('First');
  h.creations[0].reject(new Error('PRIVATE'));
  await pending;
  await h.application.submit('Retry');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: false,
    error: 'The LangGraph request failed.',
  });
});
it('Stop during creation fences a late confirmed thread', async () => {
  const h = setup(),
    pending = h.application.submit('First');
  await h.application.stop();
  const stopped = h.application.getSnapshot();
  h.creations[0].resolve('late');
  await pending;
  expect(h.application.getSnapshot()).toBe(stopped);
  expect(h.sessionFactory).not.toHaveBeenCalled();
});
it('Stop during child execution detaches before late final observations', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  selected.research();
  await h.application.stop();
  const stopped = h.application.getSnapshot();
  selected.final();
  selected.runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toBe(stopped);
  expect(stopped.canSubmit).toBe(false);
  expect(selected.release).toHaveBeenCalledTimes(1);
});
it('disposal is idempotent and fences a held child stream', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  selected.research();
  const before = h.application.getSnapshot();
  const disposal = h.application.dispose();
  expect(h.application.dispose()).toBe(disposal);
  expect(selected.release).toHaveBeenCalledTimes(1);
  selected.final();
  selected.runs[0].resolve('success');
  await pending;
  await disposal;
  expect(h.application.getSnapshot()).toBe(before);
  expect(selected.session.dispose).toHaveBeenCalledTimes(1);
});
it('reentrant cancellation while capturing final state cannot restore readiness', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  selected.final('nested', {}, false);
  const state = selected.session.getSnapshot();
  let revoked: unknown;
  vi.spyOn(selected.session, 'getSnapshot').mockImplementationOnce(() => {
    void h.application.stop();
    revoked = h.application.getSnapshot();
    return state;
  });
  selected.runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toBe(revoked);
});
it('reentrant New in an initial safety getter cannot admit work after replacement', async () => {
  const h = setup(),
    selected = await h.complete(),
    state = selected.session.getSnapshot();
  let replacement: Promise<void> | undefined;
  const guarded = new Proxy(state, {
    get(target, key, receiver) {
      if (key === 'subgraphs') replacement = h.application.newConversation();
      return Reflect.get(target, key, receiver);
    },
  });
  vi.spyOn(selected.session, 'getSnapshot').mockReturnValueOnce(guarded);
  await h.application.submit('Must not run');
  await replacement;
  expect(selected.session.submit).toHaveBeenCalledTimes(1);
  expect(h.application.getSnapshot().threadId).toBeNull();
});
for (const location of ['root', 'child']) {
  for (const kind of ['tool-result', 'singular-reference']) {
    it(`keeps unexpected ${location} ${kind} evidence quarantined after it clears`, async () => {
      const h = setup(),
        { pending, selected } = await h.start();
      const message = {
        ...selected.answer(),
        id: 'unsupported-tool-evidence',
        role: kind === 'tool-result' ? 'tool' : 'assistant',
        toolCallId: 'unknown-call',
        content: 'Unexpected tool result',
      } as Message;
      selected.replace(
        location === 'root'
          ? { messages: [selected.human(), message] }
          : { subgraphs: [{ ...selected.child(), messages: [message] }] }
      );
      selected.final();
      selected.runs[0].resolve('success');
      await pending;
      expect(h.application.getSnapshot()).toMatchObject({
        canSubmit: false,
        route: 'unconfirmed',
      });
    });
  }
}
