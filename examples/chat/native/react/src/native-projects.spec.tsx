import { StrictMode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeProjects } from './native-projects';
import { PROJECT_CATALOG_KEY as key } from './project-catalog';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
const props = {
  rows: [{ id: 'a', title: 'Alpha', projectId: ' exact /id ' }],
  projectId: null,
  onSelect: vi.fn(),
};
it('imports an exact loaded ID on rename and keeps the captured target through selection/storage changes', () => {
  const select = vi.fn();
  const view = render(<NativeProjects {...props} onSelect={select} />);
  const trigger = view.getByRole('button', {
    name: /^More actions for project/,
  });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(view.getByRole('menuitem', { name: 'Rename' }));
  const input = view.getByRole('textbox', { name: 'Project name' });
  fireEvent.change(input, { target: { value: ' <Local label> ' } });
  view.rerender(
    <NativeProjects {...props} projectId="another" onSelect={select} />
  );
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      projects: [{ id: 'other', name: 'Other tab' }],
    })
  );
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key, storageArea: localStorage })
    )
  );
  expect((input as HTMLInputElement).value).toBe(' <Local label> ');
  fireEvent.click(view.getByRole('button', { name: 'Save', exact: true }));
  expect(JSON.parse(localStorage.getItem(key) as string).projects).toEqual([
    { id: 'other', name: 'Other tab' },
    { id: ' exact /id ', name: '<Local label>' },
  ]);
  expect(select).not.toHaveBeenCalled();
});
it('retains failed-save draft and target, blocks writes until explicit Retry, and preserves latest catalog', () => {
  const view = render(<NativeProjects {...props} />);
  fireEvent.click(
    view.getByRole('button', { name: /^More actions for project/ })
  );
  fireEvent.click(view.getByRole('menuitem', { name: 'Rename' }));
  const input = view.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Kept name' } });
  const original = Storage.prototype.setItem;
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('quota');
    });
  fireEvent.click(view.getByRole('button', { name: 'Save', exact: true }));
  expect((input as HTMLInputElement).value).toBe('Kept name');
  expect(
    (
      view.getByRole('button', {
        name: 'Save',
        exact: true,
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  write.mockImplementation(original);
  localStorage.setItem(
    key,
    JSON.stringify({ version: 1, projects: [{ id: 'other', name: 'Latest' }] })
  );
  fireEvent.click(view.getByRole('button', { name: 'Retry project storage' }));
  expect((input as HTMLInputElement).value).toBe('Kept name');
  fireEvent.click(view.getByRole('button', { name: 'Save', exact: true }));
  expect(JSON.parse(localStorage.getItem(key) as string).projects).toHaveLength(
    2
  );
});
it('does not overwrite malformed catalog bytes and recovers without losing an active draft', () => {
  const view = render(<NativeProjects {...props} />);
  fireEvent.click(
    view.getByRole('button', { name: 'New project', exact: true })
  );
  const input = view.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Recover me' } });
  localStorage.setItem(key, '{broken');
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key, storageArea: localStorage })
    )
  );
  expect(localStorage.getItem(key)).toBe('{broken');
  expect(
    (
      view.getByRole('button', {
        name: 'Create',
        exact: true,
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect((input as HTMLInputElement).value).toBe('Recover me');
  localStorage.removeItem(key);
  fireEvent.click(view.getByRole('button', { name: 'Retry project storage' }));
  expect((input as HTMLInputElement).value).toBe('Recover me');
  fireEvent.click(view.getByRole('button', { name: 'Cancel', exact: true }));
  expect(localStorage.getItem(key)).toBeNull();
});
it('rejects a generated ID collision with a loaded-only project without writing or selecting', () => {
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);
  const select = vi.fn();
  const view = render(
    <NativeProjects
      rows={[{ id: 'a', title: 'Alpha', projectId: id }]}
      projectId={null}
      onSelect={select}
    />
  );
  fireEvent.click(
    view.getByRole('button', { name: 'New project', exact: true })
  );
  fireEvent.change(view.getByRole('textbox'), {
    target: { value: 'Collision' },
  });
  fireEvent.click(view.getByRole('button', { name: 'Create', exact: true }));
  expect(view.getByRole('alert').textContent).toContain('already exists');
  expect(localStorage.getItem(key)).toBeNull();
  expect(select).not.toHaveBeenCalled();
});
it('ignores unrelated storage updates, refreshes clear events, and leaves a missing selection intact', () => {
  localStorage.setItem(
    key,
    JSON.stringify({ version: 1, projects: [{ id, name: '<Saved>' }] })
  );
  const select = vi.fn();
  const view = render(
    <NativeProjects rows={[]} projectId={id} onSelect={select} />
  );
  expect(
    within(view.getByRole('list', { name: 'Projects' })).getByRole('button', {
      name: '<Saved>',
      exact: true,
    })
  ).toBeTruthy();
  localStorage.removeItem(key);
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'unrelated',
        storageArea: localStorage,
      })
    )
  );
  expect(
    view.getByRole('button', { name: '<Saved>', exact: true })
  ).toBeTruthy();
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key: null, storageArea: localStorage })
    )
  );
  expect(
    view.queryByRole('button', { name: '<Saved>', exact: true })
  ).toBeNull();
  expect(view.getByText(`Selected project: ${id}`)).toBeTruthy();
  expect(select).not.toHaveBeenCalled();
});

it('restores only editor-owned focus and removes the storage listener under StrictMode', async () => {
  const view = render(
    <StrictMode>
      <NativeProjects {...props} />
    </StrictMode>
  );
  const trigger = view.getByRole('button', {
    name: 'New project',
    exact: true,
  });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' });
  await act(async () => {
    await Promise.resolve();
  });
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  const other = document.createElement('button');
  other.textContent = 'Other';
  document.body.append(other);
  fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' });
  other.focus();
  await act(async () => {
    await Promise.resolve();
  });
  expect(document.activeElement).toBe(other);
  other.remove();
  const read = vi.spyOn(Storage.prototype, 'getItem');
  view.unmount();
  const calls = read.mock.calls.length;
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key, storageArea: localStorage })
    )
  );
  expect(read.mock.calls.length).toBe(calls);
});
