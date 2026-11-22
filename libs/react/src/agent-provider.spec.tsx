import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { AgentSession } from '@threadplane/core';
import {
  createFakeAgentSession,
  type FakeAgentSession,
} from '@threadplane/core/testing';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentProvider,
  useAgent,
  useAgentSession,
  type AgentSessionFactoryContext,
} from './index';
import { Chat } from './chat/index';

afterEach(cleanup);

/** A factory whose sessions resolve when the test says so. */
function deferredFactory() {
  const calls: {
    context: AgentSessionFactoryContext;
    fake: FakeAgentSession;
    resolve(): void;
    reject(error: unknown): void;
  }[] = [];
  const createSession = (context: AgentSessionFactoryContext) =>
    new Promise<AgentSession>((resolve, reject) => {
      const fake = createFakeAgentSession();
      calls.push({ context, fake, resolve: () => resolve(fake.session), reject });
    });
  return { createSession, calls };
}

const flush = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function wrapper(
  factory: ReturnType<typeof deferredFactory>,
  threadId: { current: string | null } = { current: null }
) {
  return ({ children }: { children: ReactNode }) => (
    <AgentProvider createSession={factory.createSession} threadId={threadId.current}>
      {children}
    </AgentProvider>
  );
}

describe('AgentProvider', () => {
  it('shows an empty idle conversation until the first session resolves', async () => {
    const factory = deferredFactory();
    const { result } = renderHook(() => useAgent(), { wrapper: wrapper(factory) });
    expect(result.current.status).toBe('idle');
    expect(result.current.messages).toEqual([]);
    const snapshot = result.current as unknown as Record<string, unknown>;
    for (const key of ['interrupts', 'subgraphs', 'subagents'])
      expect(snapshot[key]).toEqual([]);
    expect(factory.calls).toHaveLength(1);
    expect(factory.calls[0].context.threadId).toBeNull();

    factory.calls[0].resolve();
    await flush();
    expect(result.current).toBe(factory.calls[0].fake.session.getSnapshot());
  });

  it('queues a submit called before the session resolves and runs it on that session', async () => {
    const factory = deferredFactory();
    const { result } = renderHook(() => useAgentSession(), { wrapper: wrapper(factory) });
    let outcome!: Promise<unknown>;
    act(() => {
      outcome = result.current.submit({ message: 'Hello' });
    });
    const submit = vi.spyOn(factory.calls[0].fake.session, 'submit');
    factory.calls[0].resolve();
    await act(async () => {
      await expect(outcome).resolves.toBe('success');
    });
    expect(submit).toHaveBeenCalledWith({ message: 'Hello' });
  });

  it('switches with threadId, adopting only the latest switch and disposing the rest', async () => {
    const factory = deferredFactory();
    const threadId = { current: null as string | null };
    const { rerender } = renderHook(() => useAgent(), { wrapper: wrapper(factory, threadId) });
    factory.calls[0].resolve();
    await flush();
    const first = vi.spyOn(factory.calls[0].fake.session, 'dispose');

    threadId.current = 'a';
    rerender();
    threadId.current = 'b';
    rerender();
    const [, a, b] = factory.calls;
    expect(a.context.threadId).toBe('a');
    expect(b.context.threadId).toBe('b');
    const disposeA = vi.spyOn(a.fake.session, 'dispose');
    b.resolve();
    await flush();
    expect(first).toHaveBeenCalled();
    a.resolve();
    await flush();
    expect(disposeA).toHaveBeenCalled();
  });

  it('keeps its session when a switch rejects, and rejects the commands that waited', async () => {
    const factory = deferredFactory();
    const threadId = { current: null as string | null };
    const { result, rerender } = renderHook(() => useAgentSession(), {
      wrapper: wrapper(factory, threadId),
    });
    factory.calls[0].resolve();
    await flush();
    const kept = vi.spyOn(factory.calls[0].fake.session, 'submit');
    threadId.current = 'broken';
    rerender();
    let waiting!: Promise<unknown>;
    act(() => {
      waiting = result.current.submit({ message: 'Lost' });
    });
    const failure = new Error('Offline');
    factory.calls[1].reject(failure);
    await act(async () => {
      await expect(waiting).rejects.toBe(failure);
    });
    await act(async () => {
      await result.current.submit({ message: 'Still here' });
    });
    expect(kept).toHaveBeenCalledWith({ message: 'Still here' });
  });

  it('disposes its sessions when unmounted, and survives a development double mount', async () => {
    const factory = deferredFactory();
    const { unmount } = render(
      <StrictMode>
        <AgentProvider createSession={factory.createSession}>
          <span>child</span>
        </AgentProvider>
      </StrictMode>
    );
    await flush();
    // StrictMode connects, disconnects and connects again: only the last
    // session is kept, and a session that resolves after disconnect is disposed.
    for (const call of factory.calls) call.resolve();
    await flush();
    const disposals = factory.calls.map((call) => vi.spyOn(call.fake.session, 'dispose'));
    unmount();
    await flush();
    expect(disposals.at(-1)).toHaveBeenCalled();
  });

  it('lets Chat use the provider session when it has no session prop', async () => {
    const factory = deferredFactory();
    const view = render(
      <AgentProvider createSession={factory.createSession}>
        <Chat />
      </AgentProvider>
    );
    expect(view.getByRole('textbox', { name: /message/i })).toBeTruthy();
    factory.calls[0].resolve();
    await flush();
    expect(view.getByRole('textbox', { name: /message/i })).toBeTruthy();
  });

  it('requires a provider or a session', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useAgent())).toThrow(/AgentProvider/);
    expect(() => renderHook(() => useAgentSession())).toThrow(/AgentProvider/);
    expect(() => render(<Chat />)).toThrow(/AgentProvider/);
    quiet.mockRestore();
  });
});
