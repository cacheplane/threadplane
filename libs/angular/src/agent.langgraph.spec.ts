import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_LIFECYCLE,
  createAgentRef,
  injectAgent,
  provideAgent,
  ɵsetAgentDevelopmentHost,
  type AgentDevelopmentInstall,
} from './public-api';
import { ɵresetAgentDevelopmentHost } from './development-host';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only this integration spec composes the private runtime; production imports core only.
import {
  createSession,
  type LangGraphSession,
} from '../../langgraph/src/runtime/create-session';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Test-only controllable stream from the private runtime.
import { controlledTransport } from '../../langgraph/src/runtime/testing/controlled-transport';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Test-only deferred from the private runtime.
import { deferred } from '../../langgraph/src/runtime/testing/deferred';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only transport contract of the private runtime.
import type {
  AgentTransport,
  StreamEvent,
} from '../../langgraph/src/runtime/transport.types';

/** Saved checkpoints, as the transport's history read returns them. */
type ThreadState = Awaited<
  ReturnType<NonNullable<AgentTransport['getHistory']>>
>[number];

const delta = (content: string, id = 'answer'): StreamEvent => ({
  type: 'messages',
  messages: [{ type: 'AIMessageChunk', id, content }],
  messageMetadata: {},
});
const saved = (threadId: string, text: string): ThreadState[] => [
  {
    values: {
      messages: [
        { id: `${threadId}-user`, type: 'human', content: `Question in ${text}` },
        { id: `${threadId}-answer`, type: 'ai', content: `Answer in ${text}` },
      ],
    },
    next: [],
    tasks: [],
    metadata: {},
    checkpoint: {
      thread_id: threadId,
      checkpoint_ns: '',
      checkpoint_id: `${threadId}-saved`,
      checkpoint_map: {},
    },
    parent_checkpoint: null,
    created_at: '2026-11-19T00:00:00Z',
  } as unknown as ThreadState,
];

/** One backend for every session the agent creates: a controllable stream for
 * each run and a controllable history read for each thread. */
function backend() {
  const runs: {
    threadId: string | null;
    signal: AbortSignal;
    stream: ReturnType<typeof controlledTransport<StreamEvent>>;
  }[] = [];
  const reads: {
    threadId: string;
    signal: AbortSignal;
    result: ReturnType<typeof deferred<ThreadState[]>>;
  }[] = [];
  const waiting: (() => void)[] = [];
  const settled = () => {
    for (const wake of waiting.splice(0)) wake();
  };
  let created = 0;
  const transport: AgentTransport = {
    stream(_assistant, threadId, _payload, signal) {
      const stream = controlledTransport<StreamEvent>({ signal });
      runs.push({ threadId, signal, stream });
      settled();
      return stream.stream;
    },
    createThread: async () => `created-${++created}`,
    getHistory(threadId, signal) {
      const result = deferred<ThreadState[]>();
      reads.push({ threadId, signal, result });
      settled();
      return result.promise;
    },
  };
  const until = async (ready: () => boolean) => {
    while (!ready()) await new Promise<void>((wake) => waiting.push(wake));
  };
  return {
    transport,
    runs,
    reads,
    /** Ends a run as a server does: the final state, then the stream closes. */
    finish(index: number, content: string, id = 'answer') {
      runs[index].stream.release({
        type: 'values',
        data: { messages: [{ type: 'ai', id, content }] },
      });
      runs[index].stream.finish();
    },
    run: async (index: number) => {
      await until(() => runs.length > index);
      return runs[index];
    },
    read: async (index: number) => {
      await until(() => reads.length > index);
      return reads[index];
    },
  };
}

type Session = LangGraphSession;
const CHAT = createAgentRef<Session>('chat');

