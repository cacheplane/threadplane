import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  streamingDelivery,
  type AgentError,
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
it('forwards previous-role context to custom Chat renderers as the transcript changes', () => {
  const { session, raw, set } = fakeSession({
    messages: [
      assistant('a', 'Answer'),
      { ...assistant('u', 'Next'), role: 'user' },
    ],
  });
  const renderMessage: NonNullable<
    import('./index').ChatProps['renderMessage']
  > = (row, context) => (
    <p data-testid={row.id} data-prev-role={context.prevRole}>
      {row.message.content}
    </p>
  );
  const view = render(<Chat session={session} renderMessage={renderMessage} />);
  expect(view.getByTestId('a').hasAttribute('data-prev-role')).toBe(false);
  expect(view.getByTestId('u').getAttribute('data-prev-role')).toBe(
    'assistant'
  );
  set({
    messages: [
      { ...assistant('a', 'Answer'), role: 'system' },
      { ...assistant('u', 'Next'), role: 'user' },
    ],
  });
  expect(view.getByTestId('u').getAttribute('data-prev-role')).toBe('system');
  expect(raw.submit).not.toHaveBeenCalled();
  expect(raw.stop).not.toHaveBeenCalled();
});
it('forwards authored outcome previews through Chat without executing additional commands', () => {
  const { session, raw } = fakeSession({
    messages: [{ ...assistant('answer', 'Answer'), toolCallIds: ['call'] }],
    toolCalls: [
      {
        id: 'call',
        name: 'lookup',
        args: {},
        status: 'complete',
        result: 'ok',
      },
    ],
  });
  const view = render(
    <Chat
      session={session}
      toolOutcome={() => ({ text: 'Reference verified' })}
    />
  );
  const details = view.container.querySelector(
    '.tp-tool-activity-group__details'
  ) as HTMLDetailsElement;
  expect(details).toBeTruthy();
  expect(details.open).toBe(false);
  expect(view.getByText('Reference verified').closest('details')).toBeNull();
  expect(raw.submit).not.toHaveBeenCalled();
});
it('forwards renderToolResult through Chat', () => {
  const { session } = fakeSession({
    messages: [{ ...assistant('answer', 'Answer'), toolCallIds: ['call'] }],
    toolCalls: [
      {
        id: 'call',
        name: 'lookup',
        args: {},
        status: 'complete',
        result: 'ok',
      },
    ],
  });
  const view = render(
    <Chat
      session={session}
      renderToolResult={(activity) => (
        <button type="button">Act on {activity.id}</button>
      )}
    />
  );
  expect(view.getByRole('button', { name: 'Act on call' })).toBeTruthy();
});
it('forwards renderToolCall through Chat', () => {
  const { session } = fakeSession({ messages: [{ ...assistant('answer', 'Answer'), toolCallIds: ['call'] }], toolCalls: [{ id: 'call', name: 'lookup', args: {}, status: 'complete', result: 'ok' }] });
  const view = render(
    <Chat session={session} renderToolCall={(call) => <p>Card for {call.name}</p>} />
  );
  expect(view.getByText('Card for lookup').parentElement?.className).toBe('tp-chat-tool-call');
  expect(view.container.querySelector('.tp-tool-activity')).toBeNull();
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
  it('forwards the second renderer argument without changing session ownership', () => {
    const { session, raw } = fakeSession({
      messages: [assistant('a', 'A'), assistant('b', 'B')],
    });
    const renderMessage = vi.fn((row, context) => (
      <p>
        {row.id}:{String(context.current)}
      </p>
    ));
    const view = render(
      <Chat session={session} renderMessage={renderMessage} />
    );
    expect(view.getByText('a:false')).toBeTruthy();
    expect(view.getByText('b:true')).toBeTruthy();
    expect(raw.submit).not.toHaveBeenCalled();
    expect(raw.dispose).not.toHaveBeenCalled();
  });
  it('offers a latest action from existing status without commands or draft changes and focuses only on activation', () => {
    const { session, raw, set } = fakeSession({
      messages: [assistant('a', 'Answer')],
    });
    const subscribe = vi.spyOn(session, 'subscribe');
    const view = render(<Chat session={session} />);
    const region = view.getByRole('region', { name: 'Conversation' });
    const draft = box(view);
    fireEvent.change(draft, { target: { value: 'Kept draft' } });
    draft.focus();
    const focus = vi.spyOn(region, 'focus');
    let top = 0;
    Object.defineProperties(region, {
      scrollHeight: { configurable: true, get: () => 1000 },
      clientHeight: { configurable: true, get: () => 200 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value) => {
          top = Math.min(value, 800);
        },
      },
    });
    expect(view.queryByRole('button', { name: 'Scroll to latest' })).toBeNull();
    top = 800;
    fireEvent.scroll(region);
    top = 100;
    fireEvent.scroll(region);
    expect(view.getByRole('button', { name: 'Scroll to latest' })).toBeTruthy();
    set({ status: 'running', messages: [assistant('a', 'Answer grows')] });
    const button = view.getByRole('button', {
      name: 'Scroll to latest, response in progress',
    });
    expect(top).toBe(100);
    expect(document.activeElement).toBe(draft);
    expect(draft.value).toBe('Kept draft');
    expect(focus).not.toHaveBeenCalled();
    button.focus();
    fireEvent.click(button);
    expect(top).toBe(800);
    expect(document.activeElement).toBe(region);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(view.queryByRole('button', { name: /Scroll to latest/ })).toBeNull();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(raw.submit).not.toHaveBeenCalled();
    expect(raw.stop).not.toHaveBeenCalled();
    expect(raw.dispose).not.toHaveBeenCalled();
  });
  it('projects waiting from its existing subscription through first text, next turn, Stop and replacement', () => {
    const one = fakeSession({ status: 'running' });
    const subscribe = vi.spyOn(one.session, 'subscribe');
    const view = render(<Chat session={one.session} />);
    expect(view.getByRole('status').textContent).toContain(
      'Assistant is typing'
    );
    expect(subscribe).toHaveBeenCalledTimes(1);
    one.set({ messages: [assistant('a', '')] });
    expect(view.getByRole('status')).toBeTruthy();
    one.set({ messages: [assistant('a', 'First token')] });
    expect(view.queryByRole('status')).toBeNull();
    one.set({ messages: [assistant('a', 'First token later')] });
    expect(view.queryByRole('status')).toBeNull();
    one.set({
      messages: [
        {
          id: 'u',
          role: 'user',
          content: 'Next',
          delivery: streamingDelivery('u'),
        },
      ],
    });
    expect(view.getByRole('status')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Stop' }));
    expect(one.raw.stop).toHaveBeenCalledExactlyOnceWith();
    one.set({ status: 'idle' });
    expect(view.queryByRole('status')).toBeNull();
    one.set({ status: 'error' });
    expect(view.queryByRole('status')).toBeNull();
    one.set({ status: 'running' });
    expect(view.getByRole('status')).toBeTruthy();
    const two = fakeSession();
    view.rerender(<Chat session={two.session} />);
    expect(view.queryByRole('status')).toBeNull();
    one.set({ status: 'running', messages: [] });
    expect(view.queryByRole('status')).toBeNull();
    expect(subscribe).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(one.raw.submit).not.toHaveBeenCalled();
    expect(two.raw.submit).not.toHaveBeenCalled();
    expect(two.raw.stop).not.toHaveBeenCalled();
    expect(one.raw.dispose).not.toHaveBeenCalled();
    expect(two.raw.dispose).not.toHaveBeenCalled();
  });
  const failure = (recovery: AgentError['recovery'] = 'retry'): AgentError =>
    Object.freeze({
      kind: 'server',
      message: 'Failed',
      detail: 'Detail',
      retryable: true,
      recovery,
    });
  it('dispatches only the explicit app retry with zero arguments', () => {
    const { session, raw } = fakeSession({ error: failure() });
    const retry = vi.fn();
    const view = render(<Chat session={session} onRetry={retry} />);
    fireEvent.click(view.getByRole('button', { name: 'Retry response' }));
    expect(retry).toHaveBeenCalledExactlyOnceWith();
    expect(raw.submit).not.toHaveBeenCalled();
    expect(view.getByRole('alert').classList.contains('tp-chat__error')).toBe(
      true
    );
    expect(view.getByRole('alert').textContent).toContain('Detail');
  });
  it.each(['check', 'none'] as const)(
    'does not fall through %s to app retry',
    (recovery) => {
      const { session } = fakeSession({ error: failure(recovery) });
      const view = render(<Chat session={session} onRetry={vi.fn()} />);
      expect(view.queryByRole('button', { name: 'Retry response' })).toBeNull();
      expect(view.queryByRole('button', { name: 'Check status' })).toBeNull();
    }
  );
  it('binds supported checkStatus to its receiver and contains rejection', () => {
    const { session } = fakeSession({ error: failure('check') });
    const failed = rejection();
    const check = vi.fn(function (this: AgentSession) {
      expect(this).toBe(session);
      return failed as never;
    });
    Object.assign(session, { checkStatus: check });
    const retry = vi.fn();
    const view = render(<Chat session={session} onRetry={retry} />);
    fireEvent.click(view.getByRole('button', { name: 'Check status' }));
    expect(check).toHaveBeenCalledExactlyOnceWith();
    expect(failed.handled).toBe(true);
    expect(retry).not.toHaveBeenCalled();
  });
  it.each(['retry', 'check'] as const)(
    'guards stale %s against replaced or cleared latest error',
    (recovery) => {
      const { session } = fakeSession({ error: failure(recovery) });
      const request = vi.fn(async () => undefined);
      Object.assign(session, { checkStatus: request });
      const view = render(<Chat session={session} onRetry={request} />);
      const button = view.getByRole('button', {
        name: recovery === 'check' ? 'Check status' : 'Retry response',
      });
      const presented = session.getSnapshot();
      for (const error of [failure(recovery), undefined]) {
        vi.spyOn(session, 'getSnapshot').mockReturnValue({
          ...presented,
          error,
        });
        fireEvent.click(button);
        expect(request).not.toHaveBeenCalled();
      }
    }
  );
  it('rechecks the optional capability at dispatch', () => {
    const { session } = fakeSession({ error: failure('check') });
    const request = vi.fn(async () => undefined);
    Object.assign(session, { checkStatus: request });
    const view = render(<Chat session={session} />);
    Object.assign(session, { checkStatus: undefined });
    fireEvent.click(view.getByRole('button', { name: 'Check status' }));
    expect(request).not.toHaveBeenCalled();
  });
  it('uses only the new session and clears the notice without recovery or disposal', () => {
    const one = fakeSession({ error: failure('check') });
    const two = fakeSession({ error: failure('check') });
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    Object.assign(one.session, { checkStatus: first });
    Object.assign(two.session, { checkStatus: second });
    const view = render(<Chat session={one.session} />);
    view.rerender(<Chat session={two.session} />);
    fireEvent.click(view.getByRole('button', { name: 'Check status' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith();
    two.set({ error: undefined });
    expect(view.queryByRole('alert')).toBeNull();
    view.unmount();
    expect(one.raw.dispose).not.toHaveBeenCalled();
    expect(two.raw.dispose).not.toHaveBeenCalled();
  });
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

  it('passes app-owned composer slots through and keeps them across snapshots', () => {
    const { session, set } = fakeSession();
    const view = render(
      <Chat
        session={session}
        inputBanner={<p>Notice</p>}
        inputAttachments={<p>Files</p>}
        inputLeading={<span>Lead</span>}
        inputTrailing={<button type="button">Tools</button>}
        inputFooter={<p>Foot</p>}
      />
    );
    const tools = view.getByRole('button', { name: 'Tools' });
    expect(view.getByText('Lead').parentElement?.className).toBe(
      'tp-chat-input__leading'
    );
    expect(tools.parentElement?.className).toBe('tp-chat-input__trailing');
    expect(view.getByText('Notice').parentElement?.className).toBe(
      'tp-chat-input__banner'
    );
    expect(view.getByText('Files').parentElement?.className).toBe(
      'tp-chat-input__attachments'
    );
    expect(view.getByText('Foot').parentElement?.className).toBe(
      'tp-chat-input__footer'
    );
    act(() => set({ status: 'running' }));
    expect(view.getByRole('button', { name: 'Tools' })).toBe(tools);
    expect(
      Array.from(
        view.container.querySelectorAll('.tp-chat-input__actions > *')
      ).map((el) => el.className)
    ).toEqual([
      'tp-chat-input__trailing',
      'tp-chat-input__stop',
      'tp-chat-input__send',
    ]);
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

  it('skips a run notice that only repeats a failed call, and keeps one that adds anything', () => {
    const base = {
      kind: 'server',
      message: 'Read unavailable',
      retryable: true,
    } as const;
    const alerts = (
      error: AgentError,
      props: Partial<Parameters<typeof Chat>[0]> = {},
      text = ' Read unavailable '
    ) => {
      const { session } = fakeSession({
        status: 'error',
        error: Object.freeze(error),
        messages: [{ ...assistant('answer', 'Answer'), toolCallIds: ['call'] }],
        toolCalls: [
          {
            id: 'call',
            name: 'read',
            args: {},
            status: 'complete',
            result: { error: 'x' },
          },
        ],
      } as Partial<AgentSnapshot>);
      const view = render(
        <Chat
          session={session}
          toolOutcome={() => ({ status: 'failed', text })}
          {...props}
        />
      );
      const found = view.container.querySelectorAll('.tp-chat__error').length;
      const all = view.container.querySelectorAll(
        '.tp-status-panel[role="alert"]'
      ).length;
      view.unmount();
      return [found, all];
    };
    // Same words and no action to offer: the call's failure panel stands alone.
    expect(alerts(base)).toEqual([0, 1]);
    // Different words, a detail, a status check or an app retry all keep the notice.
    expect(alerts(base, {}, 'Reference missing')[0]).toBe(1);
    expect(alerts({ ...base, detail: 'HTTP 503' })[0]).toBe(1);
    expect(alerts({ ...base, recovery: 'check' })[0]).toBe(1);
    expect(alerts(base, { onRetry: () => undefined })[0]).toBe(1);
    // A custom renderMessage owns failure display, so nothing is assumed shown.
    expect(alerts(base, { renderMessage: () => null })[0]).toBe(1);
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
