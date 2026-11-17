import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completeDelivery,
  type AgentSession,
  type AgentSnapshot,
} from '@threadplane/core';
import { Chat } from './index';

afterEach(cleanup);

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
const hello: AgentSnapshot['messages'] = [
  { id: 'u1', role: 'user', content: 'Hello', delivery: completeDelivery('u1', 'success') },
];

describe('Chat header', () => {
  it('adds no element unless the app passes one', () => {
    const { session } = fakeSession();
    const view = render(<Chat session={session} />);
    expect(view.container.querySelector('.tp-chat__header')).toBeNull();
    view.rerender(<Chat session={session} header={null} />);
    expect(view.container.querySelector('.tp-chat__header')).toBeNull();
    view.rerender(<Chat session={session} header={false} />);
    expect(view.container.querySelector('.tp-chat__header')).toBeNull();
  });

  it('renders app content as the first child, above the transcript', () => {
    const { session } = fakeSession({ messages: hello });
    const view = render(
      <Chat session={session} header={<h2>Support</h2>} />
    );
    const header = view.container.querySelector('.tp-chat__header');
    expect(header?.textContent).toBe('Support');
    expect(view.container.firstElementChild?.firstElementChild).toBe(header);
    expect(
      header!.compareDocumentPosition(view.container.querySelector('.tp-chat-list')!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('shows over an empty conversation when no greeting is requested', () => {
    const { session } = fakeSession();
    const view = render(<Chat session={session} header="Support" />);
    expect(view.container.querySelector('.tp-chat__header')?.textContent).toBe('Support');
  });

  it('steps aside for the welcome greeting and returns with the first message, keeping the composer', () => {
    const { session, set } = fakeSession();
    const view = render(<Chat session={session} welcome header={<h2>Support</h2>} />);
    expect(view.container.querySelector('.tp-chat__header')).toBeNull();
    const input = view.getByRole('textbox');
    set({ messages: hello });
    expect(view.container.querySelector('.tp-chat__header')?.textContent).toBe('Support');
    expect(view.getByRole('textbox')).toBe(input);
  });

  it('keeps its own state across snapshots', () => {
    const { session, set } = fakeSession({ messages: hello });
    const view = render(
      <Chat session={session} header={<input aria-label="Title" defaultValue="A" />} />
    );
    const title = view.getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
    title.value = 'B';
    set({ status: 'running' });
    expect(view.getByRole('textbox', { name: 'Title' })).toBe(title);
    expect(title.value).toBe('B');
  });
});
