import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CopyConversationId } from './copy-conversation-id';
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});
function activate(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole('button', { name: /^Actions for/ }));
  fireEvent.click(view.getByRole('menuitem'));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('reports a denied clipboard getter and permits retry', async () => {
  vi.spyOn(navigator, 'clipboard', 'get').mockImplementation(() => {
    throw Error('denied getter');
  });
  const view = render(<CopyConversationId id="a" />);
  activate(view);
  await act(async () => {});
  expect(view.getByRole('status').textContent).toBe(
    'Could not copy conversation ID.'
  );
  expect(view.getByText('Failed').getAttribute('aria-hidden')).toBe('true');
  const write = vi.fn(async () => {});
  clipboard(write);
  activate(view);
  await act(async () => {});
  expect(write.mock.calls).toEqual([['a']]);
});
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  get: () => undefined,
});
function clipboard(writeText: (text: string) => Promise<void>) {
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
    writeText,
  } as Clipboard);
}
function pending() {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = () => no(Error('denied'));
  });
  const write = vi.fn(() => promise);
  clipboard(write);
  return { write, resolve, reject };
}
it('copies the literal ID only on explicit activation, blocks immediate reentry and reports success', async () => {
  const attempt = pending();
  const view = render(
    <StrictMode>
      <CopyConversationId id={'a<&'} title="Full title" />
    </StrictMode>
  );
  const button = view.getByRole('button', {
    name: 'Actions for Full title (a<&)',
  }) as HTMLButtonElement;
  expect(button.title).toBe('Actions for Full title (a<&)');
  expect(attempt.write).not.toHaveBeenCalled();
  expect(view.queryByText(/^(Copying…|Copied|Failed)$/)).toBeNull();
  button.focus();
  fireEvent.click(button);
  const item = view.getByRole('menuitem', {
    name: 'Copy conversation ID for Full title (a<&)',
  });
  act(() => {
    item.click();
    item.click();
  });
  expect(attempt.write.mock.calls).toEqual([['a<&']]);
  expect(button.disabled).toBe(false);
  expect(document.activeElement).toBe(button);
  expect(view.queryByRole('menu')).toBeNull();
  fireEvent.click(button);
  expect((view.getByRole('menuitem') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByRole('menuitem'));
  expect(attempt.write).toHaveBeenCalledOnce();
  fireEvent.keyDown(view.getByRole('menu'), { key: 'Escape' });
  expect(view.getByRole('status').textContent).toBe('Copying conversation ID…');
  expect(view.getByText('Copying…').getAttribute('aria-hidden')).toBe('true');
  await act(async () => attempt.resolve());
  expect(button.disabled).toBe(false);
  expect(view.getByRole('status').textContent).toBe('Conversation ID copied.');
  expect(view.getByText('Copied').getAttribute('aria-hidden')).toBe('true');
});
it('reports unavailable clipboard and rejection and permits an explicit retry', async () => {
  const view = render(<CopyConversationId id="a" />);
  activate(view);
  await act(async () => {});
  expect(view.getByRole('status').textContent).toBe(
    'Could not copy conversation ID.'
  );
  expect(view.getByText('Failed').getAttribute('aria-hidden')).toBe('true');
  const attempt = pending();
  activate(view);
  await act(async () => attempt.reject());
  expect(view.getByRole('status').textContent).toBe(
    'Could not copy conversation ID.'
  );
  expect(view.getByText('Failed').getAttribute('aria-hidden')).toBe('true');
  const success = vi.fn(async () => {});
  clipboard(success);
  activate(view);
  await act(async () => {});
  expect(success.mock.calls).toEqual([['a']]);
  expect(view.getByRole('status').textContent).toBe('Conversation ID copied.');
  expect(view.getByText('Copied').getAttribute('aria-hidden')).toBe('true');
});
it.each(['resolve', 'reject'] as const)(
  'discards stale %s after an A→B→A identity replacement',
  async (settle) => {
    const attempt = pending();
    const view = render(<CopyConversationId id="a" />);
    activate(view);
    view.rerender(<CopyConversationId id="b" />);
    view.rerender(<CopyConversationId id="a" />);
    expect(view.getByRole('status').textContent).toBe('');
    expect(view.queryByText(/^(Copying…|Copied|Failed)$/)).toBeNull();
    await act(async () => attempt[settle]());
    expect(view.getByRole('status').textContent).toBe('');
    expect(view.queryByText(/^(Copying…|Copied|Failed)$/)).toBeNull();
    expect((view.getByRole('button') as HTMLButtonElement).disabled).toBe(
      false
    );
  }
);
it('does not settle into a new mount', async () => {
  const attempt = pending();
  const view = render(<CopyConversationId id="a" />);
  activate(view);
  view.unmount();
  const fresh = render(<CopyConversationId id="a" />);
  await act(async () => attempt.resolve());
  expect(fresh.getByRole('status').textContent).toBe('');
  expect(attempt.write).toHaveBeenCalledOnce();
});
it('uses the control owner document clipboard', async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const owner = frame.contentDocument!;
  vi.spyOn(
    owner.defaultView!.HTMLElement.prototype,
    'getClientRects'
  ).mockReturnValue([{}] as unknown as DOMRectList);
  const write = vi.fn(async () => {});
  Object.defineProperty(owner.defaultView!.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: write },
  });
  const view = render(<CopyConversationId id="owner-id" />, {
    container: owner.body,
  });
  activate(view);
  await act(async () => {});
  expect(write.mock.calls).toEqual([['owner-id']]);
  view.unmount();
  frame.remove();
});
