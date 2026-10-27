import type { RenderState } from '@threadplane/content/render-state';

export type ItemState = {
  readonly items: readonly { readonly id: string; readonly label: string }[];
  readonly nextId: number;
};
// Closed application shape, seeded by createItems and maintained by these
// commands or shape-preserving external writes; not arbitrary schema validation.
export type ItemsObserver = {
  readonly getSnapshot: () => ItemState;
  readonly subscribe: (notify: () => void) => () => void;
};
export type ItemCommands = {
  readonly add: () => void;
  readonly remove: (id: string) => void;
  readonly reverse: () => void;
};

export function createItemCommands(
  owner: Pick<RenderState, 'getSnapshot' | 'set' | 'update'>
): ItemCommands {
  const read = owner.getSnapshot as ItemsObserver['getSnapshot'];
  return {
    add: () => {
      const before = read();
      const after = addItem(before);
      if (after === before) return;
      owner.update({ '/items': after.items, '/nextId': after.nextId });
    },
    remove: (id) => {
      const before = read();
      const after = removeItem(before, id);
      if (after !== before) owner.set('/items', after.items);
    },
    reverse: () => {
      const before = read();
      const after = reverseItems(before);
      if (after !== before) owner.set('/items', after.items);
    },
  };
}
export const MAX_ITEMS = 32;
function own(state: ItemState): ItemState {
  return Object.freeze({
    items: Object.freeze(state.items.map((item) => Object.freeze({ ...item }))),
    nextId: state.nextId,
  });
}
export function createItems(): ItemState {
  return own({
    items: [
      { id: 'alpha', label: 'Alpha' },
      { id: 'beta', label: 'Beta' },
      { id: 'gamma', label: 'Gamma' },
    ],
    nextId: 1,
  });
}
export function addItem(state: ItemState): ItemState {
  if (
    state.items.length >= MAX_ITEMS ||
    !Number.isSafeInteger(state.nextId) ||
    state.nextId < 1 ||
    state.nextId >= Number.MAX_SAFE_INTEGER
  )
    return state;
  const id = `item-${state.nextId}`;
  if (state.items.some((item) => item.id === id)) return state;
  return own({
    items: [...state.items, { id, label: `Item ${state.nextId}` }],
    nextId: state.nextId + 1,
  });
}
export function removeItem(state: ItemState, id: string): ItemState {
  if (!state.items.some((item) => item.id === id)) return state;
  return own({ ...state, items: state.items.filter((item) => item.id !== id) });
}
export function reverseItems(state: ItemState): ItemState {
  return state.items.length < 2
    ? state
    : own({ ...state, items: [...state.items].reverse() });
}
