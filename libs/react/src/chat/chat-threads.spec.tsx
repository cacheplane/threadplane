import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession, AgentSnapshot } from '@threadplane/core';
import { Chat, type ThreadListItem } from './index';

afterEach(cleanup);

const snapshot = Object.freeze({ status: 'idle', messages: [], toolCalls: [] }) as AgentSnapshot;
const session = {
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  submit: vi.fn(async () => 'success' as const),
  stop: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
} as unknown as AgentSession;
const threads: readonly ThreadListItem[] = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
];

describe('Chat threads sidebar', () => {
  it('leaves the root untouched without the prop', () => {
    const view = render(<Chat session={session} className="mine" />);
    expect(view.container.firstElementChild?.className).toBe('tp-chat mine');
    expect(view.container.querySelector('.tp-chat-shell')).toBeNull();
  });

  it('lists conversations in a sidebar before the chat, which keeps its class', () => {
    const view = render(<Chat session={session} className="mine" threads={threads} />);
    const shell = view.container.firstElementChild!;
    expect(shell.className).toBe('tp-chat-shell');
    const [sidebar, chat] = Array.from(shell.children);
    expect(sidebar.tagName).toBe('ASIDE');
    expect(sidebar.className).toBe('tp-chat tp-chat-shell__sidebar');
    expect(chat.className).toBe('tp-chat mine');
    expect(view.getByRole('button', { name: 'Alpha' })).not.toBeNull();
    expect(chat.contains(view.getByRole('textbox'))).toBe(true);
  });

  it('reports the chosen conversation and marks the active one', () => {
    const onThreadSelect = vi.fn();
    const view = render(
      <Chat session={session} threads={threads} activeThreadId="b" onThreadSelect={onThreadSelect} />
    );
    fireEvent.click(view.getByRole('button', { name: 'Alpha' }));
    expect(onThreadSelect.mock.calls).toEqual([['a']]);
    expect(view.getByRole('button', { name: 'Beta' }).getAttribute('aria-current')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Alpha' }).getAttribute('aria-current')).toBeNull();
  });

  it('shows no sidebar for an empty list, and keeps the composer when conversations load', () => {
    const view = render(<Chat session={session} threads={[]} />);
    expect(view.container.querySelector('.tp-chat-shell')).not.toBeNull();
    expect(view.container.querySelector('aside')).toBeNull();
    const input = view.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'draft' } });
    view.rerender(<Chat session={session} threads={threads} />);
    expect(view.container.querySelector('aside')).not.toBeNull();
    expect(view.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('draft');
  });
});