@Component({
  selector: 'test-chat',
  template: `
    <output data-testid="status">{{ agent.status() }}</output>
    <output data-testid="thread">{{ agent.threadId() ?? 'new' }}</output>
    <output data-testid="loading">{{ agent.isThreadLoading() }}</output>
    <ul>
      @for (message of agent.messages(); track message.id) {
      <li>{{ message.role }}: {{ message.content }}</li>
      }
    </ul>
    <div role="alert">{{ agent.error()?.message }}</div>
  `,
})
class Chat {
  readonly agent = injectAgent(CHAT);
}

afterEach(() => TestBed.resetTestingModule());

function mount(
  options: {
    threadId?: string | null | ReturnType<typeof signal<string | null>>;
    onThreadId?: (id: string) => void;
  } = {}
) {
  const server = backend();
  const sessions: Session[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideAgent(CHAT, {
        ...options,
        createSession: ({ threadId, onThreadId }) => {
          const session = createSession({
            assistantId: 'agent',
            threadId,
            onThreadId,
            transport: server.transport,
          });
          sessions.push(session);
          return session;
        },
      }),
    ],
  });
  const view = TestBed.createComponent(Chat);
  view.detectChanges();
  const text = (testId: string) =>
    view.nativeElement.querySelector(`[data-testid="${testId}"]`).textContent;
  const rows = () =>
    [...view.nativeElement.querySelectorAll('li')].map(
      (row: HTMLElement) => row.textContent
    );
  /** Resolves once the agent's own signals satisfy the predicate. */
  const seen = async (ready: () => boolean) => {
    for (let turn = 0; turn < 200 && !ready(); turn++) await Promise.resolve();
    expect(ready()).toBe(true);
    view.detectChanges();
  };
  return {
    view,
    agent: view.componentInstance.agent,
    server,
    sessions,
    text,
    rows,
    seen,
  };
}

