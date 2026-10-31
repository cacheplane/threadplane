import { useEffect, useLayoutEffect } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './app';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import type { ThreadRow } from '../../shared/contracts';
import type { HistorySearchPaletteProps } from '@threadplane/react/chat';
import { useLoadedConversationSearch } from './use-loaded-conversation-search';

const initialRows: readonly ThreadRow[] = [
  { id: 'a', title: 'Alpha notes', projectId: 'Alpha project' },
  { id: 'b', title: 'Beta notes', projectId: 'Beta project', archived: true },
  { id: 'c', title: 'Other notes', projectId: 'Beta project' },
];
function setup(rows = initialRows) {
  const fixture = applicationFixture();
  let currentRows = rows;
  let held: Promise<{ kind: 'ready'; value: readonly ThreadRow[] }> | null =
    null;
  const io = { lists: 0, gets: [] as string[], creates: 0 };
  const owner = createReactApplication({
    ...fixture.options,
    directory: {
      async list() {
        io.lists++;
        return held ?? { kind: 'ready', value: currentRows };
      },
      async get(id) {
        io.gets.push(id);
        return {
          kind: 'ready',
          value: currentRows.find((row) => row.id === id) ?? { id, title: id },
        };
      },
      async create() {
        io.creates++;
        return { kind: 'failed' };
      },
    },
  });
  const select = vi.fn((id: string) => owner.select(id));
  const application = Object.freeze({ ...owner, select });
  return {
    fixture,
    owner,
    application,
    select,
    io,
    holdList() {
      let release!: (value: {
        kind: 'ready';
        value: readonly ThreadRow[];
      }) => void;
      held = new Promise((resolve) => {
        release = resolve;
      });
      return (value: readonly ThreadRow[]) => {
        currentRows = value;
        release({ kind: 'ready', value });
        held = null;
      };
    },
  };
}
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
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
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
async function start(owner: ReturnType<typeof setup>['owner']) {
  owner.start();
  await waitFor(() =>
    expect(owner.getSnapshot().selection.status).toBe('ready')
  );
  await waitFor(() => expect(owner.getSnapshot().list.status).toBe('ready'));
}

it('searches loaded titles across projects and archives without changing the retained directory, draft, URL or owner', async () => {
  const s = setup();
  try {
    await start(s.owner);
    const view = render(<App application={s.application} />);
    const filter = view.getByRole('searchbox') as HTMLInputElement;
    const draft = view.getByRole('textbox', {
      name: 'Message',
    }) as HTMLTextAreaElement;
    fireEvent.change(filter, { target: { value: 'notes' } });
    fireEvent.change(draft, { target: { value: 'Keep this draft' } });
    fireEvent.click(
      view.getByRole('button', { name: 'Alpha project', exact: true })
    );
    const list = view.getByRole('list', {
      name: 'Loaded conversations',
      exact: true,
    });
    expect(
      within(list).queryByRole('button', { name: 'Other notes', exact: true })
    ).toBeNull();
    const before = s.owner.getSnapshot();
    const counts = {
      io: { ...s.io, gets: [...s.io.gets] },
      counters: { ...s.fixture.counters },
      url: s.fixture.options.history.currentUrl(),
    };
    const search = view.getByRole('button', {
      name: 'Search loaded conversations',
      exact: true,
    });
    search.focus();
    fireEvent.click(search);
    const dialog = view.getByRole('dialog', {
      name: 'Search loaded conversations',
    });
    expect(within(dialog).getAllByRole('option')).toHaveLength(3);
    expect(dialog.textContent).toContain('up to 50 loaded conversations');
    const input = within(dialog).getByRole('combobox');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'Beta' } });
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
    expect(within(dialog).getByRole('option').textContent).toContain(
      'Archived'
    );
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(view.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(search);
    expect(view.getByRole('searchbox')).toBe(filter);
    expect(filter.value).toBe('notes');
    expect(
      within(list).queryByRole('button', { name: 'Other notes', exact: true })
    ).toBeNull();
    expect(view.getByRole('textbox', { name: 'Message' })).toBe(draft);
    expect(draft.value).toBe('Keep this draft');
    expect(s.owner.getSnapshot().selection).toBe(before.selection);
    expect(s.owner.getSnapshot().runtime).toBe(before.runtime);
    expect({
      io: s.io,
      counters: s.fixture.counters,
      url: s.fixture.options.history.currentUrl(),
    }).toEqual(counts);
    fireEvent.click(search);
    expect((view.getByRole('combobox') as HTMLInputElement).value).toBe('');
    expect(view.getAllByRole('option')).toHaveLength(3);
  } finally {
    s.owner.dispose();
  }
});

