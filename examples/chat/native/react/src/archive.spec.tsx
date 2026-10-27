import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DirectoryResult, ThreadRow } from '../../shared/contracts';
import { applicationFixture } from './application-fixture';
import { createReactApplication } from './application';
import { App } from './app';

beforeEach(() =>
  vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue([{}] as unknown as DOMRectList)
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup() {
  const fixture = applicationFixture();
  const rows: ThreadRow[] = [
    { id: 'a', title: 'Alpha' },
    { id: 'b', title: 'Beta', pinned: true },
    { id: 'c', title: 'Archived Gamma', archived: true },
  ];
  let settle!: (result: DirectoryResult<ThreadRow>) => void;
  const archive = vi.fn(
    (_id: string, _archived: boolean, _signal: AbortSignal) =>
      new Promise<DirectoryResult<ThreadRow>>((resolve) => {
        settle = resolve;
      })
  );
  const application = createReactApplication({
    ...fixture.options,
    directory: {
      ...fixture.options.directory,
      list: async () => ({ kind: 'ready', value: rows }),
      get: async (id) => ({
        kind: 'ready',
        value: rows.find((row) => row.id === id)!,
      }),
      rename: async (id, title) => ({ kind: 'ready', value: { id, title } }),
      setPinned: async (id, pinned) => ({
        kind: 'ready',
        value: { id, title: 'Ignored', pinned },
      }),
      setArchived: archive,
    },
  });
  await act(async () => application.start());
  const view = render(<App application={application} />);
  const open = (title: string) =>
    fireEvent.click(view.getByRole('button', { name: `Actions for ${title}` }));
  const command = (name: RegExp) =>
    fireEvent.click(view.getByRole('menuitem', { name }));
  const finish = async (id: string, archived: boolean, failed = false) => {
    await act(async () =>
      settle(
        failed
          ? { kind: 'failed' }
          : { kind: 'ready', value: { id, title: 'Ignored', archived } }
      )
    );
  };
  return { view, application, fixture, archive, open, command, finish };
}

it('partitions loaded rows, filters both lists and offers Copy/Unarchive only for archived rows', async () => {
  const f = await setup();
  try {
    const active = f.view.getByRole('list', { name: 'Loaded conversations' });
    expect(within(active).queryByText('Archived Gamma')).toBeNull();
    await act(async () => {
      fireEvent.click(
        f.view.getByText('Archived conversations', { selector: 'summary' })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const archived = f.view.getByRole('list', {
      name: 'Archived loaded conversations',
    });
    expect(
      within(archived).getByRole('button', { name: 'Archived Gamma' })
    ).toBeTruthy();
    expect(f.view.getAllByRole('button', { name: 'New' })).toHaveLength(1);
    f.open('Archived Gamma (c)');
    expect(
      f.view.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual([
      'Copy conversation ID for Archived Gamma (c)',
      'Unarchive conversation for Archived Gamma (c)',
    ]);
    fireEvent.keyDown(f.view.getByRole('menu'), { key: 'Escape' });
    fireEvent.change(f.view.getByRole('searchbox'), {
      target: { value: 'gamma' },
    });
    expect(within(active).queryByText('Alpha')).toBeNull();
    expect(
      within(archived).getByRole('button', { name: 'Archived Gamma' })
    ).toBeTruthy();
    expect(f.archive).not.toHaveBeenCalled();
  } finally {
    f.application.dispose();
  }
});

it('keeps completion feedback after row migration and preserves selected transcript, draft and focus', async () => {
  const f = await setup();
  try {
    const input = f.view.getByRole('textbox', {
      name: 'Message',
    }) as HTMLTextAreaElement;
    const transcript = f.view.getByRole('region', {
      name: 'Conversation messages',
    });
    fireEvent.change(input, { target: { value: 'Keep my draft' } });
    const before = f.application.getSnapshot();
    const counters = { ...f.fixture.counters };
    f.open('Alpha (a)');
    f.command(/^Archive conversation/);
    input.focus();
    await f.finish('a', true);
    expect(f.view.getByText(/Conversation archived.*Alpha \(a\)/)).toBeTruthy();
    expect(f.view.getByRole('textbox', { name: 'Message' })).toBe(input);
    expect(input.value).toBe('Keep my draft');
    expect(document.activeElement).toBe(input);
    expect(f.view.getByRole('region', { name: 'Conversation messages' })).toBe(
      transcript
    );
    expect(f.application.getSnapshot().runtime).toBe(before.runtime);
    expect(f.application.getSnapshot().messages).toBe(before.messages);
    expect(f.fixture.counters).toEqual(counters);
    await act(async () => {
      fireEvent.click(
        f.view.getByText('Archived conversations', { selector: 'summary' })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    f.open('Alpha (a)');
    f.command(/^Unarchive conversation/);
    await f.finish('a', false);
    expect(
      f.view.getByText(/Conversation unarchived.*Alpha \(a\)/)
    ).toBeTruthy();
    expect(
      f.archive.mock.calls.map(([id, archived]) => [id, archived])
    ).toEqual([
      ['a', true],
      ['a', false],
    ]);
  } finally {
    f.application.dispose();
  }
});

it('holds only archive disabled across filter replacement and permits explicit retry after failure', async () => {
  const f = await setup();
  try {
    f.open('Beta (b)');
    f.command(/^Archive conversation/);
    fireEvent.change(f.view.getByRole('searchbox'), {
      target: { value: 'Alpha' },
    });
    expect(f.view.getByText(/Archiving conversation.*Beta \(b\)/)).toBeTruthy();
    fireEvent.change(f.view.getByRole('searchbox'), { target: { value: '' } });
    f.open('Beta (b)');
    expect(
      (
        f.view.getByRole('menuitem', {
          name: /^Archive conversation/,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        f.view.getByRole('menuitem', {
          name: /^Rename conversation/,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(
      (
        f.view.getByRole('menuitem', {
          name: /^Unpin conversation/,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    fireEvent.click(
      f.view.getByRole('menuitem', { name: /^Archive conversation/ })
    );
    expect(f.archive).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(f.view.getByRole('menu'), { key: 'Escape' });
    await f.finish('b', true, true);
    expect(
      f.view.getByText(/Could not archive conversation.*Beta \(b\)/)
    ).toBeTruthy();
    f.open('Beta (b)');
    f.command(/^Archive conversation/);
    await f.finish('b', true);
    expect(f.archive).toHaveBeenCalledTimes(2);
    expect(f.view.getByText(/Conversation archived.*Beta \(b\)/)).toBeTruthy();
  } finally {
    f.application.dispose();
  }
});

it('does not replay historical completions on remount or let late completion steal focus', async () => {
  const f = await setup();
  try {
    f.open('Beta (b)');
    f.command(/^Archive conversation/);
    f.view.unmount();
    const replacement = render(<App application={f.application} />);
    const input = replacement.getByRole('textbox', { name: 'Message' });
    input.focus();
    expect(
      replacement.getByText(/Archiving conversation.*Beta \(b\)/)
    ).toBeTruthy();
    await f.finish('b', true);
    expect(document.activeElement).toBe(input);
    expect(
      replacement.queryByText(/Conversation archived.*Beta \(b\)/)
    ).toBeNull();
    replacement.unmount();
    const latest = render(<App application={f.application} />);
    expect(latest.queryByText(/Conversation archived.*Beta \(b\)/)).toBeNull();
  } finally {
    f.application.dispose();
  }
});

it('closing archived details dismisses its context menu without replay when reopened', async () => {
  const f = await setup();
  try {
    const summary = f.view.getByText('Archived conversations', {
      selector: 'summary',
    });
    await act(async () => {
      fireEvent.click(summary);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const row = f.view.getByRole('button', { name: 'Archived Gamma' });
    fireEvent.contextMenu(row, { clientX: 120, clientY: 80 });
    expect(
      f.view.getByRole('menuitem', { name: /^Unarchive conversation/ })
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(summary);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {});
    expect(f.view.queryByRole('menu')).toBeNull();
    await act(async () => {
      fireEvent.click(summary);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(f.view.queryByRole('menu')).toBeNull();
    expect(f.archive).not.toHaveBeenCalled();
  } finally {
    f.application.dispose();
  }
});

for (const initiallyArchived of [false, true]) {
  it(`expires the context occurrence when authoritative refresh ${
    initiallyArchived ? 'unarchives' : 'archives'
  } its row`, async () => {
    let archived = initiallyArchived;
    const fixture = applicationFixture();
    const application = createReactApplication({
      ...fixture.options,
      directory: {
        ...fixture.options.directory,
        list: async () => ({
          kind: 'ready',
          value: [{ id: 'a', title: 'Alpha', archived }],
        }),
        get: async (id) => ({
          kind: 'ready',
          value: { id, title: 'Alpha', archived },
        }),
        setArchived: async (id, archived) => ({
          kind: 'ready',
          value: { id, title: 'Alpha', archived },
        }),
      },
    });
    await act(async () => application.start());
    const view = render(<App application={application} />);
    try {
      await act(async () => {
        fireEvent.click(
          view.getByText('Archived conversations', { selector: 'summary' })
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const oldRow = view.getByRole('button', { name: 'Alpha', exact: true });
      fireEvent.contextMenu(oldRow, { clientX: 120, clientY: 80 });
      expect(
        view.getByRole('menuitem', {
          name: initiallyArchived
            ? /^Unarchive conversation/
            : /^Archive conversation/,
        })
      ).toBeTruthy();
      archived = !initiallyArchived;
      await act(async () => application.refresh());
      expect(oldRow.isConnected).toBe(false);
      expect(view.queryByRole('menu')).toBeNull();
      expect(document.activeElement?.getAttribute('role')).not.toBe('menuitem');
      // A replacement occurrence can open normally; the previous close path
      // must not keep the old point or reopen a portal during the migration.
      fireEvent.click(
        view.getByRole('button', { name: 'Actions for Alpha (a)' })
      );
      expect(
        view.getByRole('menuitem', {
          name: initiallyArchived
            ? /^Archive conversation/
            : /^Unarchive conversation/,
        })
      ).toBeTruthy();
    } finally {
      application.dispose();
    }
  });
}