describe('Agent over a LangGraph session', () => {
  it('submits through the injected agent and renders the streamed answer', async () => {
    const { agent, server, text, rows, seen } = mount({ threadId: 'thread-a' });
    const history = await server.read(0);
    expect(history.threadId).toBe('thread-a');
    history.result.resolve([]);
    await seen(() => !agent.isThreadLoading());

    const outcome = agent.submit('Hello');
    const run = await server.run(0);
    expect(run.threadId).toBe('thread-a');
    await seen(() => agent.status() === 'running');
    expect(text('status')).toBe('running');
    expect(rows()).toEqual(['user: Hello']);

    run.stream.release(delta('Hi'));
    await seen(() => agent.messages().length === 2);
    run.stream.release(delta(' there'));
    await seen(() => agent.messages()[1].content === 'Hi there');
    expect(rows()).toEqual(['user: Hello', 'assistant: Hi there']);

    server.finish(0, 'Hi there');
    await expect(outcome).resolves.toBe('success');
    await seen(() => agent.status() === 'idle');
    expect(text('status')).toBe('idle');
    // LangGraph's own snapshot fields are signals on the same agent.
    expect(agent.subgraphs()).toEqual([]);
    expect(agent.interrupts()).toEqual([]);
  });

  it('loads the selected thread history automatically', async () => {
    const { agent, server, text, rows, seen } = mount({ threadId: 'thread-a' });
    expect(text('loading')).toBe('true');
    expect(agent.history()).toBeUndefined();
    const history = await server.read(0);
    history.result.resolve(saved('thread-a', 'A'));
    await seen(() => !agent.isThreadLoading());
    expect(text('loading')).toBe('false');
    expect(rows()).toEqual(['user: Question in A', 'assistant: Answer in A']);
    expect(agent.history()).toHaveLength(1);
    expect(TestBed.inject(AGENT_LIFECYCLE).threadPersistedAt()).toBeTypeOf(
      'number'
    );
  });

  it('switches threads during a run without the old thread publishing again', async () => {
    const { agent, server, sessions, text, rows, seen } = mount({
      threadId: 'thread-a',
    });
    (await server.read(0)).result.resolve([]);
    await seen(() => !agent.isThreadLoading());
    const outcome = agent.submit('Hello');
    const run = await server.run(0);
    run.stream.release(delta('Partial'));
    await seen(() => agent.messages().length === 2);
    const messages = agent.messages;

    agent.switchThread('thread-b');
    expect(agent.messages).toBe(messages);
    expect(agent.threadId()).toBe('thread-b');
    expect(agent.messages()).toEqual([]);
    expect(agent.status()).toBe('idle');
    expect(sessions).toHaveLength(2);
    expect(sessions[1].threadId).toBe('thread-b');
    // The old run's stream is closed, and its caller is told it did not finish.
    await run.stream.closed;
    expect(run.signal.aborted).toBe(true);
    await expect(outcome).resolves.not.toBe('success');

    // A late answer on the old thread reaches nobody.
    run.stream.release(delta(' and late'));
    const history = await server.read(1);
    expect(history.threadId).toBe('thread-b');
    history.result.resolve(saved('thread-b', 'B'));
    await seen(() => !agent.isThreadLoading());
    expect(rows()).toEqual(['user: Question in B', 'assistant: Answer in B']);
    expect(text('thread')).toBe('thread-b');

    // The same agent keeps working on the new thread.
    const next = agent.submit('Again');
    const second = await server.run(1);
    expect(second.threadId).toBe('thread-b');
    second.stream.release(delta('Fresh', 'fresh'));
    await seen(() => agent.messages().at(-1)?.content === 'Fresh');
    server.finish(1, 'Fresh', 'fresh');
    await expect(next).resolves.toBe('success');
  });

  it('ignores the history of a thread it switched away from', async () => {
    const selected = signal<string | null>('thread-a');
    const { agent, server, rows, seen } = mount({ threadId: selected });
    const first = await server.read(0);

    selected.set('thread-b');
    TestBed.tick();
    const second = await server.read(1);
    selected.set('thread-c');
    TestBed.tick();
    const third = await server.read(2);
    expect([first, second].every((read) => read.signal.aborted)).toBe(true);

    // The two abandoned reads answer late, in the wrong order.
    second.result.resolve(saved('thread-b', 'B'));
    first.result.resolve(saved('thread-a', 'A'));
    await Promise.resolve();
    await Promise.resolve();
    expect(agent.messages()).toEqual([]);
    expect(agent.isThreadLoading()).toBe(true);

    third.result.resolve(saved('thread-c', 'C'));
    await seen(() => !agent.isThreadLoading());
    expect(agent.threadId()).toBe('thread-c');
    expect(rows()).toEqual(['user: Question in C', 'assistant: Answer in C']);
  });

  it('adopts the thread the session creates, and keeps that run', async () => {
    const selected = signal<string | null>(null);
    const onThreadId = vi.fn((id: string) => selected.set(id));
    const { agent, server, sessions, text, seen } = mount({
      threadId: selected,
      onThreadId,
    });
    expect(text('thread')).toBe('new');
    expect(server.reads).toHaveLength(0);

    const outcome = agent.submit('Hello');
    const run = await server.run(0);
    expect(run.threadId).toBe('created-1');
    expect(onThreadId).toHaveBeenCalledExactlyOnceWith('created-1');
    expect(agent.threadId()).toBe('created-1');
    expect(TestBed.inject(AGENT_LIFECYCLE).threadCreatedAt()).toBeTypeOf(
      'number'
    );

    // The host wrote the id back into its signal: no switch, the run goes on.
    TestBed.tick();
    expect(sessions).toHaveLength(1);
    expect(run.signal.aborted).toBe(false);
    run.stream.release(delta('Welcome'));
    await seen(() => agent.messages().length === 2);
    server.finish(0, 'Welcome');
    await expect(outcome).resolves.toBe('success');
    expect(text('thread')).toBe('created-1');

    // A new chat is a new empty session on the same agent.
    agent.switchThread(null);
    expect(agent.threadId()).toBeNull();
    expect(agent.messages()).toEqual([]);
    expect(sessions).toHaveLength(2);
  });

  it('retains custom events and mirrors the session lifecycle', async () => {
    const { agent, server, seen } = mount({ threadId: 'thread-a' });
    (await server.read(0)).result.resolve([]);
    await seen(() => !agent.isThreadLoading());
    const listener = vi.fn();
    agent.onCustomEvent(listener);
    expect(agent.lifecycle.streamStartedAt()).toBeNull();

    void agent.submit('Hello');
    const run = await server.run(0);
    run.stream.release({
      type: 'custom',
      data: { name: 'progress', data: { step: 1 } },
    } as StreamEvent);
    await seen(() => agent.customEvents().length === 1);
    expect(agent.customEvents()).toEqual([
      { name: 'progress', data: { step: 1 } },
    ]);
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      name: 'progress',
      data: { step: 1 },
    });
    expect(agent.lifecycle.streamStartedAt()).toBeTypeOf('number');

    agent.switchThread('thread-b');
    expect(agent.customEvents()).toEqual([]);
    expect(agent.lifecycle.streamStartedAt()).toBeNull();
  });

  it('disposes the session when the component tree is destroyed', async () => {
    const { agent, server, sessions, view, seen } = mount({
      threadId: 'thread-a',
    });
    (await server.read(0)).result.resolve([]);
    await seen(() => !agent.isThreadLoading());
    const outcome = agent.submit('Hello');
    const run = await server.run(0);
    view.destroy();
    TestBed.resetTestingModule();
    await run.stream.closed;
    await expect(outcome).resolves.not.toBe('success');
    await expect(sessions[0].submit('After')).resolves.toBe('aborted');
  });
});

