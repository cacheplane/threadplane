import { StrictMode } from 'react';
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createReactApplication,
  type ReactApplicationSnapshot,
} from './application';
import { applicationFixture } from './application-fixture';
import type { ThreadRow } from '../../shared/contracts';
import { usePinnedConversationDrag } from './pinned-conversation-drag';

const rows: readonly ThreadRow[] = ['a', 'hidden', 'b', 'c'].map(
  (id, pinnedOrder) => ({ id, title: id, pinned: true, pinnedOrder })
);
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 10,
    height: 20,
  } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function transfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (key: string, value: string) => values.set(key, value),
    getData: (key: string) => values.get(key) ?? '',
    clearData: () => values.clear(),
  };
}
// jsdom has no native DragEvent constructor, so supply its coordinate explicitly.
function dragAt(
  type: 'drop' | 'dragOver',
  element: HTMLElement,
  dataTransfer: ReturnType<typeof transfer>,
  clientY: number
) {
  const event = createEvent[type](element, { dataTransfer });
  Object.defineProperty(event, 'clientY', { value: clientY });
  return fireEvent(element, event);
}
function setup(strict = false) {
  const real = createReactApplication(applicationFixture().options);
  let live: ReactApplicationSnapshot = {
    ...real.getSnapshot(),
    list: { ...real.getSnapshot().list, status: 'ready', rows },
  };
  const application = {
    ...real,
    getSnapshot: () => live,
    canReorderPinned: vi.fn(() => true),
  };
  const reorder = vi.fn();
  let props = {
    application,
    list: live.list,
    visibleRows: rows.filter((row) => row.id !== 'hidden'),
    contextKey: 'all',
    blocked: false,
    onReorder: reorder,
  };
  function Harness() {
    const { handleFor } = usePinnedConversationDrag(props);
    return (
      <div>
        <input aria-label="Draft" />
        {props.visibleRows.map((row) => (
          <div key={row.id}>{handleFor(row)}</div>
        ))}
      </div>
    );
  }
  const tree = () =>
    strict ? (
      <StrictMode>
        <Harness />
      </StrictMode>
    ) : (
      <Harness />
    );
  const view = render(tree());
  const button = (id: string) =>
    view.getByRole('button', {
      name: `Drag to reorder conversation for ${id} (${id})`,
    });
  return {
    view,
    button,
    reorder,
    application,
    live: (patch: Partial<ReactApplicationSnapshot>) => {
      live = { ...live, ...patch };
    },
    snapshot: () => live,
    update: (patch: Partial<typeof props> = {}) => {
      props = { ...props, ...patch };
      view.rerender(tree());
    },
    start: (id = 'c') => {
      const dataTransfer = transfer();
      fireEvent.dragStart(button(id), { dataTransfer });
      return dataTransfer;
    },
    drop: (
      dataTransfer: ReturnType<typeof transfer>,
      target = 'a',
      clientY = 11
    ) => dragAt('drop', button(target), dataTransfer, clientY),
  };
}

