import { describe, expect, it, vi } from 'vitest';
import { createRenderState } from '@threadplane/content/render-state';
import {
  addItem,
  createItems,
  createItemCommands,
  MAX_ITEMS,
  removeItem,
  reverseItems,
} from './items';

describe('caller-owned keyed items', () => {
  it('seeds independent frozen rows with unique stable ids', () => {
    const first = createItems(),
      second = createItems();
    expect(first).toEqual({
      items: [
        { id: 'alpha', label: 'Alpha' },
        { id: 'beta', label: 'Beta' },
        { id: 'gamma', label: 'Gamma' },
      ],
      nextId: 1,
    });
    expect(first).not.toBe(second);
    expect(first.items).not.toBe(second.items);
    expect(first.items[0]).not.toBe(second.items[0]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.items)).toBe(true);
    expect(first.items.every(Object.isFrozen)).toBe(true);
  });

  it('adds a fresh keyed row without mutating retained list data', () => {
    const before = createItems(),
      next = addItem(before);
    expect(next.items.at(-1)).toEqual({ id: 'item-1', label: 'Item 1' });
    expect(next.nextId).toBe(2);
    expect(next.items.slice(0, 3)).toEqual(before.items);
    expect(before.items).toHaveLength(3);
    expect(before.nextId).toBe(1);
    expect(next.items.every(Object.isFrozen)).toBe(true);
  });

  it('removes the exact id and does not reuse its identity on the next Add', () => {
    const before = addItem(createItems());
    const removed = removeItem(before, 'item-1');
    expect(removed.items.map((item) => item.id)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(removed.nextId).toBe(2);
    const added = addItem(removed);
    expect(added.items.at(-1)?.id).toBe('item-2');
    expect(before.items).toHaveLength(4);
    expect(removeItem(added, 'missing')).toBe(added);
    expect(removeItem(added, 'beta').items.map((item) => item.id)).toEqual([
      'alpha',
      'gamma',
      'item-2',
    ]);
  });

  it('reverses order while retaining ids and leaving old snapshots readable', () => {
    const before = createItems(),
      reversed = reverseItems(before);
    expect(reversed.items.map((item) => item.id)).toEqual([
      'gamma',
      'beta',
      'alpha',
    ]);
    expect(before.items.map((item) => item.id)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(reverseItems(reversed)).toEqual(before);
    expect(reversed.nextId).toBe(before.nextId);
    expect(Object.isFrozen(reversed.items)).toBe(true);
  });

  it('bounds the rendered list and permits empty-list recovery', () => {
    let state = createItems();
    while (state.items.length < MAX_ITEMS) state = addItem(state);
    expect(state.items).toHaveLength(32);
    expect(new Set(state.items.map((item) => item.id)).size).toBe(32);
    expect(addItem(state)).toBe(state);
    const nextId = state.nextId;
    for (const item of state.items) state = removeItem(state, item.id);
    expect(state.items).toEqual([]);
    expect(reverseItems(state)).toBe(state);
    state = addItem(state);
    expect(state.items).toEqual([
      { id: `item-${nextId}`, label: `Item ${nextId}` },
    ]);
  });

  it('refuses counter overflow and a duplicate generated identity', () => {
    const before = createItems();
    for (const nextId of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) {
      const invalid = { ...before, nextId };
      expect(addItem(invalid)).toBe(invalid);
    }
    const duplicate = { items: [{ id: 'item-1', label: 'Kept' }], nextId: 1 };
    expect(addItem(duplicate)).toBe(duplicate);
  });
});

describe('application owner commands', () => {
  it('publishes Add once with a complete list and counter, preserving old snapshots', () => {
    const owner = createRenderState(createItems());
    const update = vi.spyOn(owner, 'update');
    const set = vi.spyOn(owner, 'set');
    const snapshots: unknown[] = [];
    const release = owner.subscribe(() => snapshots.push(owner.getSnapshot()));
    const before = owner.getSnapshot();
    const commands = createItemCommands(owner);
    commands.add();
    const expected = addItem(createItems());
    expect(update).toHaveBeenCalledExactlyOnceWith({
      '/items': expected.items,
      '/nextId': 2,
    });
    expect(set).not.toHaveBeenCalled();
    expect(snapshots).toEqual([expected]);
    expect(owner.getSnapshot()).toEqual(expected);
    expect(before).toEqual(createItems());
    expect(owner.lastChange()).toEqual({ path: '/nextId', value: 2 });
    release();
    owner.dispose();
  });

  it('reads latest external writes for every command and uses one items set for remove/reverse', () => {
    const owner = createRenderState(createItems());
    const commands = createItemCommands(owner);
    const latest = {
      items: [
        { id: 'custom', label: 'Custom' },
        { id: 'other', label: 'Other' },
      ],
      nextId: 12,
    };
    owner.update({ '/items': latest.items, '/nextId': latest.nextId });
    const set = vi.spyOn(owner, 'set');
    const update = vi.spyOn(owner, 'update');
    const notify = vi.fn();
    const release = owner.subscribe(notify);
    commands.add();
    expect(owner.getSnapshot()).toEqual(addItem(latest));
    expect(update).toHaveBeenCalledTimes(1);
    commands.remove('custom');
    const removed = removeItem(addItem(latest), 'custom');
    expect(set).toHaveBeenCalledExactlyOnceWith('/items', removed.items);
    expect(owner.getSnapshot()).toEqual(removed);
    expect(owner.lastChange()).toEqual({
      path: '/items',
      value: removed.items,
    });
    set.mockClear();
    commands.reverse();
    const reversed = reverseItems(removed);
    expect(set).toHaveBeenCalledExactlyOnceWith('/items', reversed.items);
    expect(owner.getSnapshot()).toEqual(reversed);
    expect(notify).toHaveBeenCalledTimes(3);
    release();
    owner.dispose();
  });

  it('issues no owner commands or notifications for every helper reference no-op', () => {
    let full = createItems();
    while (full.items.length < MAX_ITEMS) full = addItem(full);
    // The actual owner rejects nonfinite numbers at capture; the pure helper's
    // Infinity refusal remains covered above. Exercise accepted owner values here.
    expect(() =>
      createRenderState({ ...createItems(), nextId: Infinity })
    ).toThrow('Unsupported render-state value');
    const cases = [
      full,
      ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER].map((nextId) => ({
        ...createItems(),
        nextId,
      })),
      { items: [{ id: 'item-1', label: 'Kept' }], nextId: 1 },
    ];
    for (const state of cases) {
      const owner = createRenderState(state);
      const before = owner.getSnapshot();
      const set = vi.spyOn(owner, 'set'),
        update = vi.spyOn(owner, 'update'),
        notify = vi.fn();
      const release = owner.subscribe(notify);
      createItemCommands(owner).add();
      expect(owner.getSnapshot()).toBe(before);
      expect(set).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      release();
      owner.dispose();
    }
    for (const items of [[], [{ id: 'only', label: 'Only' }]]) {
      const owner = createRenderState({ items, nextId: 8 });
      const before = owner.getSnapshot();
      const set = vi.spyOn(owner, 'set'),
        update = vi.spyOn(owner, 'update'),
        notify = vi.fn();
      const release = owner.subscribe(notify);
      const commands = createItemCommands(owner);
      commands.remove('missing');
      commands.reverse();
      expect(owner.getSnapshot()).toBe(before);
      expect(set).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      release();
      owner.dispose();
    }
  });
});
