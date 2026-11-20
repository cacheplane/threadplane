import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentRef, injectAgent, provideAgent } from './public-api';
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
