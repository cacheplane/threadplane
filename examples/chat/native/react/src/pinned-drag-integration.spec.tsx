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

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 32, 40)
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function transfer() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return [...data.keys()];
    },
    effectAllowed: 'none',
    dropEffect: 'none',
  } as unknown as DataTransfer;
}
function dragEvent(
  element: HTMLElement,
  type: string,
  dataTransfer: DataTransfer,
  clientY = 5
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientY: { value: clientY },
  });
  fireEvent(element, event);
}
async function setup() {
  const fixture = applicationFixture();
  const rows: readonly ThreadRow[] = [
    { id: 'a', title: 'Selected conversation' },
    { id: 'b', title: 'Alpha pin', pinned: true, pinnedOrder: 0 },
    { id: 'h', title: 'Hidden neighbor', pinned: true, pinnedOrder: 1 },
    { id: 'c', title: 'Beta pin', pinned: true, pinnedOrder: 2 },
    { id: 'd', title: 'Gamma pin', pinned: true, pinnedOrder: 3 },
    { id: 'z', title: 'Archived pin', pinned: true, archived: true },
  ];
  let serverRows = rows;
  const pending: ((success: boolean) => void)[] = [];
  const setPinnedOrder = vi.fn(
    (id: string, pinnedOrder: number) =>
      new Promise<DirectoryResult<ThreadRow>>((resolve) =>
        pending.push((success) => {
          if (success)
            serverRows = serverRows.map((row) =>
              row.id === id ? { ...row, pinnedOrder } : row
            );
          resolve(
            success
              ? { kind: 'ready', value: { id, title: id, pinnedOrder } }
              : { kind: 'failed' }
          );
        })
      )
  );
  const owner = createReactApplication({
    ...fixture.options,
    directory: {
      ...fixture.options.directory,
      list: async () => ({ kind: 'ready', value: serverRows }),
      setPinnedOrder,
    },
  });
  owner.start();
  await act(async () => {});
  const reorderPinned = vi.fn(owner.reorderPinned);
  const application = { ...owner, reorderPinned };
  const view = render(<App application={application} />);
  const list = view.getByRole('list', {
    name: 'Loaded conversations',
    exact: true,
  });
  return {
    ...view,
    owner,
    fixture,
    setPinnedOrder,
    reorderPinned,
    handle: (id: string) =>
      within(list).getByRole('button', {
        name: new RegExp(`^Drag to reorder conversation for .*\\(${id}\\)$`),
      }),
    titles: () =>
      [...list.querySelectorAll('.tp-thread-list__button')].map((node) =>
        node.getAttribute('title')
      ),
    settle: async (success: boolean | readonly boolean[]) =>
      act(async () => {
        let index = 0;
        for (let i = 0; i < 6; i++) {
          pending
            .splice(0)
            .forEach((finish) =>
              finish(
                typeof success === 'boolean'
                  ? success
                  : success[index++] ?? false
              )
            );
          await Promise.resolve();
        }
      }),
  };
}

