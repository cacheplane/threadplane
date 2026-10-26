import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './app';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import type { DirectoryResult, ThreadRow } from '../../shared/contracts';

beforeEach(() =>
  vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue([{}] as unknown as DOMRectList)
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup(
  reorderPinned?: (id: string, beforeId: string | null) => Promise<boolean>
) {
  const fixture = applicationFixture();
  const rows = [
    { id: 'u', title: 'Ordinary' },
    { id: 'b', title: 'Beta', pinned: true, pinnedOrder: 1 },
    { id: 'a', title: 'Alpha', pinned: true, pinnedOrder: 0 },
    { id: 'c', title: 'Gamma', pinned: true },
    {
      id: 'z',
      title: 'Archived',
      archived: true,
      pinned: true,
      pinnedOrder: -1,
    },
  ];
  const resolvers: (() => void)[] = [];
  let fail = false;
  const setPinnedOrder = vi.fn(
    (id: string, pinnedOrder: number) =>
      new Promise<DirectoryResult<ThreadRow>>((resolve) =>
        resolvers.push(() =>
          resolve(
            fail
              ? { kind: 'failed' }
              : { kind: 'ready', value: { id, title: id, pinnedOrder } }
          )
        )
      )
  );
  const app = createReactApplication({
    ...fixture.options,
    directory: {
      ...fixture.options.directory,
      list: async () => ({ kind: 'ready', value: rows }),
      setPinnedOrder,
      rename: async (id, title) => ({ kind: 'ready', value: { id, title } }),
      setPinned: async (id, pinned) => ({
        kind: 'ready',
        value: { id, title: id, pinned },
      }),
      setArchived: async (id, archived) => ({
        kind: 'ready',
        value: { id, title: id, archived },
      }),
    },
  });
  app.start();
  await act(async () => {});
  const v = render(
    <App application={reorderPinned ? { ...app, reorderPinned } : app} />
  );
  const open = (id = 'b') =>
    fireEvent.click(
      v.getByRole('button', {
        name: new RegExp('Actions for .*\\(' + id + '\\)'),
      })
    );
  return {
    ...v,
    app,
    fixture,
    open,
    setPinnedOrder,
    settle: async (failure = false) => {
      fail = failure;
      await act(async () => {
        for (let i = 0; i < 3; i++) {
          resolvers.splice(0).forEach((resolve) => resolve());
          await Promise.resolve();
        }
      });
    },
  };
}
it('groups the active loaded directory stably before filtering and moves against hidden pinned neighbors without replacing rows or draft', async () => {
  const v = await setup();
  try {
    const directory = v.getByRole('complementary', {
      name: 'Loaded conversations',
    });
    // Titles identify the row buttons independently from action commands.
    const row = v.getByRole('button', { name: 'Beta' });
    expect(
      within(directory)
        .getAllByRole('button')
        .map((b) => b.textContent)
        .join('|')
    ).toMatch(/Alpha.*Beta.*Gamma.*Ordinary/);
    const message = v.getByRole('textbox', { name: 'Message' });
    fireEvent.change(message, { target: { value: 'Keep draft' } });
    fireEvent.change(v.getByRole('searchbox'), { target: { value: 'Beta' } });
    v.open();
    fireEvent.click(v.getByRole('menuitem', { name: /^Move up.*Beta/ }));
    expect(v.setPinnedOrder.mock.calls.map((call) => call.slice(0, 2))).toEqual(
      [['b', 0]]
    );
    expect(v.getByText(/Moving.*Beta.*\(b\)/)).toBeTruthy();
    expect(v.getByRole('button', { name: 'Beta' })).toBe(row);
    fireEvent.change(v.getByRole('searchbox'), {
      target: { value: 'no match' },
    });
    expect(v.getByText(/Moving.*Beta.*\(b\)/)).toBeTruthy();
    await v.settle();
    expect(v.getByText(/Moved.*Beta.*\(b\)/)).toBeTruthy();
    fireEvent.change(v.getByRole('searchbox'), { target: { value: '' } });
    expect(
      within(directory)
        .getAllByRole('button')
        .map((b) => b.textContent)
        .join('|')
    ).toMatch(/Beta.*Alpha.*Gamma.*Ordinary/);
    expect(message).toHaveProperty('value', 'Keep draft');
    expect(v.fixture.sessions).toHaveLength(1);
    expect(v.setPinnedOrder.mock.calls.map((call) => call.slice(0, 2))).toEqual(
      [
        ['b', 0],
        ['a', 1],
        ['c', 2],
      ]
    );
  } finally {
    v.app.dispose();
  }
});
it('retains only disabled moves during pending and uncertain ordering, leaves other commands usable, and refresh clears the barrier', async () => {
  const v = await setup();
  try {
    v.open();
    fireEvent.click(v.getByRole('menuitem', { name: /^Move up/ }));
    v.open('a');
    expect(v.getByRole('menuitem', { name: /^Move down/ })).toHaveProperty(
      'disabled',
      true
    );
    for (const label of [
      /Copy conversation/,
      /Rename conversation/,
      /Unpin conversation/,
      /^Archive conversation/,
    ])
      expect(v.getByRole('menuitem', { name: label })).toHaveProperty(
        'disabled',
        false
      );
    expect(v.getAllByRole('menuitem').at(-1)?.textContent).toMatch(/^Archive/);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await v.settle(true);
    expect(v.getByText(/order.*unconfirmed.*Refresh/i)).toBeTruthy();
    v.unmount();
    const remount = render(<App application={v.app} />);
    expect(remount.getByText(/order.*unconfirmed.*Refresh/i)).toBeTruthy();
    fireEvent.click(remount.getByRole('button', { name: 'Refresh' }));
    await act(async () => {});
    expect(remount.queryByText(/order.*unconfirmed.*Refresh/i)).toBeNull();
    fireEvent.click(remount.getByRole('button', { name: /Actions for.*Beta/ }));
    expect(remount.getByRole('menuitem', { name: /^Move up/ })).toHaveProperty(
      'disabled',
      false
    );
  } finally {
    v.app.dispose();
  }
});
it('expires an open context menu when filtering changes the visible row position', async () => {
  const v = await setup();
  try {
    const beta = v.getByRole('button', { name: 'Beta' });
    fireEvent.contextMenu(beta, { clientX: 4, clientY: 5 });
    expect(v.getByRole('menu')).toBeTruthy();
    fireEvent.change(v.getByRole('searchbox'), { target: { value: 'Beta' } });
    expect(v.queryByRole('menu')).toBeNull();
  } finally {
    v.app.dispose();
  }
});

it('preserves keyed DOM through a confirmed move and does not replay success after directory remount', async () => {
  const v = await setup();
  try {
    const beta = v.getByRole('button', { name: 'Beta' });
    v.open();
    fireEvent.click(v.getByRole('menuitem', { name: /^Move down/ }));
    await v.settle();
    expect(v.getByRole('button', { name: 'Beta' })).toBe(beta);
    expect(v.getByText(/Moved.*Beta/)).toBeTruthy();
    v.unmount();
    const next = render(<App application={v.app} />);
    expect(next.queryByText(/Moved.*Beta/)).toBeNull();
    fireEvent.click(
      next.getByRole('button', { name: /Actions for.*Ordinary/ })
    );
    expect(next.queryByRole('menuitem', { name: /^Move/ })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.click(
      next.getByText('Archived conversations', { selector: 'summary' })
    );
    fireEvent.click(
      next.getByRole('button', { name: /Actions for.*Archived/ })
    );
    expect(next.queryByRole('menuitem', { name: /^Move/ })).toBeNull();
  } finally {
    v.app.dispose();
  }
});
for (const mode of ['throw', 'reject', 'false'])
  it(`contains a ${mode}ing reorder callback with target feedback and no focus theft`, async () => {
    const reorder = vi.fn(() => {
      if (mode === 'throw') throw Error('hostile callback');
      return mode === 'false'
        ? Promise.resolve(false)
        : Promise.reject(Error('hostile callback'));
    });
    const v = await setup(reorder);
    try {
      v.open();
      fireEvent.click(v.getByRole('menuitem', { name: /^Move up/ }));
      const message = v.getByRole('textbox', { name: 'Message' });
      message.focus();
      await act(async () => {});
      expect(v.getByText(/Could not move.*Beta.*\(b\)/)).toBeTruthy();
      expect(document.activeElement).toBe(message);
      expect(reorder).toHaveBeenCalledWith('b', 'a');
      v.open('a');
      expect(v.getByRole('menuitem', { name: /^Move down/ })).toHaveProperty(
        'disabled',
        false
      );
    } finally {
      v.app.dispose();
    }
  });

it('shares pending moves after directory remount without replaying the old completion or closing a replacement menu', async () => {
  const v = await setup();
  try {
    v.open();
    fireEvent.click(v.getByRole('menuitem', { name: /^Move up/ }));
    v.unmount();
    const next = render(<App application={v.app} />);
    expect(next.getByText(/Moving.*Beta.*\(b\)/)).toBeTruthy();
    fireEvent.click(
      next.getByRole('button', { name: /Actions for.*Ordinary/ })
    );
    const replacement = next.getByRole('menu');
    await v.settle();
    expect(next.queryByText(/Moving.*Beta/)).toBeNull();
    expect(next.queryByText(/Moved.*Beta/)).toBeNull();
    expect(next.getByRole('menu')).toBe(replacement);
  } finally {
    v.app.dispose();
  }
});
