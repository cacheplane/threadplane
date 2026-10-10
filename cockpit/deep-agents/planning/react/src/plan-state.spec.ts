import { describe, expect, it } from 'vitest';
import { planProgress, planState } from './plan-state';

const row = (content = 'Task', status = 'pending') => ({ content, status });
describe('root todo projection', () => {
  it('treats an inert undefined root as not yet observed', () => {
    expect(planState(undefined)).toEqual({ kind: 'missing' });
  });
  it('copies and freezes ordered duplicate and empty text rows', () => {
    const todos = [
      row(''),
      row('Same'),
      row('Same', 'completed'),
      row('Work', 'in_progress'),
    ];
    const result = planState({ todos });
    expect(result).toEqual({ kind: 'valid', items: todos });
    if (result.kind !== 'valid') throw new Error('Expected valid projection');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(result.items.every(Object.isFrozen)).toBe(true);
    todos[0].content = 'Changed';
    expect(result.items[0].content).toBe('');
    expect(planProgress(result.items)).toEqual({ completed: 1, total: 4 });
  });
  it('accepts empty list as an explicit clear', () => {
    expect(planState({ todos: [] })).toEqual({ kind: 'valid', items: [] });
    expect(planProgress([])).toEqual({ completed: 0, total: 0 });
  });
  it('distinguishes missing from invalid', () => {
    expect(planState({ files: {} })).toEqual({ kind: 'missing' });
    expect(planState({ todos: null }).kind).toBe('invalid');
  });
  it('accepts exact bounds in UTF16 units', () => {
    expect(
      planState({
        todos: Array.from({ length: 50 }, () => row('😀'.repeat(1000))),
      }).kind
    ).toBe('valid');
  });
  it.each([
    null,
    [],
    new Date(),
    Object.create({ todos: [] }),
    { todos: '[]' },
    { todos: Array(1) },
    { todos: [null] },
    { todos: [row('x', 'done')] },
    { todos: [row('x', 'Pending')] },
    { todos: [{ content: 1, status: 'pending' }] },
    { todos: [{ content: 'x' }] },
    { todos: [{ ...row(), id: 'fake' }] },
    { todos: [Object.create(row())] },
    { todos: Array.from({ length: 51 }, () => row()) },
    { todos: [row('😀'.repeat(1000) + 'a')] },
  ])('rejects malformed, inherited and out-of-bound input %#', (input) => {
    expect(planState(input).kind).toBe('invalid');
  });
  it('rejects getters without invoking them', () => {
    let reads = 0;
    const input = Object.defineProperty({}, 'todos', {
      enumerable: true,
      get() {
        reads++;
        return [];
      },
    });
    expect(planState(input).kind).toBe('invalid');
    expect(reads).toBe(0);
  });
});
