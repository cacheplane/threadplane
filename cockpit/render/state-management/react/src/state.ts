import type { RenderState } from '@threadplane/content/render-state';

export type DemoState = {
  readonly user: { readonly name: string; readonly age: number };
  readonly settings: { readonly theme: 'dark' | 'light' };
};

// Closed application contract: initialized with createInitialState and maintained
// by validated scalar edits. This does not type arbitrary render-state owners.
export type DemoObserver = {
  readonly getSnapshot: () => DemoState;
  readonly subscribe: (notify: () => void) => () => void;
};
export type StateField = 'name' | 'age' | 'theme';
export type StateEditor = (field: StateField, value: unknown) => string | null;

type ValidatedEdit =
  | { readonly error: string }
  | {
      readonly error: null;
      readonly path: '/user/name';
      readonly value: string;
    }
  | { readonly error: null; readonly path: '/user/age'; readonly value: number }
  | {
      readonly error: null;
      readonly path: '/settings/theme';
      readonly value: 'dark' | 'light';
    };

function validateEdit(field: StateField, value: unknown): ValidatedEdit {
  if (field === 'name') {
    if (typeof value !== 'string' || value.length > 256)
      return { error: 'Use at most 256 characters for the name.' };
    return { error: null, path: '/user/name', value };
  }
  if (field === 'age') {
    if (
      typeof value !== 'string' ||
      !/^[0-9]{1,3}$/.test(value) ||
      Number(value) > 150
    )
      return { error: 'Enter a whole age from 0 to 150.' };
    return { error: null, path: '/user/age', value: Number(value) };
  }
  if (value !== 'dark' && value !== 'light')
    return { error: 'Choose Dark or Light.' };
  return { error: null, path: '/settings/theme', value };
}

export function createStateEditor(
  owner: Pick<RenderState, 'set'>
): StateEditor {
  return (field, value) => {
    const edit = validateEdit(field, value);
    if (edit.error !== null) return edit.error;
    owner.set(edit.path, edit.value);
    return null;
  };
}

function own(state: DemoState): DemoState {
  return Object.freeze({
    user: Object.freeze({ ...state.user }),
    settings: Object.freeze({ ...state.settings }),
  });
}

export function createInitialState(): DemoState {
  return own({ user: { name: 'Alice', age: 30 }, settings: { theme: 'dark' } });
}

export function editState(
  state: DemoState,
  field: StateField,
  value: unknown
): { readonly state: DemoState; readonly error: string | null } {
  const edit = validateEdit(field, value);
  if (edit.error !== null) return Object.freeze({ state, error: edit.error });
  const next =
    edit.path === '/user/name'
      ? own({ ...state, user: { ...state.user, name: edit.value } })
      : edit.path === '/user/age'
      ? own({ ...state, user: { ...state.user, age: edit.value } })
      : own({ ...state, settings: { theme: edit.value } });
  return Object.freeze({ state: next, error: null });
}
