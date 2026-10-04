export type DemoState = {
  readonly user: { readonly name: string; readonly age: number };
  readonly settings: { readonly theme: 'dark' | 'light' };
};

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
  field: 'name' | 'age' | 'theme',
  value: unknown
): { readonly state: DemoState; readonly error: string | null } {
  let error: string | null = null;
  let next = state;
  if (field === 'name') {
    if (typeof value !== 'string' || value.length > 256)
      error = 'Use at most 256 characters for the name.';
    else next = own({ ...state, user: { ...state.user, name: value } });
  } else if (field === 'age') {
    if (
      typeof value !== 'string' ||
      !/^[0-9]{1,3}$/.test(value) ||
      Number(value) > 150
    )
      error = 'Enter a whole age from 0 to 150.';
    else next = own({ ...state, user: { ...state.user, age: Number(value) } });
  } else if (field === 'theme') {
    if (value !== 'dark' && value !== 'light') error = 'Choose Dark or Light.';
    else next = own({ ...state, settings: { theme: value } });
  }
  return Object.freeze({ state: next, error });
}