it.each([
  ['c', 'a', 11, 'a'],
  ['c', 'a', 29, 'hidden'],
  ['a', 'c', 29, null],
  ['a', 'b', 29, 'c'],
])(
  'moves %s against %s at %s using global neighbor %s',
  (source, target, y, beforeId) => {
    const f = setup();
    const data = f.start(source);
    f.drop(data, target, y);
    expect(f.reorder.mock.calls).toEqual([
      [rows.find((row) => row.id === source), beforeId],
    ]);
  }
);
it('keeps protected dragover local, recomputes the drop side, and consumes a capture once', () => {
  const f = setup();
  const data = f.start();
  expect(
    dragAt('dragOver', f.button('a'), { ...data, getData: () => '' }, 11)
  ).toBe(false);
  expect(f.button('a').dataset.dropPosition).toBe('before');
  f.drop(data, 'a', 29);
  f.drop(data, 'b', 11);
  expect(f.reorder.mock.calls).toEqual([[rows[3], 'hidden']]);
});
it('does not select, focus, or write during hover, drag leave, and cancellation', () => {
  const f = setup();
  const draft = f.view.getByRole('textbox');
  draft.focus();
  const data = f.start();
  fireEvent.dragOver(f.button('a'), { dataTransfer: data, clientY: 11 });
  fireEvent.dragLeave(f.button('a'));
  expect(f.button('a').dataset.dropPosition).toBeUndefined();
  expect(document.activeElement).toBe(draft);
  expect(f.reorder).not.toHaveBeenCalled();
});
it.each(['self', 'unchanged', 'external', 'wrong marker'])(
  'ignores %s drops',
  (mode) => {
    const f = setup();
    const data =
      mode === 'external'
        ? transfer()
        : f.start(mode === 'unchanged' ? 'b' : 'c');
    if (mode === 'wrong marker') data.clearData();
    f.drop(
      data,
      mode === 'self' || mode === 'unchanged' ? 'c' : 'a',
      mode === 'unchanged' ? 11 : 29
    );
    expect(f.reorder).not.toHaveBeenCalled();
  }
);
it.each(['Escape', 'blur', 'dragend', 'unmount'])(
  'cancels on %s without writing',
  (mode) => {
    const f = setup();
    const data = f.start();
    const target = f.button('a');
    if (mode === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    if (mode === 'blur') fireEvent.blur(window);
    if (mode === 'dragend') fireEvent.dragEnd(f.button('c'));
    if (mode === 'unmount') f.view.unmount();
    fireEvent.drop(target, { dataTransfer: data, clientY: 11 });
    expect(f.reorder).not.toHaveBeenCalled();
  }
);
it.each(['context', 'application', 'list', 'status', 'blocked'])(
  'expires %s changes across A-B-A',
  (mode) => {
    const f = setup();
    const data = f.start();
    const list = f.snapshot().list;
    if (mode === 'context') {
      f.update({ contextKey: 'project:b' });
      f.update({ contextKey: 'all' });
    }
    if (mode === 'application') {
      f.update({ application: { ...f.application } });
      f.update({ application: f.application });
    }
    if (mode === 'list') {
      f.update({ list: { ...list, rows: [...rows] } });
      f.update({ list });
    }
    if (mode === 'status') {
      f.update({ list: { ...list, status: 'pending' } });
      f.update({ list });
    }
    if (mode === 'blocked') {
      f.update({ blocked: true });
      f.update({ blocked: false });
    }
    f.drop(data);
    expect(f.reorder).not.toHaveBeenCalled();
  }
);
it.each([
  'rows',
  'status',
  'ordering pending',
  'ordering unconfirmed',
  'deletion pending',
  'deletion unconfirmed',
  'capability',
])('rejects live %s before React commits', (mode) => {
  const f = setup();
  const data = f.start();
  const snapshot = f.snapshot();
  if (mode === 'rows') f.live({ list: { ...snapshot.list, rows: [...rows] } });
  if (mode === 'status')
    f.live({ list: { ...snapshot.list, status: 'pending' } });
  if (mode.startsWith('ordering'))
    f.live({
      ordering: {
        ...snapshot.ordering,
        status: mode.endsWith('unconfirmed') ? 'unconfirmed' : 'pending',
      },
    });
  if (mode.startsWith('deletion'))
    f.live({
      deletion: {
        ...snapshot.deletion,
        status: mode.endsWith('unconfirmed') ? 'unconfirmed' : 'pending',
      },
    });
  if (mode === 'capability')
    f.application.canReorderPinned.mockReturnValue(false);
  f.drop(data);
  expect(f.reorder).not.toHaveBeenCalled();
});
it.each([
  'source hidden',
  'target hidden',
  'source inert',
  'target disconnected',
  'source disconnected',
])('rejects %s', (mode) => {
  const f = setup();
  const data = f.start();
  const source = f.button('c'),
    target = f.button('a');
  const element = mode.startsWith('source') ? source : target;
  if (mode.endsWith('hidden')) element.parentElement!.hidden = true;
  if (mode.endsWith('inert')) element.parentElement!.setAttribute('inert', '');
  if (mode.endsWith('disconnected')) element.remove();
  fireEvent.drop(target, { dataTransfer: data, clientY: 11 });
  expect(f.reorder).not.toHaveBeenCalled();
});
it('survives StrictMode and unchanged-list runtime updates', () => {
  const f = setup(true);
  const data = f.start();
  f.live({ runtime: null });
  f.update();
  f.drop(data);
  expect(f.reorder).toHaveBeenCalledWith(rows[3], 'a');
});
it('rejects another hook owner even when supplied the source marker', () => {
  const f = setup();
  const data = f.start();
  const other = setup();
  const target = other.view.container.querySelector<HTMLButtonElement>(
    '.native-pinned-drag'
  )!;
  dragAt('drop', target, data, 11);
  expect(f.reorder).not.toHaveBeenCalled();
  expect(other.reorder).not.toHaveBeenCalled();
});
it('rechecks the live application immediately before dispatch', () => {
  const f = setup();
  const data = f.start();
  f.application.canReorderPinned
    .mockImplementationOnce(() => true)
    .mockImplementationOnce(() => false);
  f.drop(data);
  expect(f.reorder).not.toHaveBeenCalled();
});
it('uses private marker data and accessible dedicated handles', () => {
  const f = setup();
  const data = f.start();
  expect(f.button('c').draggable).toBe(true);
  expect(f.button('c').title).toMatch(/Move up.*Move down.*Actions/);
  expect(f.button('c').hasAttribute('aria-grabbed')).toBe(false);
  expect(data.getData('text/plain')).toBe('');
  expect(f.button('c').dataset.dragging).toBe('true');
});
it('omits unpinned and archived handles and disables insufficient visible pins and global limit', () => {
  const f = setup();
  f.update({
    visibleRows: [
      { id: 'u', title: 'u' },
      { id: 'z', title: 'z', pinned: true, archived: true },
      rows[0],
    ],
  });
  expect(f.view.queryByRole('button', { name: /for u / })).toBeNull();
  expect(f.view.queryByRole('button', { name: /for z / })).toBeNull();
  expect(f.button('a')).toHaveProperty('disabled', true);
  const many = Array.from({ length: 51 }, (_, n) => ({
    id: String(n),
    title: String(n),
    pinned: true,
  }));
  f.live({ list: { ...f.snapshot().list, rows: many } });
  f.update({ list: f.snapshot().list, visibleRows: many });
  expect(f.button('0')).toHaveProperty('disabled', true);
});
