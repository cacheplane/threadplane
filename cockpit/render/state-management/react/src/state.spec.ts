import { describe, expect, it } from 'vitest';
import { createInitialState, editState } from './state';

describe('caller-owned state', () => {
  it('starts with independent frozen nested data', () => {
    const first = createInitialState();
    const second = createInitialState();
    expect(first).toEqual({
      user: { name: 'Alice', age: 30 },
      settings: { theme: 'dark' },
    });
    expect(first).not.toBe(second);
    expect(first.user).not.toBe(second.user);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.user)).toBe(true);
    expect(Object.isFrozen(first.settings)).toBe(true);
  });

  it('copies a name edit without mutating retained state or accepting opaque values', () => {
    const before = createInitialState();
    const changed = editState(before, 'name', '<script>Ada</script>');
    expect(changed.error).toBeNull();
    expect(changed.state.user.name).toBe('<script>Ada</script>');
    expect(changed.state.user.age).toBe(30);
    expect(before.user.name).toBe('Alice');
    expect(Object.isFrozen(changed.state.user)).toBe(true);
    let invoked = 0;
    const opaque = {
      toString: () => {
        invoked++;
        return 'Ada';
      },
    };
    expect(editState(before, 'name', opaque).state).toBe(before);
    expect(invoked).toBe(0);
  });

  it('allows an empty name and bounds text without truncating', () => {
    const before = createInitialState();
    expect(editState(before, 'name', '').state.user.name).toBe('');
    expect(editState(before, 'name', 'x'.repeat(256)).error).toBeNull();
    const invalid = editState(before, 'name', 'x'.repeat(257));
    expect(invalid.state).toBe(before);
    expect(invalid.error).toBe('Use at most 256 characters for the name.');
  });

  it('accepts bounded integral age drafts including zero', () => {
    for (const [draft, age] of [
      ['0', 0],
      ['42', 42],
      ['150', 150],
    ] as const) {
      const before = createInitialState();
      const changed = editState(before, 'age', draft);
      expect(changed.error).toBeNull();
      expect(changed.state.user.age).toBe(age);
      expect(changed.state.user.name).toBe('Alice');
      expect(before.user.age).toBe(30);
    }
  });

  it('retains the last valid age when a draft is blank, nonfinite or outside the range', () => {
    const before = editState(createInitialState(), 'age', '42').state;
    for (const draft of [
      '',
      ' ',
      '-1',
      '151',
      '1.5',
      'Infinity',
      'NaN',
      '0x10',
      '1e2',
      31,
      null,
      {},
    ]) {
      const invalid = editState(before, 'age', draft);
      expect(invalid.state).toBe(before);
      expect(invalid.error).toBe('Enter a whole age from 0 to 150.');
      expect(invalid.state.user.age).toBe(42);
    }
  });

  it('admits only the two authored theme values', () => {
    const before = createInitialState();
    const changed = editState(before, 'theme', 'light');
    expect(changed.error).toBeNull();
    expect(changed.state.settings.theme).toBe('light');
    expect(before.settings.theme).toBe('dark');
    expect(Object.isFrozen(changed.state.settings)).toBe(true);
    for (const value of ['system', '', null, {}]) {
      const invalid = editState(before, 'theme', value);
      expect(invalid.state).toBe(before);
      expect(invalid.error).toBe('Choose Dark or Light.');
    }
  });
});
