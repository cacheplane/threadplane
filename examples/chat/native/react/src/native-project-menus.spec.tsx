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

const rows = [{ id: 'thread', title: 'Thread', projectId: ' exact /id ' }];
const select = vi.fn();
const props = { rows, projectId: null, onSelect: select };
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      projects: [
        { id: ' exact /id ', name: '<Literal>' },
        { id: '__proto__', name: 'Other' },
      ],
    })
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  select.mockClear();
});
function trigger(
  view: ReturnType<typeof render>,
  name = '<Literal> ( exact /id )'
) {
  return view.getByRole('button', {
    name: `More actions for project ${name}`,
    exact: true,
  });
}
it('opens one contextual literal menu and Escape preserves selection, storage and editor draft', () => {
  const view = render(<NativeProjects {...props} />);
  fireEvent.click(view.getByRole('button', { name: 'New project' }));
  fireEvent.change(view.getByRole('textbox'), {
    target: { value: 'Kept draft' },
  });
  const before = localStorage.getItem(key);
  fireEvent.keyDown(trigger(view), { key: 'ArrowDown' });
  expect(view.getAllByRole('menu')).toHaveLength(1);
  expect(view.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  expect(document.activeElement).toBe(
    view.getByRole('menuitem', { name: 'Rename' })
  );
  fireEvent.click(trigger(view, 'Other (__proto__)'));
  expect(view.getAllByRole('menu')).toHaveLength(1);
  expect(view.getByRole('menu').getAttribute('aria-labelledby')).toBe(
    trigger(view, 'Other (__proto__)').id
  );
  fireEvent.keyDown(view.getByRole('menu'), { key: 'Escape' });
  expect(document.activeElement).toBe(trigger(view, 'Other (__proto__)'));
  expect(view.queryByRole('menu')).toBeNull();
  expect((view.getByRole('textbox') as HTMLInputElement).value).toBe(
    'Kept draft'
  );
  expect(localStorage.getItem(key)).toBe(before);
  expect(select).not.toHaveBeenCalled();
});
it.each(['Cancel', 'Save'])(
  'returns Rename %s focus to the persistent trigger and writes the exact target',
  async (command) => {
    const view = render(<NativeProjects {...props} />);
    const invoker = trigger(view);
    fireEvent.click(invoker);
    fireEvent.click(view.getByRole('menuitem', { name: 'Rename' }));
    const input = view.getByRole('textbox');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'Changed' } });
    const button = view.getByRole('button', { name: command, exact: true });
    button.focus();
    fireEvent.click(button);
    await act(async () => {});
    expect(document.activeElement).toBe(invoker);
    expect(invoker.isConnected).toBe(true);
    expect(JSON.parse(localStorage.getItem(key)!).projects[0]).toEqual({
      id: ' exact /id ',
      name: command === 'Save' ? 'Changed' : '<Literal>',
    });
  }
);
it('checks live deletion capability and returns Delete Cancel focus to the row trigger', async () => {
  let allowed = false;
  const deletion = {
    canDeleteProject: vi.fn(() => allowed),
    deleteProject: vi.fn(async () => true),
  };
  const view = render(<NativeProjects {...props} deletion={deletion} />);
  fireEvent.click(trigger(view));
  expect(
    (view.getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  allowed = true;
  view.rerender(<NativeProjects {...props} deletion={deletion} />);
  const item = view.getByRole('menuitem', { name: 'Delete' });
  expect((item as HTMLButtonElement).disabled).toBe(false);
  allowed = false;
  fireEvent.click(item);
  expect(view.queryByRole('alertdialog')).toBeNull();
  expect(deletion.deleteProject).not.toHaveBeenCalled();
  allowed = true;
  fireEvent.click(trigger(view));
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
  const cancel = within(view.getByRole('alertdialog')).getByRole('button', {
    name: 'Cancel',
  });
  expect(document.activeElement).toBe(cancel);
  fireEvent.click(cancel);
  await act(async () => {});
  expect(document.activeElement).toBe(trigger(view));
});
it.each(['selection', 'rows', 'owner', 'storage', 'problem'] as const)(
  'expires a menu on %s changes without A-B-A revival or stale dispatch',
  (change) => {
    const deletion = {
      canDeleteProject: () => true,
      deleteProject: vi.fn(async () => true),
    };
    const view = render(<NativeProjects {...props} deletion={deletion} />);
    fireEvent.click(trigger(view));
    const stale = view.getByRole('menuitem', { name: 'Rename' });
    if (change === 'storage' || change === 'problem') {
      localStorage.setItem(
        key,
        change === 'problem'
          ? '{broken'
          : JSON.stringify({ version: 1, projects: [] })
      );
      act(() =>
        window.dispatchEvent(
          new StorageEvent('storage', { key, storageArea: localStorage })
        )
      );
    } else {
      view.rerender(
        <NativeProjects
          {...props}
          projectId={change === 'selection' ? 'other' : null}
          rows={change === 'rows' ? [] : rows}
          deletion={change === 'owner' ? { ...deletion } : deletion}
        />
      );
      view.rerender(<NativeProjects {...props} deletion={deletion} />);
    }
    expect(view.queryByRole('menu')).toBeNull();
    fireEvent.click(stale);
    expect(view.queryByRole('textbox')).toBeNull();
    expect(select).not.toHaveBeenCalled();
    if (change === 'problem')
      expect(
        (
          view.getByRole('button', {
            name: /^More actions for project/,
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
  }
);

it('keeps a newer menu open through A-B-A row switches and repeated same-scope renders', () => {
  const view = render(<NativeProjects {...props} />);
  fireEvent.click(trigger(view));
  const oldRename = view.getByRole('menuitem', { name: 'Rename' });
  fireEvent.click(trigger(view, 'Other (__proto__)'));
  fireEvent.click(trigger(view));
  view.rerender(<NativeProjects {...props} />);
  fireEvent.click(oldRename);
  expect(view.getAllByRole('menu')).toHaveLength(1);
  expect(view.getByRole('menu').getAttribute('aria-labelledby')).toBe(
    trigger(view).id
  );
  expect(view.queryByRole('textbox')).toBeNull();
});

it('blocks all row menus while deletion is pending and never revives an earlier menu', async () => {
  let finish!: (value: boolean) => void;
  const promise = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const deletion = {
    canDeleteProject: () => true,
    deleteProject: vi.fn(() => promise),
  };
  const view = render(<NativeProjects {...props} deletion={deletion} />);
  fireEvent.click(trigger(view));
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
  const confirm = within(view.getByRole('alertdialog')).getByRole('button', {
    name: 'Delete project',
  });
  confirm.focus();
  fireEvent.click(confirm);
  expect((trigger(view) as HTMLButtonElement).disabled).toBe(true);
  expect(
    (trigger(view, 'Other (__proto__)') as HTMLButtonElement).disabled
  ).toBe(true);
  fireEvent.click(trigger(view));
  expect(view.queryByRole('menu')).toBeNull();
  expect(deletion.deleteProject).toHaveBeenCalledWith(' exact /id ');
  await act(async () => {
    finish(false);
    await promise;
  });
  expect((trigger(view) as HTMLButtonElement).disabled).toBe(false);
  expect(view.queryByRole('menu')).toBeNull();
});

it('drops a menu when its loaded-only source disappears', () => {
  localStorage.removeItem(key);
  const view = render(<NativeProjects {...props} />);
  fireEvent.click(
    view.getByRole('button', { name: /^More actions for project/ })
  );
  const stale = view.getByRole('menuitem', { name: 'Rename' });
  view.rerender(<NativeProjects {...props} rows={[]} />);
  fireEvent.click(stale);
  expect(view.queryByRole('menu')).toBeNull();
  expect(view.queryByRole('textbox')).toBeNull();
});

it.each(['outside', 'removed', 'disabled'] as const)(
  'does not steal focus when the Rename invoker is %s at cancellation',
  async (condition) => {
    const view = render(
      <>
        <button>Outside</button>
        <NativeProjects {...props} />
      </>
    );
    fireEvent.click(trigger(view));
    fireEvent.click(view.getByRole('menuitem', { name: 'Rename' }));
    const input = view.getByRole('textbox');
    const outside = view.getByRole('button', { name: 'Outside' });
    if (condition === 'outside') {
      fireEvent.keyDown(input, { key: 'Escape' });
      outside.focus();
    } else {
      if (condition === 'removed') {
        localStorage.setItem(key, JSON.stringify({ version: 1, projects: [] }));
        act(() =>
          window.dispatchEvent(
            new StorageEvent('storage', { key, storageArea: localStorage })
          )
        );
        view.rerender(
          <>
            <button>Outside</button>
            <NativeProjects {...props} rows={[]} />
          </>
        );
      } else {
        localStorage.setItem(key, '{broken');
        act(() =>
          window.dispatchEvent(
            new StorageEvent('storage', { key, storageArea: localStorage })
          )
        );
      }
      fireEvent.keyDown(input, { key: 'Escape' });
    }
    await act(async () => {});
    expect(view.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(
      condition === 'outside' ? outside : document.body
    );
  }
);
