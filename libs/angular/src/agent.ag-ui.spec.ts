import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgentRef,
  injectAgent,
  provideAgent,
  provideAgentClientOptions,
  ɵsetAgentDevelopmentHost,
  type AgentDevelopmentInstall,
} from './public-api';
import { ɵresetAgentDevelopmentHost } from './development-host';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only this integration spec composes the private native owner; production imports core only.
import {
  createSession,
  type Session,
} from '../../ag-ui/src/runtime/create-session';

interface Exchange {
  readonly threadId: string;
  readonly runId: string;
  readonly signal: AbortSignal | null | undefined;
  emit(event: Record<string, unknown>): void;
  end(): void;
}

/** One endpoint for every session the agent creates: each request is an
 * open event stream the spec writes to. */
function endpoint() {
  const exchanges: Exchange[] = [];
  const waiting: (() => void)[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      threadId: string;
      runId: string;
    };
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let open = true;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel() {
        open = false;
      },
    });
    init?.signal?.addEventListener('abort', () => {
      if (!open) return;
      open = false;
      controller.error(new DOMException('Aborted', 'AbortError'));
    });
    const exchange: Exchange = {
      threadId: body.threadId,
      runId: body.runId,
      signal: init?.signal,
      emit(event) {
        if (!open) return;
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify(
              // Only the run's own lifecycle events carry its ids.
              String(event['type']).startsWith('RUN_')
                ? { threadId: body.threadId, runId: body.runId, ...event }
                : event
            )}\n\n`
          )
        );
      },
      end() {
        if (!open) return;
        open = false;
        controller.close();
      },
    };
    exchange.emit({ type: 'RUN_STARTED' });
    exchanges.push(exchange);
    for (const wake of waiting.splice(0)) wake();
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  return {
    fetch: fetch as typeof globalThis.fetch,
    exchanges,
    async exchange(index: number) {
      while (exchanges.length <= index)
        await new Promise<void>((wake) => waiting.push(wake));
      return exchanges[index];
    },
  };
}

const CHAT = createAgentRef<Session>('chat');

@Component({
  selector: 'test-chat',
  template: `
    <output data-testid="status">{{ agent.status() }}</output>
    <ul>
      @for (message of agent.messages(); track message.id) {
      <li>{{ message.role }}: {{ message.content }}</li>
      }
    </ul>
  `,
})
class Chat {
  readonly agent = injectAgent(CHAT);
}

afterEach(() => TestBed.resetTestingModule());

function mount(threadId: string | null = 'thread-a') {
  const server = endpoint();
  const sessions: Session[] = [];
  let minted = 0;
  const onThreadId = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideAgent(CHAT, {
        threadId,
        onThreadId,
        createSession: (context) => {
          // AG-UI names its thread on the client: with none selected, the
          // factory chooses one and tells the agent.
          const id = context.threadId ?? `minted-${++minted}`;
          if (context.threadId === null) context.onThreadId(id);
          const session = createSession({
            url: 'https://agent.invalid/run',
            threadId: id,
            fetch: server.fetch,
          });
          sessions.push(session);
          return session;
        },
      }),
    ],
  });
  const view = TestBed.createComponent(Chat);
  view.detectChanges();
  const rows = () =>
    [...view.nativeElement.querySelectorAll('li')].map(
      (row: HTMLElement) => row.textContent
    );
  const seen = async (ready: () => boolean) => {
    for (let turn = 0; turn < 50 && !ready(); turn++)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(ready()).toBe(true);
    view.detectChanges();
  };
  return {
    view,
    agent: view.componentInstance.agent,
    server,
    sessions,
    onThreadId,
    rows,
    seen,
  };
}

function answer(exchange: Exchange, text: string, messageId = 'answer') {
  exchange.emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
  exchange.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text });
  exchange.emit({ type: 'TEXT_MESSAGE_END', messageId });
}

describe('Agent over an AG-UI session', () => {
  it('submits through the injected agent and renders the streamed answer', async () => {
    const { agent, server, rows, seen } = mount();
    expect(agent.threadId()).toBe('thread-a');
    expect(agent.status()).toBe('idle');
    // No history capability on this session: nothing is loaded.
    expect(agent.isThreadLoading()).toBe(false);

    const outcome = agent.submit('Hello');
    const exchange = await server.exchange(0);
    expect(exchange.threadId).toBe('thread-a');
    await seen(() => agent.status() === 'running');
    answer(exchange, 'Hi there');
    await seen(() => agent.messages().length === 2);
    expect(rows()).toEqual(['user: Hello', 'assistant: Hi there']);

    exchange.emit({ type: 'RUN_FINISHED' });
    exchange.end();
    await expect(outcome).resolves.toBe('success');
    await seen(() => agent.status() === 'idle');
    // The protocol evidence is on the same agent, as signals.
    expect(agent.transcript().map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(agent.run()?.id).toBe(exchange.runId);
    expect(agent.decision()).toBeUndefined();
    expect(agent.subagents()).toEqual([]);
  });

  it('switches threads during a run without the old thread publishing again', async () => {
    const { agent, server, sessions, rows, seen } = mount();
    const outcome = agent.submit('Hello');
    const first = await server.exchange(0);
    answer(first, 'Partial');
    await seen(() => agent.messages().length === 2);
    const { messages, transcript } = agent;

    agent.switchThread('thread-b');
    expect(agent.messages).toBe(messages);
    expect(agent.transcript).toBe(transcript);
    expect(agent.threadId()).toBe('thread-b');
    expect(messages()).toEqual([]);
    expect(transcript()).toEqual([]);
    expect(agent.status()).toBe('idle');
    expect(sessions).toHaveLength(2);
    await expect(outcome).resolves.not.toBe('success');
    expect(first.signal?.aborted).toBe(true);
    first.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'answer', delta: '!' });

    const next = agent.submit('Again');
    const second = await server.exchange(1);
    expect(second.threadId).toBe('thread-b');
    answer(second, 'Fresh', 'fresh');
    second.emit({ type: 'RUN_FINISHED' });
    second.end();
    await expect(next).resolves.toBe('success');
    await seen(() => agent.status() === 'idle');
    expect(rows()).toEqual(['user: Again', 'assistant: Fresh']);
  });

  it('reports a thread id the factory chose, and retains custom events', async () => {
    const { agent, server, onThreadId, seen } = mount(null);
    expect(agent.threadId()).toBe('minted-1');
    expect(onThreadId).toHaveBeenCalledExactlyOnceWith('minted-1');

    void agent.submit('Hello');
    const exchange = await server.exchange(0);
    expect(exchange.threadId).toBe('minted-1');
    exchange.emit({ type: 'CUSTOM', name: 'progress', value: { step: 1 } });
    await seen(() => agent.customEvents().length === 1);
    expect(agent.customEvents()).toEqual([
      { name: 'progress', data: { step: 1 } },
    ]);
    exchange.emit({ type: 'RUN_FINISHED' });
    exchange.end();
    await seen(() => agent.status() === 'idle');

    agent.switchThread(null);
    expect(agent.threadId()).toBe('minted-2');
    expect(agent.customEvents()).toEqual([]);
    expect(onThreadId).toHaveBeenLastCalledWith('minted-2');
  });
});

describe('Agent over an AG-UI session given the whole context', () => {
  /** The one provider pattern: the context spread into the session options. */
  function mountSpread(threadId: string | null) {
    const server = endpoint();
    const sessions: Session[] = [];
    const onThreadId = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        // An AG-UI session accepts and ignores the app's client options.
        provideAgentClientOptions({ apiUrl: 'https://ignored.invalid' }),
        provideAgent(CHAT, {
          threadId,
          onThreadId,
          createSession: (context) => {
            const session = createSession({
              url: 'https://agent.invalid/run',
              fetch: server.fetch,
              ...context,
            });
            sessions.push(session);
            return session;
          },
        }),
      ],
    });
    const view = TestBed.createComponent(Chat);
    view.detectChanges();
    const agent = view.componentInstance.agent;
    const run = async (index: number, text: string) => {
      const outcome = agent.submit(text);
      const exchange = await server.exchange(index);
      exchange.emit({ type: 'RUN_FINISHED' });
      exchange.end();
      await expect(outcome).resolves.toBe('success');
      return exchange;
    };
    return { agent, server, sessions, onThreadId, run };
  }

  it('shows the id the session minted, with no app code reporting it', async () => {
    const { agent, sessions, onThreadId, run } = mountSpread(null);
    const minted = sessions[0].threadId;
    expect(minted).toEqual(expect.any(String));
    expect(agent.threadId()).toBe(minted);
    expect(onThreadId).toHaveBeenCalledExactlyOnceWith(minted);

    expect((await run(0, 'Hello')).threadId).toBe(minted);
    expect(agent.threadId()).toBe(minted);
    expect(onThreadId).toHaveBeenCalledTimes(1);
  });

  it('switches to a named thread and back to a new conversation with a new id', async () => {
    const { agent, sessions, onThreadId, run } = mountSpread(null);
    const first = sessions[0].threadId;
    await run(0, 'Hello');

    agent.switchThread('thread-b');
    expect(sessions).toHaveLength(2);
    expect(sessions[1].threadId).toBe('thread-b');
    expect(agent.threadId()).toBe('thread-b');
    expect(agent.messages()).toEqual([]);
    // A thread the application named is not reported back to it.
    expect(onThreadId).toHaveBeenCalledTimes(1);
    expect((await run(1, 'There')).threadId).toBe('thread-b');

    agent.switchThread(null);
    expect(sessions).toHaveLength(3);
    const second = sessions[2].threadId;
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
    expect(second).not.toBe('thread-b');
    expect(agent.threadId()).toBe(second);
    expect(onThreadId).toHaveBeenCalledTimes(2);
    expect(onThreadId).toHaveBeenLastCalledWith(second);
    expect((await run(2, 'New')).threadId).toBe(second);

    // Switching back to the first conversation's id names it; nothing is minted.
    agent.switchThread(first ?? null);
    expect(agent.threadId()).toBe(first);
    expect(sessions[3].threadId).toBe(first);
    expect(onThreadId).toHaveBeenCalledTimes(2);
  });

  it('reports nothing for a thread the application selected', async () => {
    const { agent, sessions, onThreadId, run } = mountSpread('thread-a');
    expect(agent.threadId()).toBe('thread-a');
    expect(sessions[0].threadId).toBe('thread-a');
    expect((await run(0, 'Hello')).threadId).toBe('thread-a');
    expect(onThreadId).not.toHaveBeenCalled();
  });
});

describe('Agent over an AG-UI session and the development collector', () => {
  afterEach(() => ɵresetAgentDevelopmentHost());

  it('reports the session to the collector the context carries', async () => {
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
    const server = endpoint();
    TestBed.configureTestingModule({
      providers: [
        provideAgent(CHAT, {
          threadId: 'thread-a',
          createSession: ({ threadId, ...context }) =>
            createSession({
              url: 'https://agent.invalid/run',
              ...context,
              threadId: threadId ?? 'minted',
              fetch: server.fetch,
            }),
        }),
      ],
    });
    const view = TestBed.createComponent(Chat);
    view.detectChanges();
    const agent = view.componentInstance.agent;
    expect(built).toHaveLength(1);
    expect(built[0].install).toMatchObject({
      integration: 'ag-ui',
      packageName: '@threadplane/ag-ui',
    });
    expect(policies.get(agent)?.()).toBe(true);

    const outcome = agent.submit('Hello');
    const exchange = await server.exchange(0);
    exchange.emit({ type: 'RUN_FINISHED' });
    exchange.end();
    expect(await outcome).toBe('success');
    expect(built[0].calls).toEqual([
      ['touch'],
      ['touch'],
      ['transport.connected'],
      ['runtime.first_stream_completed'],
    ]);
  });
});
