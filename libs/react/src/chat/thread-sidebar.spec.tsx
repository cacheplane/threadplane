import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentSession,
  AgentSnapshot,
  ThreadDirectory,
  ThreadDirectorySnapshot,
} from '@threadplane/core';
import { ThreadSidebar } from './index';

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

const loaded: ThreadDirectorySnapshot = Object.freeze({
  threads: Object.freeze([
    {
      id: 'a',
      title: 'Alpha',
      pinned: true,
      archived: false,
      projectId: null,
    },
    { id: 'b', title: 'Beta', pinned: false, archived: false, projectId: null },
  ]),
  archived: Object.freeze([]),
  projects: Object.freeze([{ id: 'p', name: 'Research' }]),
  status: 'idle',
});

type Fake = ThreadDirectory & {
  set(next: ThreadDirectorySnapshot): void;
  readonly refresh: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
};

/** A hand-written directory; `omit` drops optional commands. */
function fakeDirectory(
  initial: ThreadDirectorySnapshot = loaded,
  omit: readonly (keyof ThreadDirectory)[] = []
): Fake {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const directory: Record<string, unknown> = {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    refresh: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ id: 'new' })),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    setArchived: vi.fn(async () => undefined),
    setPinned: vi.fn(async () => undefined),
    reorderPinned: vi.fn(async () => undefined),
    setProject: vi.fn(async () => undefined),
    createProject: vi.fn(async () => ({ id: 'q' })),
    renameProject: vi.fn(async () => undefined),
    removeProject: vi.fn(async () => undefined),
    dispose: vi.fn(),
    set(next: ThreadDirectorySnapshot) {
      snapshot = next;
      for (const notify of [...listeners]) notify();
    },
  };
  for (const key of omit) delete directory[key];
  return directory as unknown as Fake;
}