it('keeps drag writes on the existing pending/uncertain barrier and retains manual recovery, draft, selection and DOM', async () => {
  const v = await setup();
  try {
    const selected = v.getByRole('button', {
      name: 'Selected conversation',
      exact: true,
    });
    const beta = v.getByRole('button', { name: 'Beta pin', exact: true });
    const draft = v.getByRole('textbox', { name: 'Message', exact: true });
    fireEvent.change(draft, { target: { value: 'Keep this draft.' } });
    const url = v.fixture.options.history.currentUrl();
    const data = transfer();
    dragEvent(v.handle('c'), 'dragstart', data);
    dragEvent(v.handle('b'), 'dragover', data);
    expect(v.setPinnedOrder).not.toHaveBeenCalled();
    dragEvent(v.handle('b'), 'drop', data);
    expect(v.reorderPinned).toHaveBeenCalledExactlyOnceWith('c', 'b');
    expect(v.handle('b')).toHaveProperty('disabled', true);
    expect(v.titles()).toEqual([
      'Alpha pin',
      'Hidden neighbor',
      'Beta pin',
      'Gamma pin',
      'Selected conversation',
    ]);
    dragEvent(v.handle('b'), 'drop', data);
    expect(v.reorderPinned).toHaveBeenCalledTimes(1);
    await v.settle([true, false, false]);
    expect(v.setPinnedOrder.mock.calls.map((call) => call.slice(0, 2))).toEqual(
      [
        ['c', 0],
        ['b', 1],
        ['h', 2],
      ]
    );
    expect(v.titles()).toEqual([
      'Alpha pin',
      'Hidden neighbor',
      'Beta pin',
      'Gamma pin',
      'Selected conversation',
    ]);
    expect(v.getByText(/order.*unconfirmed.*Refresh/i)).toBeTruthy();
    expect(v.handle('c')).toHaveProperty('disabled', true);
    fireEvent.click(v.getByRole('button', { name: /Actions for Beta pin/ }));
    expect(v.getByRole('menuitem', { name: /^Move up/ })).toHaveProperty(
      'disabled',
      true
    );
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.click(v.getByRole('button', { name: 'Refresh', exact: true }));
    await act(async () => {});
    expect(v.handle('c')).toHaveProperty('disabled', false);
    fireEvent.click(v.getByRole('button', { name: /Actions for Beta pin/ }));
    fireEvent.click(v.getByRole('menuitem', { name: /^Move up/ }));
    await v.settle(true);
    expect(v.titles()).toEqual([
      'Beta pin',
      'Alpha pin',
      'Hidden neighbor',
      'Gamma pin',
      'Selected conversation',
    ]);
    expect(v.getByRole('button', { name: 'Beta pin', exact: true })).toBe(beta);
    expect(
      v.getByRole('button', { name: 'Selected conversation', exact: true })
    ).toBe(selected);
    expect(v.getByRole('textbox', { name: 'Message', exact: true })).toBe(
      draft
    );
    expect(draft).toHaveProperty('value', 'Keep this draft.');
    expect(selected.getAttribute('aria-current')).toBe('true');
    expect(v.fixture.sessions).toHaveLength(1);
    expect(v.fixture.options.history.currentUrl()).toBe(url);
    expect(v.fixture.counters.commands).toBe(0);
  } finally {
    v.owner.dispose();
  }
});

it('drops after a visible pin against the complete loaded order and preserves hidden neighbors', async () => {
  const v = await setup();
  try {
    fireEvent.change(v.getByRole('searchbox'), { target: { value: 'pin' } });
    const data = transfer();
    dragEvent(v.handle('b'), 'dragstart', data);
    dragEvent(v.handle('c'), 'dragover', data, 35);
    dragEvent(v.handle('c'), 'drop', data, 35);
    expect(v.reorderPinned).toHaveBeenCalledExactlyOnceWith('b', 'd');
    await v.settle(true);
    expect(v.setPinnedOrder.mock.calls.map((call) => call.slice(0, 2))).toEqual(
      [
        ['h', 0],
        ['c', 1],
        ['b', 2],
      ]
    );
    fireEvent.change(v.getByRole('searchbox'), { target: { value: '' } });
    expect(v.titles()).toEqual([
      'Hidden neighbor',
      'Beta pin',
      'Alpha pin',
      'Gamma pin',
      'Selected conversation',
    ]);
    expect(v.fixture.sessions).toHaveLength(1);
  } finally {
    v.owner.dispose();
  }
});

it('expires an A-to-B-to-A filter drag even while its source and destination DOM survive', async () => {
  const v = await setup();
  try {
    const source = v.handle('b');
    const target = v.handle('c');
    const data = transfer();
    dragEvent(source, 'dragstart', data);
    fireEvent.change(v.getByRole('searchbox'), { target: { value: 'pin' } });
    fireEvent.change(v.getByRole('searchbox'), { target: { value: '' } });
    expect(v.handle('b')).toBe(source);
    expect(v.handle('c')).toBe(target);
    dragEvent(target, 'drop', data, 35);
    expect(v.reorderPinned).not.toHaveBeenCalled();
    expect(v.setPinnedOrder).not.toHaveBeenCalled();
    expect(v.fixture.sessions).toHaveLength(1);
  } finally {
    v.owner.dispose();
  }
});