describe('Agent over a LangGraph session and the development collector', () => {
  afterEach(() => ɵresetAgentDevelopmentHost());

  /** A host standing in for the chat package's registration. */
  function collectorHost() {
    const built: { install: AgentDevelopmentInstall; calls: unknown[][] }[] = [];
    const policies = new Map<object, () => boolean>();
    ɵsetAgentDevelopmentHost({
      createRuntime: (install) => {
        const calls: unknown[][] = [];
        built.push({ install, calls });
        return {
          touch: () => calls.push(['touch']),
          milestone: (kind) => calls.push([kind]),
          dispose: () => calls.push(['dispose']),
        };
      },
      registerPolicy: (agent, policy) => policies.set(agent, policy),
    });
    return { built, policies };
  }

  function mountSpreading(extra: { telemetry?: false } = {}) {
    const server = backend();
    TestBed.configureTestingModule({
      providers: [
        provideAgent(CHAT, {
          threadId: 'thread-a',
          // The whole context is handed on, as an app writes it.
          createSession: (context) =>
            createSession({
              assistantId: 'agent',
              ...context,
              ...extra,
              transport: { stream: server.transport.stream },
            }),
        }),
      ],
    });
    const view = TestBed.createComponent(Chat);
    view.detectChanges();
    return { server, agent: view.componentInstance.agent };
  }

  it('reports the session to the collector with nothing but the spread context', async () => {
    const host = collectorHost();
    const { server, agent } = mountSpreading();
    expect(host.built).toHaveLength(1);
    expect(host.built[0].install).toMatchObject({
      integration: 'langgraph',
      packageName: '@threadplane/langgraph',
    });
    expect(host.built[0].install.enabled()).toBe(true);
    expect(host.policies.get(agent)?.()).toBe(true);
    expect(host.built[0].calls).toEqual([['touch']]);

    const outcome = agent.submit('Hello');
    await server.run(0);
    server.finish(0, 'Hi');
    expect(await outcome).toBe('success');
    expect(host.built[0].calls).toEqual([
      ['touch'],
      ['touch'],
      ['transport.connected'],
      ['runtime.first_stream_completed'],
    ]);
  });

  it('is off for an agent whose session chose its own telemetry', () => {
    const host = collectorHost();
    const { agent } = mountSpreading({ telemetry: false });
    expect(host.built[0].install.enabled()).toBe(false);
    expect(host.policies.get(agent)?.()).toBe(false);
  });
});