function fakeSession(status: AgentSnapshot['status']) {
  let current = { status } as AgentSnapshot;
  const listeners = new Set<() => void>();
  const session: Pick<AgentSession, 'getSnapshot' | 'subscribe'> = {
    getSnapshot: () => current,
    subscribe: (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
  };
  return {
    session,
    listeners,
    set(next: AgentSnapshot['status']) {
      current = { status: next } as AgentSnapshot;
      for (const notify of [...listeners]) notify();
    },
  };
}

function menuItems(view: ReturnType<typeof render>, title: string) {
  fireEvent.click(
    view.getByRole('button', { name: `More actions for ${title}` })
  );
  return view.getAllByRole('menuitem').map((item) => item.textContent);
}

describe('ThreadSidebar', () => {
  it('lists threads from the directory and refreshes on mount', () => {
    const directory = fakeDirectory();
    const view = render(
      <ThreadSidebar directory={directory} onSelect={vi.fn()} />
    );
    expect(view.getByRole('button', { name: 'Alpha' })).not.toBeNull();
    expect(view.getByRole('button', { name: 'Beta' })).not.toBeNull();
    expect(directory.refresh).toHaveBeenCalledTimes(1);
    act(() => directory.set({ ...loaded, threads: [loaded.threads[1]] }));
    expect(view.queryByRole('button', { name: 'Alpha' })).toBeNull();
  });

  it('hides menu actions the directory lacks', () => {
    const full = render(
      <ThreadSidebar directory={fakeDirectory()} onSelect={vi.fn()} />
    );
    expect(menuItems(full, 'Beta')).toContain('Delete');
    cleanup();
    const view = render(
      <ThreadSidebar
        directory={fakeDirectory(loaded, ['remove', 'setPinned'])}
        onSelect={vi.fn()}
      />
    );
    const items = menuItems(view, 'Beta');
    expect(items).not.toContain('Delete');
    expect(items).not.toContain('Pin');
    expect(items).toContain('Rename');
  });

  it('turns built-ins off with features', () => {
    const directory = fakeDirectory();
    const view = render(
      <ThreadSidebar
        directory={directory}
        onSelect={vi.fn()}
        features={{ projects: false, rename: false, archive: false }}
      />
    );
    expect(view.queryByRole('heading', { name: 'Projects' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Research' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Archived' })).toBeNull();
    const items = menuItems(view, 'Beta');
    expect(items).not.toContain('Rename');
    expect(items).not.toContain('Archive');
    expect(items).not.toContain('Move to project');
    expect(items).toContain('Delete');
  });

  it('shows the load error and retries', () => {
    const directory = fakeDirectory({
      threads: [],
      archived: [],
      status: 'error',
      error: {
        kind: 'network',
        message: 'offline',
      } as unknown as NonNullable<ThreadDirectorySnapshot['error']>,
    });
    const view = render(
      <ThreadSidebar
        directory={directory}
        onSelect={vi.fn()}
        labels={{ loadError: 'Could not load chats', retry: 'Try again' }}
      />
    );
    const alert = view.getByRole('alert');
    expect(alert.textContent).toContain('Could not load chats');
    expect(view.queryByText('No conversations yet.')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Try again' }));
    expect(directory.refresh).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state only once loaded', async () => {
    const directory = fakeDirectory({
      threads: [],
      archived: [],
      status: 'loading',
    });
    const view = render(
      <ThreadSidebar directory={directory} onSelect={vi.fn()} />
    );
    expect(view.queryByText('No conversations yet.')).toBeNull();
    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe(
      'true'
    );
    await act(async () =>
      directory.set({ threads: [], archived: [], status: 'idle' })
    );
    expect(view.getByText('No conversations yet.')).not.toBeNull();
    expect(view.container.firstElementChild?.hasAttribute('aria-busy')).toBe(
      false
    );
  });

  it('waits for the first refresh before showing the empty state', async () => {
    // A fresh directory reports idle with no threads before it has loaded.
    const directory = fakeDirectory({ threads: [], archived: [], status: 'idle' });
    let finish = () => undefined as void;
    directory.refresh.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const view = render(
      <ThreadSidebar directory={directory} onSelect={vi.fn()} />
    );
    expect(view.queryByText('No conversations yet.')).toBeNull();
    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe(
      'true'
    );
    await act(async () => finish());
    expect(view.getByText('No conversations yet.')).not.toBeNull();
    expect(view.container.firstElementChild?.hasAttribute('aria-busy')).toBe(
      false
    );
  });

  it('filters threads by the selected project', async () => {
    const directory = fakeDirectory({
      threads: [
        { id: 'a', title: 'Alpha', pinned: false, archived: false, projectId: 'p' },
        { id: 'b', title: 'Beta', pinned: false, archived: false, projectId: null },
      ],
      archived: [
        { id: 'c', title: 'Gamma', pinned: false, archived: true, projectId: 'p' },
        { id: 'd', title: 'Delta', pinned: false, archived: true, projectId: 'q' },
      ],
      projects: [
        { id: 'p', name: 'Research' },
        { id: 'q', name: 'Travel' },
      ],
      status: 'idle',
    });
    const onProjectSelect = vi.fn();
    const view = render(
      <ThreadSidebar
        directory={directory}
        onSelect={vi.fn()}
        selectedProjectId="p"
        onProjectSelect={onProjectSelect}
      />
    );
    await act(async () => undefined);
    fireEvent.click(view.getByRole('button', { name: 'Archived' }));
    expect(view.queryByRole('button', { name: 'Alpha' })).not.toBeNull();
    expect(view.queryByRole('button', { name: 'Beta' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Gamma' })).not.toBeNull();
    expect(view.queryByRole('button', { name: 'Delta' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Travel' }));
    expect(onProjectSelect).toHaveBeenCalledWith('q');

    view.rerender(
      <ThreadSidebar
        directory={directory}
        onSelect={vi.fn()}
        selectedProjectId={null}
      />
    );
    for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta'])
      expect(view.queryByRole('button', { name })).not.toBeNull();
  });

  it('refreshes after a run ends', () => {
    const directory = fakeDirectory();
    const run = fakeSession('running');
    const view = render(
      <ThreadSidebar
        directory={directory}
        session={run.session}
        onSelect={vi.fn()}
      />
    );
    expect(directory.refresh).toHaveBeenCalledTimes(1);
    act(() => run.set('idle'));
    expect(directory.refresh).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(run.listeners.size).toBe(0);
    expect(directory.dispose).not.toHaveBeenCalled();
  });

  it('reports the active thread removed', async () => {
    const directory = fakeDirectory();
    const onActiveRemoved = vi.fn();
    const view = render(
      <ThreadSidebar
        directory={directory}
        activeThreadId="b"
        onSelect={vi.fn()}
        onActiveRemoved={onActiveRemoved}
      />
    );
    fireEvent.click(
      view.getByRole('button', { name: 'More actions for Beta' })
    );
    fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    });
    expect(directory.remove).toHaveBeenCalledWith('b');
    expect(onActiveRemoved).toHaveBeenCalledTimes(1);
  });

  it('does not report a failed or inactive removal', async () => {
    const directory = fakeDirectory();
    (directory.remove as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('refused')
    );
    const onActiveRemoved = vi.fn();
    const view = render(
      <ThreadSidebar
        directory={directory}
        activeThreadId="b"
        onSelect={vi.fn()}
        onActiveRemoved={onActiveRemoved}
      />
    );
    for (const title of ['Beta', 'Alpha']) {
      fireEvent.click(
        view.getByRole('button', { name: `More actions for ${title}` })
      );
      fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: 'Delete' }));
      });
    }
    expect(directory.remove).toHaveBeenCalledTimes(2);
    expect(onActiveRemoved).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: 'Beta' })).not.toBeNull();
  });

  it('creates and selects a new chat by default', async () => {
    const directory = fakeDirectory();
    const onSelect = vi.fn();
    const view = render(
      <ThreadSidebar directory={directory} onSelect={onSelect} />
    );
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'New chat' }));
    });
    expect(directory.create).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls).toEqual([['new']]);
  });

  it('omits New chat without a handler or create command', () => {
    const view = render(
      <ThreadSidebar
        directory={fakeDirectory(loaded, ['create'])}
        onSelect={vi.fn()}
      />
    );
    expect(view.queryByRole('button', { name: 'New chat' })).toBeNull();
  });

  it('renders before and after sections and a custom row', () => {
    const run = vi.fn();
    const view = render(
      <ThreadSidebar
        directory={fakeDirectory()}
        onSelect={vi.fn()}
        activeThreadId="a"
        before={<p>Before</p>}
        after={<p>After</p>}
        renderThread={(thread, isActive) => (
          <span>{`row ${thread.title}${isActive ? ' active' : ''}`}</span>
        )}
        labels={{ recent: 'Chats' }}
      />
    );
    const text = view.container.textContent ?? '';
    expect(text.indexOf('Before')).toBeLessThan(text.indexOf('Chats'));
    expect(text.indexOf('Chats')).toBeLessThan(text.indexOf('After'));
    expect(view.getByText('row Alpha active')).not.toBeNull();
    expect(view.getByText('row Beta')).not.toBeNull();
    cleanup();
    const extra = render(
      <ThreadSidebar
        directory={fakeDirectory()}
        onSelect={vi.fn()}
        extraActions={[{ id: 'share', label: 'Share', run }]}
      />
    );
    fireEvent.click(
      extra.getByRole('button', { name: 'More actions for Beta' })
    );
    fireEvent.click(extra.getByRole('menuitem', { name: 'Share' }));
    expect(run).toHaveBeenCalledWith('b');
  });
});
