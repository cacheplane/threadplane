import { StrictMode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MoveConversation } from './move-conversation';
import { PROJECT_CATALOG_KEY as key } from './project-catalog';

const request = {
  id: 'a',
  title: '<Alpha>',
  projectId: null,
  token: 1,
  returnFocusTo: null,
};
const rows = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta', projectId: ' exact /id ' },
];
const catalog = () =>
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      projects: [
        { id: ' exact /id ', name: '<Literal project>' },
        { id: '__proto__', name: 'Prototype' },
      ],
    })
  );
const base = () => ({
  request,
  rows,
  pending: false,
  blocked: false,
  onMove: vi.fn().mockResolvedValue(true),
  onClose: vi.fn(),
  fallbackFocusTo: null,
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
const region = (view: ReturnType<typeof render>) =>
  within(view.getByRole('region', { name: 'Move conversation: <Alpha> (a)' }));
it('selects exact IDs without writes and saves only explicit intent; null has no reserved sentinel', async () => {
  catalog();
  const props = base();
  const view = render(<MoveConversation {...props} />);
  const ui = region(view);
  expect(
    (ui.getByRole('button', { name: 'Save', exact: true }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  fireEvent.click(
    ui.getByRole('button', { name: '<Literal project>', exact: true })
  );
  expect(props.onMove).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(ui.getByRole('button', { name: 'Save', exact: true }))
  );
  expect(props.onMove).toHaveBeenCalledWith(' exact /id ', '<Literal project>');
  expect(props.onClose).toHaveBeenCalledWith(request);
  expect(view.container.querySelector('literal')).toBeNull();
});
it('removes membership with explicit null rather than an ID sentinel', async () => {
  catalog();
  const props = { ...base(), request: { ...request, projectId: '__proto__' } };
  const view = render(<MoveConversation {...props} />);
  const ui = region(view);
  fireEvent.click(ui.getByRole('button', { name: 'No project', exact: true }));
  await act(async () =>
    fireEvent.click(ui.getByRole('button', { name: 'Save', exact: true }))
  );
  expect(props.onMove).toHaveBeenCalledWith(null, 'No project');
});
it('keeps target/destination on failure and synchronously rejects duplicate submission', async () => {
  catalog();
  let finish!: (success: boolean) => void;
  const onMove = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      })
  );
  const props = { ...base(), onMove };
  const view = render(<MoveConversation {...props} />);
  const ui = region(view);
  fireEvent.click(ui.getByRole('button', { name: 'Prototype', exact: true }));
  const save = ui.getByRole('button', { name: 'Save', exact: true });
  fireEvent.click(save);
  fireEvent.submit(save.closest('form')!);
  expect(onMove).toHaveBeenCalledTimes(1);
  await act(async () => finish(false));
  expect(props.onClose).not.toHaveBeenCalled();
  expect(ui.getByRole('alert').textContent).toContain('Could not confirm');
  expect(
    ui
      .getByRole('button', { name: 'Prototype', exact: true })
      .getAttribute('aria-current')
  ).toBe('true');
  fireEvent.click(save);
  expect(onMove).toHaveBeenCalledTimes(2);
  await act(async () => finish(true));
  expect(props.onClose).toHaveBeenCalledWith(request);
});
it('does not close a replacement editor when an older pending operation finishes', async () => {
  catalog();
  let finish!: (success: boolean) => void;
  const props = {
    ...base(),
    onMove: vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    ),
  };
  const view = render(<MoveConversation key={1} {...props} />);
  let ui = region(view);
  fireEvent.click(ui.getByRole('button', { name: 'Prototype', exact: true }));
  fireEvent.click(ui.getByRole('button', { name: 'Save', exact: true }));
  fireEvent.click(ui.getByRole('button', { name: 'Cancel', exact: true }));
  expect(props.onClose).toHaveBeenCalledWith(request);
  props.onClose.mockClear();
  view.rerender(
    <MoveConversation key={2} {...props} request={{ ...request, token: 2 }} />
  );
  await act(async () => finish(true));
  expect(props.onClose).not.toHaveBeenCalled();
  ui = region(view);
  expect(ui.getByRole('button', { name: 'Save', exact: true })).toBeDefined();
});
it('preserves a missing draft choice after same-area catalog clear and requires a new explicit choice', () => {
  catalog();
  const props = base();
  const view = render(<MoveConversation {...props} />);
  const ui = region(view);
  fireEvent.click(ui.getByRole('button', { name: 'Prototype', exact: true }));
  localStorage.clear();
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key: null, storageArea: localStorage })
    )
  );
  expect(ui.getByText(/Selected project is no longer available/)).toBeDefined();
  expect(
    (ui.getByRole('button', { name: 'Save', exact: true }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    ui.getByRole('button', { name: 'exact /id', exact: true })
  ).toBeDefined();
  expect(props.onMove).not.toHaveBeenCalled();
});
it('rereads current catalog before Save and never writes a removed destination', async () => {
  catalog();
  const props = base();
  const view = render(<MoveConversation {...props} />);
  const ui = region(view);
  fireEvent.click(ui.getByRole('button', { name: 'Prototype', exact: true }));
  localStorage.clear();
  await act(async () =>
    fireEvent.click(ui.getByRole('button', { name: 'Save', exact: true }))
  );
  expect(props.onMove).not.toHaveBeenCalled();
  expect(ui.getByText(/Selected project is no longer available/)).toBeDefined();
});
it('fails closed on malformed storage and Retry only reloads without repairing bytes or issuing a move', () => {
  localStorage.setItem(key, 'invalid');
  const props = base();
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const view = render(<MoveConversation {...props} />);
  const ui = region(view);
  expect(ui.getByRole('alert').textContent).toContain('Could not load');
  expect(
    (ui.getByRole('button', { name: 'Save', exact: true }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  fireEvent.click(ui.getByRole('button', { name: 'Retry', exact: true }));
  expect(write).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toBe('invalid');
  catalog();
  write.mockClear();
  fireEvent.click(ui.getByRole('button', { name: 'Retry', exact: true }));
  expect(write).not.toHaveBeenCalled();
  expect(props.onMove).not.toHaveBeenCalled();
  expect(ui.queryByRole('alert')).toBeNull();
});
it('ignores other storage areas/keys, retains drafts through renamed choices and does not act after unmount', () => {
  catalog();
  const props = base();
  const view = render(
    <StrictMode>
      <MoveConversation {...props} />
    </StrictMode>
  );
  const ui = region(view);
  fireEvent.click(ui.getByRole('button', { name: 'Prototype', exact: true }));
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      projects: [{ id: '__proto__', name: 'Updated name' }],
    })
  );
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key, storageArea: sessionStorage })
    )
  );
  expect(
    ui.getByRole('button', { name: 'Prototype', exact: true })
  ).toBeDefined();
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'other', storageArea: localStorage })
    )
  );
  expect(
    ui.getByRole('button', { name: 'Prototype', exact: true })
  ).toBeDefined();
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key, storageArea: localStorage })
    )
  );
  expect(
    ui
      .getByRole('button', { name: 'Updated name', exact: true })
      .getAttribute('aria-current')
  ).toBe('true');
  view.unmount();
  const read = vi.spyOn(Storage.prototype, 'getItem');
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key, storageArea: localStorage })
    )
  );
  expect(read).not.toHaveBeenCalled();
});
it('supports Escape/Cancel without writes while guarding composition/repeat/claimed events', () => {
  catalog();
  const props = base();
  const view = render(<MoveConversation {...props} />);
  const ui = region(view);
  const cancel = ui.getByRole('button', { name: 'Cancel', exact: true });
  fireEvent.keyDown(cancel, { key: 'Escape', isComposing: true });
  fireEvent.keyDown(cancel, { key: 'Escape', repeat: true });
  const claimed = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  claimed.preventDefault();
  cancel.dispatchEvent(claimed);
  expect(props.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(cancel, { key: 'Escape' });
  expect(props.onClose).toHaveBeenCalledWith(request);
  expect(props.onMove).not.toHaveBeenCalled();
});
it('restores a visible invoker or fallback only while the editor owns focus', async () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  const invoker = document.createElement('button');
  const fallback = document.createElement('input');
  const outside = document.createElement('button');
  document.body.append(invoker, fallback, outside);
  catalog();
  const props = {
    ...base(),
    request: { ...request, returnFocusTo: invoker },
    fallbackFocusTo: fallback,
  };
  const view = render(<MoveConversation {...props} />);
  let ui = region(view);
  fireEvent.click(ui.getByRole('button', { name: 'Cancel', exact: true }));
  await act(async () => {});
  expect(document.activeElement).toBe(invoker);
  view.rerender(
    <MoveConversation
      key={2}
      {...props}
      request={{ ...props.request, token: 2 }}
    />
  );
  ui = region(view);
  ui.getByRole('button', { name: 'Cancel', exact: true }).focus();
  invoker.hidden = true;
  fireEvent.click(ui.getByRole('button', { name: 'Cancel', exact: true }));
  await act(async () => {});
  expect(document.activeElement).toBe(fallback);
  view.rerender(
    <MoveConversation
      key={3}
      {...props}
      request={{ ...props.request, token: 3 }}
    />
  );
  ui = region(view);
  ui.getByRole('button', { name: 'Cancel', exact: true }).focus();
  fireEvent.click(ui.getByRole('button', { name: 'Cancel', exact: true }));
  outside.focus();
  await act(async () => {});
  expect(document.activeElement).toBe(outside);
  invoker.remove();
  fallback.remove();
  outside.remove();
});
it('honors shared pending/blocked state after remount without issuing another command', () => {
  catalog();
  const props = { ...base(), pending: true };
  const view = render(<MoveConversation {...props} />);
  const ui = region(view);
  fireEvent.click(ui.getByRole('button', { name: 'Prototype', exact: true }));
  fireEvent.submit(
    ui.getByRole('button', { name: 'Save', exact: true }).closest('form')!
  );
  expect(props.onMove).not.toHaveBeenCalled();
  view.rerender(<MoveConversation {...props} pending={false} blocked />);
  fireEvent.submit(
    ui.getByRole('button', { name: 'Save', exact: true }).closest('form')!
  );
  expect(props.onMove).not.toHaveBeenCalled();
  fireEvent.click(ui.getByRole('button', { name: 'Cancel', exact: true }));
  expect(props.onClose).toHaveBeenCalledWith(request);
});

it('blocks composed/repeated Enter and claimed submit events before any move', () => {
  catalog();
  const props = base();
  const view = render(<MoveConversation {...props} />);
  const ui = region(view);
  fireEvent.click(ui.getByRole('button', { name: 'Prototype', exact: true }));
  const save = ui.getByRole('button', { name: 'Save', exact: true });
  expect(fireEvent.keyDown(save, { key: 'Enter', isComposing: true })).toBe(
    false
  );
  expect(fireEvent.keyDown(save, { key: 'Enter', keyCode: 229 })).toBe(false);
  expect(fireEvent.keyDown(save, { key: 'Enter', repeat: true })).toBe(false);
  const submit = new Event('submit', { bubbles: true, cancelable: true });
  submit.preventDefault();
  fireEvent(save.closest('form')!, submit);
  expect(props.onMove).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
});
