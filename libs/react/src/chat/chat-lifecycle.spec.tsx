import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession, AgentSnapshot } from '@threadplane/core';
import { Chat, useChatLifecycle, type ChatLifecycle } from './index';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function fakeSession(initial: Partial<AgentSnapshot> = {}) {
  let snapshot = Object.freeze({
    status: 'idle',
    messages: [],
    toolCalls: [],
    ...initial,
  }) as AgentSnapshot;
  const listeners = new Set<() => void>();
  const raw = {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    submit: vi.fn(async () => 'success' as const),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const set = (next: Partial<AgentSnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...next }) as AgentSnapshot;
    act(() => listeners.forEach((notify) => notify()));
  };
  return { session: raw as unknown as AgentSession, set };
}

function send(text: string) {
  const draft = screen.getByRole('textbox');
  fireEvent.change(draft, { target: { value: text } });
  fireEvent.keyDown(draft, { key: 'Enter' });
}

function Probe() {
  const lifecycle = useChatLifecycle();
  return <output data-testid="probe">{JSON.stringify(lifecycle)}</output>;
}
const probed = () =>
  JSON.parse(screen.getByTestId('probe').textContent ?? '') as ChatLifecycle | null;

describe('Chat lifecycle', () => {
  it('is null outside a Chat', () => {
    render(<Probe />);
    expect(probed()).toBeNull();
  });

  it('is ready after mount, with nothing sent', () => {
    const { session } = fakeSession();
    const seen: ChatLifecycle[] = [];
    render(
      <Chat
        session={session}
        inputFooter={<Probe />}
        onLifecycleChange={(next) => seen.push(next)}
      />
    );
    const ready = {
      componentReady: true,
      firstMessageSent: false,
      messageCount: 0,
      inputSubmittedAt: null,
    };
    expect(probed()).toEqual(ready);
    expect(seen).toEqual([ready]);
    expect(Object.isFrozen(seen[0])).toBe(true);
  });

  it('counts each composer submit and records when it happened', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { session } = fakeSession();
    const seen: ChatLifecycle[] = [];
    render(
      <Chat
        session={session}
        inputFooter={<Probe />}
        onLifecycleChange={(next) => seen.push(next)}
      />
    );
    send('Hello');
    expect(session.submit).toHaveBeenCalledWith('Hello');
    expect(probed()).toEqual({
      componentReady: true,
      firstMessageSent: true,
      messageCount: 1,
      inputSubmittedAt: 1_000,
    });
    vi.setSystemTime(5_000);
    send('Again');
    expect(probed()).toMatchObject({ messageCount: 2, inputSubmittedAt: 5_000 });
    // Ready, then one report per submit.
    expect(seen.map((next) => next.messageCount)).toEqual([0, 1, 2]);
    // A blank draft is not a submit.
    send('   ');
    expect(probed()).toMatchObject({ messageCount: 2 });
  });

  it('marks the first message when a run the composer did not start is running', () => {
    const { session, set } = fakeSession();
    render(<Chat session={session} inputFooter={<Probe />} />);
    set({ status: 'running' });
    expect(probed()).toEqual({
      componentReady: true,
      firstMessageSent: true,
      messageCount: 0,
      inputSubmittedAt: null,
    });
  });

  it('starts the counts again for another session and keeps firstMessageSent', () => {
    const first = fakeSession();
    const second = fakeSession();
    const seen: ChatLifecycle[] = [];
    const onChange = (next: ChatLifecycle) => seen.push(next);
    const view = render(
      <Chat session={first.session} inputFooter={<Probe />} onLifecycleChange={onChange} />
    );
    send('Hello');
    view.rerender(
      <Chat session={second.session} inputFooter={<Probe />} onLifecycleChange={onChange} />
    );
    const reset = {
      componentReady: true,
      firstMessageSent: true,
      messageCount: 0,
      inputSubmittedAt: null,
    };
    expect(probed()).toEqual(reset);
    expect(seen[seen.length - 1]).toEqual(reset);
  });

  it('reports nothing when a render changes no value', () => {
    const { session } = fakeSession();
    const onChange = vi.fn();
    const view = render(<Chat session={session} onLifecycleChange={onChange} />);
    view.rerender(<Chat session={session} label="Message" onLifecycleChange={onChange} />);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reaches content in the header and beside a threads sidebar', () => {
    const { session } = fakeSession();
    render(
      <Chat
        session={session}
        header={<Probe />}
        threads={[{ id: 't1', title: 'Trip' }]}
      />
    );
    expect(probed()).toMatchObject({ componentReady: true });
  });
});