it('only explicit selection changes the owner and reveals an archived result outside directory filters', async () => {
  const s = setup();
  try {
    await start(s.owner);
    const view = render(<App application={s.application} />);
    fireEvent.change(view.getByRole('searchbox'), {
      target: { value: 'Alpha' },
    });
    fireEvent.click(
      view.getByRole('button', { name: 'Alpha project', exact: true })
    );
    const before = { lists: s.io.lists, gets: s.io.gets.length };
    fireEvent.click(
      view.getByRole('button', {
        name: 'Search loaded conversations',
        exact: true,
      })
    );
    fireEvent.change(view.getByRole('combobox'), { target: { value: 'Beta' } });
    expect(s.select).not.toHaveBeenCalled();
    fireEvent.keyDown(view.getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(s.owner.getSnapshot().selection.id).toBe('b'));
    await waitFor(() =>
      expect(s.owner.getSnapshot().selection.status).toBe('ready')
    );
    expect(s.select).toHaveBeenCalledExactlyOnceWith('b');
    expect(view.queryByRole('dialog')).toBeNull();
    expect((view.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    const archive = view.getByText('Archived conversations', {
      selector: 'summary',
    }).parentElement;
    expect(archive).toHaveProperty('open', true);
    expect(
      within(archive!)
        .getByRole('button', { name: 'Beta notes', exact: true })
        .getAttribute('aria-current')
    ).toBe('true');
    expect(s.io.lists).toBe(before.lists);
    expect(s.io.gets.slice(before.gets)).toEqual(['b']);
    expect(s.io.creates).toBe(0);
  } finally {
    s.owner.dispose();
  }
});

it('applies local empty-title fallback before filtering and preserves exact raw IDs', async () => {
  const s = setup([
    { id: ' raw/id ', title: '' },
    { id: 'untitled', title: 'Untitled' },
  ]);
  try {
    await start(s.owner);
    const view = render(<App application={s.application} />);
    fireEvent.click(
      view.getByRole('button', {
        name: 'Search loaded conversations',
        exact: true,
      })
    );
    fireEvent.change(view.getByRole('combobox'), {
      target: { value: 'raw/id' },
    });
    expect(view.getByRole('option').textContent).toContain(' raw/id ');
    fireEvent.click(view.getByRole('option'));
    await waitFor(() =>
      expect(s.owner.getSnapshot().selection.status).toBe('ready')
    );
    expect(s.select).toHaveBeenCalledExactlyOnceWith(' raw/id ');
    expect(s.io.gets.at(-1)).toBe(' raw/id ');
    fireEvent.click(
      view.getByRole('button', {
        name: 'Search loaded conversations',
        exact: true,
      })
    );
    fireEvent.change(view.getByRole('combobox'), {
      target: { value: 'Untitled' },
    });
    expect(view.getByRole('option').textContent).toContain('Untitled');
  } finally {
    s.owner.dispose();
  }
});

const paletteProps = (search: ReturnType<typeof useLoadedConversationSearch>) =>
  search.palette.props as HistorySearchPaletteProps;

it('retires native requests synchronously and rejects prior request callbacks after reopen', async () => {
  const s = setup();
  const reveal = vi.fn();
  try {
    await start(s.owner);
    const { result } = renderHook(() =>
      useLoadedConversationSearch(
        s.application,
        s.application.getSnapshot(),
        reveal
      )
    );
    act(() => result.current.openSearch());
    const old = paletteProps(result.current);
    act(() => old.onQueryChange('Beta'));
    expect(paletteProps(result.current).query).toBe('Beta');
    act(() => old.onClose());
    act(() => result.current.openSearch());
    const fresh = paletteProps(result.current);
    expect(fresh.query).toBe('');
    act(() => {
      old.onQueryChange('stale');
      old.onClose();
      old.onSelect('b');
    });
    expect(paletteProps(result.current).open).toBe(true);
    expect(paletteProps(result.current).query).toBe('');
    expect(s.select).not.toHaveBeenCalled();
    act(() => {
      fresh.onSelect('b');
      fresh.onSelect('b');
    });
    expect(s.select).toHaveBeenCalledExactlyOnceWith('b');
    expect(reveal).toHaveBeenCalledOnce();
    expect(paletteProps(result.current).open).toBe(false);
  } finally {
    s.owner.dispose();
  }
});

it('does not resurrect old search or callbacks when a replaced owner returns', async () => {
  const first = setup();
  const second = setup();
  try {
    await start(first.owner);
    await start(second.owner);
    const { result, rerender } = renderHook(
      ({ application }) =>
        useLoadedConversationSearch(
          application,
          application.getSnapshot(),
          vi.fn()
        ),
      { initialProps: { application: first.application } }
    );
    act(() => result.current.openSearch());
    act(() => paletteProps(result.current).onQueryChange('old query'));
    const old = paletteProps(result.current);
    rerender({ application: second.application });
    rerender({ application: first.application });
    expect(paletteProps(result.current).open).toBe(false);
    act(() => {
      old.onQueryChange('resurrect');
      old.onSelect('b');
    });
    expect(first.select).not.toHaveBeenCalled();
    act(() => result.current.openSearch());
    expect(paletteProps(result.current).query).toBe('');
  } finally {
    first.owner.dispose();
    second.owner.dispose();
  }
});

it('validates pending refresh and missing row against live owner state before the view rerenders', async () => {
  const s = setup();
  try {
    await start(s.owner);
    const { result } = renderHook(() =>
      useLoadedConversationSearch(
        s.application,
        s.application.getSnapshot(),
        vi.fn()
      )
    );
    act(() => result.current.openSearch());
    const captured = paletteProps(result.current);
    expect(captured.loading).toBe(false);
    const release = s.holdList();
    s.owner.refresh();
    expect(s.owner.getSnapshot().list.status).toBe('pending');
    act(() => captured.onSelect('b'));
    expect(s.select).not.toHaveBeenCalled();
    release(initialRows.filter((row) => row.id !== 'b'));
    await waitFor(() =>
      expect(s.owner.getSnapshot().list.status).toBe('ready')
    );
    act(() => captured.onSelect('b'));
    expect(s.select).not.toHaveBeenCalled();
    expect(paletteProps(result.current).open).toBe(true);
    act(() => captured.onSelect('c'));
    expect(s.select).toHaveBeenCalledExactlyOnceWith('c');
  } finally {
    s.owner.dispose();
  }
});

it('rejects previous-owner callbacks in the replacement layout phase before passive cleanup', async () => {
  const first = setup();
  const second = setup();
  try {
    await start(first.owner);
    await start(second.owner);
    let passive = first.application;
    let old: HistorySearchPaletteProps | undefined;
    const { result, rerender } = renderHook(
      ({ application }) => {
        const search = useLoadedConversationSearch(
          application,
          application.getSnapshot(),
          vi.fn()
        );
        useLayoutEffect(() => {
          if (application !== second.application) return;
          expect(passive).toBe(first.application);
          old?.onSelect('b');
          old?.onQueryChange('stale');
          old?.onClose();
        }, [application]);
        useEffect(() => {
          passive = application;
        }, [application]);
        return search;
      },
      { initialProps: { application: first.application } }
    );
    act(() => result.current.openSearch());
    old = paletteProps(result.current);
    const staleOpen = result.current.openSearch;
    rerender({ application: second.application });
    expect(paletteProps(result.current).open).toBe(false);
    act(() => staleOpen());
    expect(paletteProps(result.current).open).toBe(false);
    act(() => result.current.openSearch());
    act(() => {
      old?.onSelect('b');
      old?.onClose();
      old?.onQueryChange('stale');
    });
    expect(paletteProps(result.current).open).toBe(true);
    expect(paletteProps(result.current).query).toBe('');
    expect(first.select).not.toHaveBeenCalled();
    expect(second.select).not.toHaveBeenCalled();
  } finally {
    first.owner.dispose();
    second.owner.dispose();
  }
});

it('retires callbacks on unmount and current-ID selection retains runtime/history ownership', async () => {
  const s = setup();
  try {
    await start(s.owner);
    const { result, unmount } = renderHook(() =>
      useLoadedConversationSearch(
        s.application,
        s.application.getSnapshot(),
        vi.fn()
      )
    );
    const before = s.owner.getSnapshot();
    const counts = { ...s.fixture.counters };
    act(() => result.current.openSearch());
    act(() => paletteProps(result.current).onSelect('a'));
    expect(s.owner.getSnapshot().runtime).toBe(before.runtime);
    expect(s.fixture.counters).toEqual(counts);
    act(() => result.current.openSearch());
    const stale = paletteProps(result.current);
    const staleOpen = result.current.openSearch;
    unmount();
    act(() => {
      staleOpen();
      stale.onSelect('b');
      stale.onQueryChange('gone');
      stale.onClose();
    });
    expect(s.select).toHaveBeenCalledExactlyOnceWith('a');
    expect(s.owner.getSnapshot().selection.id).toBe('a');
  } finally {
    s.owner.dispose();
  }
});
