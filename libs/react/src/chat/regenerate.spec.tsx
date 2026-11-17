import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completeDelivery,
  type AgentSession,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { Chat, MessageList } from './index';

afterEach(cleanup);

const msg = (id: string, role: 'user' | 'assistant', content: string): Message =>
  Object.freeze({ id, role, content, delivery: completeDelivery(id, 'success') }) as Message;
const messages = [
  msg('u1', 'user', 'First question'),
  msg('a1', 'assistant', 'First answer'),
  msg('u2', 'user', 'Second question'),
  msg('a2', 'assistant', 'Second answer'),
];
const snapshot = (status: AgentSnapshot['status']): AgentSnapshot =>
  Object.freeze({ status, messages, toolCalls: [] }) as AgentSnapshot;
function session(extra: Partial<AgentSession> = {}, status: AgentSnapshot['status'] = 'idle') {
  const value = snapshot(status);
  return {
    getSnapshot: () => value,
    subscribe: () => () => undefined,
    submit: vi.fn(async () => 'success' as const),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    ...extra,
  } as AgentSession;
}
const buttons = (view: ReturnType<typeof render>) =>
  view.queryAllByRole('button', { name: 'Regenerate' }) as HTMLButtonElement[];

describe('Regenerate in the built-in message actions', () => {
  it('is offered under each finished answer when the session can regenerate', () => {
    const regenerate = vi.fn(async () => 'success' as const);
    const view = render(<Chat session={session({ regenerate })} messageActions />);
    expect(buttons(view)).toHaveLength(2);
    fireEvent.click(buttons(view)[1]);
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledWith('a2');
    fireEvent.click(buttons(view)[0]);
    expect(regenerate).toHaveBeenLastCalledWith('a1');
    expect(view.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
  });

  it('is not offered when the session cannot regenerate or the actions are off', () => {
    const regenerate = vi.fn(async () => 'success' as const);
    for (const view of [
      render(<Chat session={session()} messageActions />),
      render(<Chat session={session({ regenerate })} />),
      render(<Chat session={session({ regenerate })} messageActions={false} />),
    ]) {
      expect(buttons(view)).toHaveLength(0);
      view.unmount();
    }
  });

  it('keeps the other actions and swallows a rejected command', async () => {
    const regenerate = vi.fn(async () => {
      throw new Error('Not in history');
    });
    const onRate = vi.fn();
    const view = render(<Chat session={session({ regenerate })} messageActions={{ onRate }} />);
    expect(view.getAllByRole('group', { name: 'Rate response' })).toHaveLength(2);
    fireEvent.click(buttons(view)[1]);
    await Promise.resolve();
    expect(regenerate).toHaveBeenCalledWith('a2');
  });

  it('lets the app handle the action itself', () => {
    const regenerate = vi.fn(async () => 'success' as const);
    const onRegenerate = vi.fn();
    const view = render(
      <Chat session={session({ regenerate })} messageActions={{ onRegenerate }} />
    );
    fireEvent.click(buttons(view)[0]);
    expect(onRegenerate).toHaveBeenCalledWith('a1');
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('is disabled while a response is running', () => {
    const regenerate = vi.fn(async () => 'success' as const);
    const view = render(<Chat session={session({ regenerate }, 'running')} messageActions />);
    expect(buttons(view).map((button) => button.disabled)).toEqual([true, true]);
    fireEvent.click(buttons(view)[0]);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('works on MessageList with an app callback', () => {
    const rows = createMessageContent().project(snapshot('idle'));
    const onRegenerate = vi.fn();
    const view = render(<MessageList rows={rows} messageActions={{ onRegenerate }} />);
    fireEvent.click(buttons(view)[1]);
    expect(onRegenerate).toHaveBeenCalledWith('a2');
    view.rerender(<MessageList rows={rows} running messageActions={{ onRegenerate }} />);
    expect(buttons(view).every((button) => button.disabled)).toBe(true);
    view.rerender(<MessageList rows={rows} messageActions />);
    expect(buttons(view)).toHaveLength(0);
  });
});
