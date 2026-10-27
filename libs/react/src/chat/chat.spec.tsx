import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  streamingDelivery,
  type AgentSession,
  type AgentSnapshot,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageContent,
} from '@threadplane/content/messages';
import { Chat } from './index';

const created = vi.hoisted(() => [] as MessageContent[]);
vi.mock('@threadplane/content/messages', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@threadplane/content/messages')
  >();
  return {
    ...actual,
    createMessageContent: (
      ...args: Parameters<typeof actual.createMessageContent>
    ) => {
      const content = actual.createMessageContent(...args);
      vi.spyOn(content, 'dispose');
      vi.spyOn(content, 'project');
      created.push(content);
      return content;
    },
  };
});

beforeEach(() => {
  created.length = 0;
});
afterEach(cleanup);

function fakeSession(initial: Partial<AgentSnapshot> = {}) {
  let snapshot: AgentSnapshot = Object.freeze({
    status: 'idle',
    messages: [],
    toolCalls: [],
    ...initial,
  }) as AgentSnapshot;
  const listeners = new Set<() => void>();
  const session = {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    submit: vi.fn<(text: string) => Promise<'success'>>(async () => 'success'),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const set = (next: Partial<AgentSnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...next }) as AgentSnapshot;
    act(() => listeners.forEach((l) => l()));
  };
  return { session: session as unknown as AgentSession, raw: session, set };
}
const assistant = (id: string, content: string) =>
  Object.freeze({
    id,
    role: 'assistant' as const,
    content,
    delivery: streamingDelivery('g'),
  });
const box = (view: ReturnType<typeof render>) =>
  view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const disposed = (content: MessageContent) =>
  vi.mocked(content.dispose).mock.calls.length > 0;

/** A rejected promise that records whether the caller attached a rejection handler. */
function rejection() {
  const inner = Promise.reject(new Error('boom'));
  inner.catch(() => undefined);
  const tracked = {
    handled: false,
    then(
      onFulfilled?: (v: never) => unknown,
      onRejected?: (e: unknown) => unknown
    ) {
      if (onRejected) tracked.handled = true;
      return inner.then(onFulfilled, onRejected);
    },
    catch(onRejected?: (e: unknown) => unknown) {
      return tracked.then(undefined, onRejected);
    },
  };
  return tracked;
}

describe('Chat', () => {
  it('renders streamed Markdown and submits the trimmed draft through the session', () => {
    const { session, raw, set } = fakeSession();
    const view = render(<Chat session={session} />);
    fireEvent.change(box(view), { target: { value: ' Hello ' } });
    fireEvent.keyDown(box(view), { key: 'Enter' });
    expect(raw.submit).toHaveBeenCalledWith('Hello');
    expect(box(view).value).toBe('');
    set({ status: 'running', messages: [assistant('a', '# Answer')] });
    expect(view.getByRole('heading', { name: 'Answer' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Stop' }));
    expect(raw.stop).toHaveBeenCalledOnce();
  });

  it('forwards composer props and a className', () => {
    const { session } = fakeSession();
    const view = render(
      <Chat session={session} label="Ask" hint="Enter sends" className="mine" />
    );
    const input = view.getByRole('textbox', { name: 'Ask' });
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(view.container.firstElementChild?.className).toBe('tp-chat mine');
  });

  it('shows the session error as an alert', () => {
    const { session } = fakeSession({
      status: 'error',
      error: Object.freeze({
        kind: 'server',
        message: 'Server failed',
        retryable: true,
      }),
    } as Partial<AgentSnapshot>);
    const view = render(<Chat session={session} />);
    expect(view.getByRole('alert').textContent).toBe('Server failed');
  });

  it('swallows a rejected submit', () => {
    const { session, raw } = fakeSession();
    const failed = rejection();
    raw.submit.mockReturnValueOnce(failed as never);
    const view = render(<Chat session={session} />);
    fireEvent.change(box(view), { target: { value: 'x' } });
    fireEvent.keyDown(box(view), { key: 'Enter' });
    expect(raw.submit).toHaveBeenCalledOnce();
    expect(failed.handled).toBe(true);
  });

  it('swallows a rejected stop', () => {
    const { session, raw } = fakeSession({ status: 'running' });
    const failed = rejection();
    raw.stop.mockReturnValueOnce(failed as never);
    const view = render(<Chat session={session} />);
    fireEvent.click(view.getByRole('button', { name: 'Stop' }));
    expect(raw.stop).toHaveBeenCalledOnce();
    expect(failed.handled).toBe(true);
  });

  it('keeps a live owner under StrictMode double mount', () => {
    const { session, set } = fakeSession();
    const view = render(
      <StrictMode>
        <Chat session={session} />
      </StrictMode>
    );
    set({ messages: [assistant('a', '# Strict')] });
    expect(view.getByRole('heading', { name: 'Strict' })).toBeTruthy();
    view.unmount();
    // StrictMode may discard a render-created owner unused; every used one is released.
    const used = created.filter(
      (content) => vi.mocked(content.project).mock.calls.length > 0
    );
    expect(used.length).toBeGreaterThan(0);
    expect(used.every(disposed)).toBe(true);
  });

  it('disposes its owned content on unmount', () => {
    const { session } = fakeSession({ messages: [assistant('a', '# Owned')] });
    const view = render(<Chat session={session} />);
    expect(created).toHaveLength(1);
    expect(disposed(created[0])).toBe(false);
    view.unmount();
    expect(disposed(created[0])).toBe(true);
  });

  it('never disposes app-passed content and reuses it across remounts', () => {
    const content = createMessageContent();
    const { session } = fakeSession({ messages: [assistant('a', '# Kept')] });
    const first = render(<Chat session={session} content={content} />);
    expect(first.getByRole('heading', { name: 'Kept' })).toBeTruthy();
    const rows = content.project(session.getSnapshot());
    first.unmount();
    const second = render(
      <StrictMode>
        <Chat session={session} content={content} />
      </StrictMode>
    );
    expect(second.getByRole('heading', { name: 'Kept' })).toBeTruthy();
    second.unmount();
    expect(content.project(session.getSnapshot())).toBe(rows);
    expect(disposed(content)).toBe(false);
    expect(created).toEqual([content]);
  });

  it('resets the draft and replaces owned content when the session changes', () => {
    const one = fakeSession({ messages: [assistant('a', '# First')] });
    const two = fakeSession({ messages: [assistant('b', '# Second')] });
    const view = render(<Chat session={one.session} />);
    fireEvent.change(box(view), { target: { value: 'draft' } });
    view.rerender(<Chat session={two.session} />);
    expect(box(view).value).toBe('');
    expect(view.getByRole('heading', { name: 'Second' })).toBeTruthy();
    expect(view.queryByRole('heading', { name: 'First' })).toBeNull();
    expect(created).toHaveLength(2);
    expect(disposed(created[0])).toBe(true);
    expect(disposed(created[1])).toBe(false);
  });
});
