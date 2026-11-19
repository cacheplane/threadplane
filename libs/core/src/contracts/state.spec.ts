import { describe, expect, it } from 'vitest';
import { readState, type, type StandardSchemaV1 } from '../index';

interface Board {
  count: number;
}

function schema<Output>(
  validate: StandardSchemaV1<unknown, Output>['~standard']['validate']
): StandardSchemaV1<unknown, Output> {
  return { '~standard': { version: 1, vendor: 'test', validate } };
}

const counted = schema<Board>((value) =>
  typeof (value as Board | null)?.count === 'number'
    ? { value: value as Board }
    : { issues: [{ message: 'count must be a number' }] }
);

describe('type', () => {
  it('returns one frozen marker that holds no value and is not a schema', () => {
    const declared = type<Board>();
    expect(declared).toBe(type<{ other: string }>());
    expect(Object.isFrozen(declared)).toBe(true);
    expect('~standard' in declared).toBe(false);
    expect('~type' in declared).toBe(false);
  });
});

describe('readState', () => {
  it('accepts every value as given when nothing checks it', () => {
    const value = { anything: [1, 'two'] };
    expect(readState(undefined, value)).toEqual({ valid: true, value });
    expect(readState(type<Board>(), value)).toEqual({ valid: true, value });
    expect(readState(type<Board>(), value)).toHaveProperty('value', value);
  });

  it('returns what a schema accepts', () => {
    const value = { count: 2 };
    const reading = readState(counted, value);
    expect(reading).toEqual({ valid: true, value });
  });

  it('returns the schema output, not the input, when the schema transforms', () => {
    const doubled = schema<Board>((value) => ({
      value: { count: (value as Board).count * 2 },
    }));
    expect(readState(doubled, { count: 2 })).toEqual({
      valid: true,
      value: { count: 4 },
    });
  });

  it('reports each issue message for a value the schema rejects', () => {
    expect(readState(counted, { count: 'two' })).toEqual({
      valid: false,
      issues: ['count must be a number'],
    });
    const several = schema<Board>(() => ({
      issues: [{ message: 'first' }, { message: 'second' }],
    }));
    expect(readState(several, {})).toEqual({
      valid: false,
      issues: ['first', 'second'],
    });
  });

  it('reports a schema that throws instead of throwing', () => {
    const throwing = schema<Board>(() => {
      throw new Error('broken schema');
    });
    expect(readState(throwing, {})).toEqual({
      valid: false,
      issues: ['broken schema'],
    });
  });

  it('reports an asynchronous schema as invalid and leaves no unhandled rejection', async () => {
    const resolving = schema<Board>(async (value) => ({
      value: value as Board,
    }));
    expect(readState(resolving, { count: 1 })).toEqual({
      valid: false,
      issues: ['State schemas must validate synchronously.'],
    });
    const rejecting = schema<Board>(() => Promise.reject(new Error('late')));
    expect(readState(rejecting, { count: 1 }).valid).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('reports a malformed schema result as invalid', () => {
    const empty = schema<Board>(() => undefined as never);
    expect(readState(empty, {})).toEqual({
      valid: false,
      issues: ['The schema returned no result.'],
    });
    const odd = schema<Board>(() => ({ issues: [null, {}] } as never));
    expect(readState(odd, {})).toEqual({
      valid: false,
      issues: ['Invalid state.', 'Invalid state.'],
    });
  });
});
