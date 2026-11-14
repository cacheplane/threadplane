import { useState } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  type RenderResult,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ThreadList,
  type ThreadActionAdapter,
  type ThreadListItem,
  type ThreadListProps,
} from './index';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }),
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    function (this: HTMLElement) {
      return [this.getBoundingClientRect()] as unknown as DOMRectList;
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const threads: readonly ThreadListItem[] = [
  { id: 'a', title: 'Alpha', pinned: true },
  { id: 'b', title: 'Beta', pinned: true },
  { id: 'c', title: 'Gamma' },
];

/** A command whose promise the test settles by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const calls: unknown[][] = [];
  const run = vi.fn((...args: unknown[]) => {
    calls.push(args);
    return new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
  });
  return {
    run,
    calls,
    resolve: () => act(async () => resolve()),
    reject: () => act(async () => reject(new Error('refused'))),
  };
}

function open(view: RenderResult, title: string) {
  fireEvent.click(
    view.getByRole('button', { name: `More actions for ${title}` })
  );
}
function items(view: RenderResult) {
  return view.getAllByRole('menuitem').map((item) => item.textContent);
}
function choose(view: RenderResult, title: string, item: string) {
  open(view, title);
  fireEvent.click(view.getByRole('menuitem', { name: item }));
}
function rows(view: RenderResult) {
  return Array.from(
    view.container.querySelectorAll('.tp-thread-list__button')
  ).map((button) => button.getAttribute('title'));
}
function list(
  actions: ThreadActionAdapter | null,
  props: Partial<ThreadListProps> = {}
) {
  return render(
    <ThreadList
      threads={threads}
      onSelect={() => undefined}
      actions={actions}
      {...props}
    />
  );
}

describe('ThreadList built-in actions', () => {
  it('adds no menu without commands', () => {
    for (const actions of [null, {}]) {
      const view = list(actions);
      expect(view.queryByRole('button', { name: /More actions/ })).toBeNull();
      expect(
        view.container.querySelector('.tp-thread-list__item--actions')
      ).toBeNull();
      view.unmount();
    }
  });

  it('offers the supplied commands that apply to the row', () => {
    const all: ThreadActionAdapter = {
      rename: vi.fn(),
      pin: vi.fn(),
      unpin: vi.fn(),
      archive: vi.fn(),
      unarchive: vi.fn(),
      delete: vi.fn(),
      moveToProject: vi.fn(),
      reorderPinned: vi.fn(),
    };
    const view = list(all, { projects: [] });
    open(view, 'Alpha');
    expect(items(view)).toEqual([
      'Rename',
      'Unpin',
      'Move down',
      'Move to project',
      'Archive',
      'Delete',
    ]);
    open(view, 'Gamma');
    expect(items(view)).toEqual([
      'Rename',
      'Pin',
      'Move to project',
      'Archive',
      'Delete',
    ]);
    expect(
      view
        .getByRole('menuitem', { name: 'Delete' })
        .classList.contains('tp-overflow-menu__item--destructive')
    ).toBe(true);
    view.unmount();

    const withoutProjects = list(all);
    open(withoutProjects, 'Gamma');
    expect(items(withoutProjects)).not.toContain('Move to project');
    withoutProjects.unmount();

    const archived = list(all, { mode: 'archived' });
    open(archived, 'Alpha');
    expect(items(archived)).toEqual(['Unarchive', 'Delete']);
  });

  it('renames inline, shows the new title while saving, and returns focus', async () => {
    const rename = deferred();
    const view = list({ rename: rename.run });
    choose(view, 'Gamma', 'Rename');
    const input = view.getByRole('textbox', { name: 'Conversation title' });
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe('Gamma');
    expect(rows(view)).toEqual(['Alpha', 'Beta']);
    fireEvent.change(input, { target: { value: '  Delta ' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(rename.calls).toEqual([['c', 'Delta']]);
    expect(rows(view)).toEqual(['Alpha', 'Beta', 'Delta']);
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'More actions for Delta' })
    );
    await rename.reject();
    expect(rows(view)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('cancels a rename without calling the command', () => {
    const rename = vi.fn();
    const view = list({ rename });
    choose(view, 'Gamma', 'Rename');
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' });
    expect(view.queryByRole('textbox')).toBeNull();
    expect(rename).not.toHaveBeenCalled();
    choose(view, 'Gamma', 'Rename');
    fireEvent.submit(view.getByRole('textbox').closest('form') as HTMLElement);
    expect(rename).not.toHaveBeenCalled();
    expect(rows(view)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('confirms before deleting, hides the row, and restores it on rejection', async () => {
    const remove = deferred();
    const view = list({ delete: remove.run });
    choose(view, 'Beta', 'Delete');
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.textContent).toContain('Delete conversation?');
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(remove.run).not.toHaveBeenCalled();
    expect(rows(view)).toEqual(['Alpha', 'Beta', 'Gamma']);

    choose(view, 'Beta', 'Delete');
    fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    expect(remove.calls).toEqual([['b']]);
    expect(rows(view)).toEqual(['Alpha', 'Gamma']);
    // The dialog gives focus up after it closes; the next row then takes it.
    await act(() => new Promise<void>((done) => setTimeout(done, 0)));
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Gamma' })
    );
    await remove.reject();
    expect(rows(view)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('moves focus to the next row when the focused row leaves', async () => {
    const archive = deferred();
    const view = list({ archive: archive.run });
    open(view, 'Beta');
    const item = view.getByRole('menuitem', { name: 'Archive' });
    item.focus();
    fireEvent.click(item);
    expect(archive.calls).toEqual([['b']]);
    expect(rows(view)).toEqual(['Alpha', 'Gamma']);
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Gamma' })
    );
    await archive.resolve();
  });

  it('restores archived rows and runs pin commands without hiding', async () => {
    const unarchive = deferred();
    const archived = list({ unarchive: unarchive.run }, { mode: 'archived' });
    choose(archived, 'Gamma', 'Unarchive');
    expect(unarchive.calls).toEqual([['c']]);
    expect(rows(archived)).toEqual(['Alpha', 'Beta']);
    await unarchive.resolve();
    expect(rows(archived)).toEqual(['Alpha', 'Beta', 'Gamma']);
    archived.unmount();

    const pin = vi.fn();
    const unpin = vi.fn(() => Promise.reject(new Error('refused')));
    const view = list({ pin, unpin });
    choose(view, 'Gamma', 'Pin');
    choose(view, 'Alpha', 'Unpin');
    await act(async () => undefined);
    expect(pin.mock.calls).toEqual([['c']]);
    expect(unpin.mock.calls).toEqual([['a']]);
    expect(rows(view)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('reorders pinned rows at once and puts them back on rejection', async () => {
    const reorder = deferred();
    const view = list({ reorderPinned: reorder.run });
    expect(
      view.queryByRole('button', { name: 'More actions for Gamma' })
    ).toBeNull();
    choose(view, 'Alpha', 'Move down');
    expect(reorder.calls).toEqual([['a', null]]);
    expect(rows(view)).toEqual(['Beta', 'Alpha', 'Gamma']);
    await reorder.reject();
    expect(rows(view)).toEqual(['Alpha', 'Beta', 'Gamma']);
    choose(view, 'Beta', 'Move up');
    expect(reorder.calls[1]).toEqual(['b', 'a']);
    expect(rows(view)).toEqual(['Beta', 'Alpha', 'Gamma']);
    await reorder.resolve();
  });

  it('swaps the open menu to project destinations', () => {
    const moveToProject = vi.fn();
    const view = list(
      { moveToProject },
      {
        projects: [
          { id: 'none', name: 'Research' },
          { id: 'p2', name: '' },
        ],
      }
    );
    choose(view, 'Gamma', 'Move to project');
    expect(items(view)).toEqual(['No project', 'Research', 'p2']);
    expect(document.activeElement).toBe(
      view.getByRole('menuitem', { name: 'No project' })
    );
    fireEvent.click(view.getByRole('menuitem', { name: 'Research' }));
    expect(view.queryByRole('menu')).toBeNull();
    choose(view, 'Gamma', 'Move to project');
    fireEvent.click(view.getByRole('menuitem', { name: 'No project' }));
    expect(moveToProject.mock.calls).toEqual([
      ['c', 'none'],
      ['c', null],
    ]);
    open(view, 'Gamma');
    expect(items(view)).toEqual(['Move to project']);
  });

  it('opens the menu from a row context request and returns focus to the row', () => {
    const view = list({ archive: vi.fn() });
    const row = view.getByRole('button', { name: 'Gamma' });
    row.focus();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 50,
      button: 2,
    });
    act(() => {
      row.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(items(view)).toEqual(['Archive']);
    fireEvent.keyDown(view.getByRole('menu'), { key: 'Escape' });
    expect(view.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it('leaves context requests to the application when it handles them', () => {
    const onContextMenu = vi.fn();
    const view = list({ archive: vi.fn() }, { onContextMenu });
    fireEvent.contextMenu(view.getByRole('button', { name: 'Gamma' }));
    expect(onContextMenu).toHaveBeenCalledOnce();
    expect(view.queryByRole('menu')).toBeNull();
  });

  it('keeps application actions beside the built-in menu and skips custom rows', () => {
    const view = list(
      { archive: vi.fn() },
      { renderActions: (thread) => <button>Share {thread.id}</button> }
    );
    const share = view.getByRole('button', { name: 'Share c' });
    const more = view.getByRole('button', { name: 'More actions for Gamma' });
    expect(share.parentElement).toBe(more.parentElement);
    view.unmount();

    const custom = list(
      { archive: vi.fn(), delete: vi.fn() },
      { renderItem: (thread) => <span>{thread.id}</span> }
    );
    expect(custom.queryByRole('button')).toBeNull();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('follows the supplied rows once the application updates them', async () => {
    const remove = deferred();
    function Owner() {
      const [current, setCurrent] = useState(threads);
      return (
        <ThreadList
          threads={current}
          onSelect={() => undefined}
          actions={{
            delete: async (id) => {
              await remove.run(id);
              setCurrent((all) => all.filter((thread) => thread.id !== id));
            },
          }}
        />
      );
    }
    const view = render(<Owner />);
    choose(view, 'Alpha', 'Delete');
    fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    await remove.resolve();
    expect(rows(view)).toEqual(['Beta', 'Gamma']);
  });
});
