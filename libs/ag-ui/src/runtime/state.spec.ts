import { describe, expect, it, vi } from 'vitest';
import {
  EventType,
  type StateDeltaEvent,
  type StateSnapshotEvent,
} from '@ag-ui/client';
import { applyState, ownState, requestState } from './state';

const snapshot = (value: unknown): StateSnapshotEvent => ({
  type: EventType.STATE_SNAPSHOT,
  snapshot: value,
});
const delta = (value: StateDeltaEvent['delta']): StateDeltaEvent => ({
  type: EventType.STATE_DELTA,
  delta: value,
});

function frozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) frozen(child);
}

function richState() {
  const items = new Array(3);
  items[1] = undefined;
  items[2] = { optional: undefined, value: 1 };
  Object.defineProperty(items, 'extra', {
    value: { label: 'extra' },
    enumerable: true,
  });
  const source = Object.assign(Object.create(null), {
    items,
    optional: undefined,
  });
  Object.defineProperty(source, '__proto__', {
    value: { safe: true },
    enumerable: true,
  });
  Object.defineProperty(source, 'constructor', {
    value: null,
    enumerable: true,
  });
  return Object.freeze(source);
}

describe('private state ownership', () => {
  it.each([null, undefined, false, true, '', 'literal', 0, -0, 7, [], {}])(
    'captures literal snapshot root %s',
    (value) => {
      const output = applyState(ownState({ old: true }), snapshot(value));
      expect(output).toStrictEqual(value);
      frozen(output);
    }
  );

  it('captures all portable data and never trusts an externally frozen parent', () => {
    const source = richState();
    const owned = ownState(source);
    expect(owned).not.toBe(source);
    frozen(owned);
    const first = requestState(owned) as typeof source;
    const second = requestState(owned) as typeof source;
    for (const output of [owned, first, second] as (typeof source)[]) {
      expect(Object.getPrototypeOf(output)).toBe(null);
      expect(Object.keys(output)).toEqual([
        'items',
        'optional',
        '__proto__',
        'constructor',
      ]);
      expect(Object.keys(output.items)).toEqual(['1', '2', 'extra']);
      expect(output.items.length).toBe(3);
      expect(Object.hasOwn(output.items, 0)).toBe(false);
      expect(Object.hasOwn(output.items, 1)).toBe(true);
      expect(output.items[1]).toBeUndefined();
      expect(Object.getPrototypeOf(output.items)).toBe(Array.prototype);
      expect(output.items).not.toBe(source.items);
    }
    expect(Object.isFrozen(source.items[2])).toBe(false);
    source.items[2].value = 9;
    first.items[2].value = 10;
    first.items.push('mutable');
    first.items.extra.label = 'mutable';
    first.__proto__.safe = false;
    expect(second.items[2].value).toBe(1);
    expect(second.items.extra.label).toBe('extra');
    expect(second.__proto__.safe).toBe(true);
    expect(requestState(owned)).toStrictEqual(second);
  });

  it('applies all six operations while keeping old observations and caller payloads immutable', () => {
    const previous = ownState({
      items: [{ value: 1 }, { value: 2 }],
      keep: { value: 3 },
    });
    const payload = { optional: undefined, nested: [1] };
    const event = delta([
      { op: 'test', path: '/items/0/value', value: 1 },
      { op: 'replace', path: '/items/0/value', value: 4 },
      { op: 'add', path: '/added', value: payload },
      { op: 'copy', from: '/added', path: '/copied' },
      { op: 'move', from: '/items/1', path: '/moved' },
      { op: 'remove', path: '/added' },
    ]);
    const next = applyState(previous, event);
    payload.nested.push(9);
    expect(next).toStrictEqual({
      items: [{ value: 4 }],
      keep: { value: 3 },
      copied: { optional: undefined, nested: [1] },
      moved: { value: 2 },
    });
    expect(previous).toEqual({
      items: [{ value: 1 }, { value: 2 }],
      keep: { value: 3 },
    });
    frozen(next);
    expect(Object.isFrozen(payload.nested)).toBe(false);
  });

  it('keeps identity only for unchanged documents and distinguishes signed zero root replacement', () => {
    const previous = ownState({ value: 1 });
    expect(applyState(previous, delta([]))).toBe(previous);
    expect(
      applyState(previous, delta([{ op: 'test', path: '/value', value: 1 }]))
    ).toBe(previous);
    expect(applyState(0, delta([{ op: 'replace', path: '', value: -0 }]))).toBe(
      -0
    );
    expect(
      applyState(
        previous,
        delta([{ op: 'replace', path: '', value: undefined }])
      )
    ).toBeUndefined();
  });

  it('reads admitted getters once and captures the entire delta before execution', () => {
    const valueGetter = vi.fn(() => ({ optional: undefined }));
    const source = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: valueGetter,
    });
    const snapshotGetter = vi.fn(() => source);
    const event = Object.defineProperty(
      { type: EventType.STATE_SNAPSHOT },
      'snapshot',
      { get: snapshotGetter }
    ) as StateSnapshotEvent;
    expect(applyState(null, event)).toStrictEqual({
      value: { optional: undefined },
    });
    expect(valueGetter).toHaveBeenCalledOnce();
    expect(snapshotGetter).toHaveBeenCalledOnce();
    const operationGetter = vi.fn(() => ({ optional: undefined }));
    const ops = [
      {
        op: 'add',
        path: '/added',
        get value() {
          return operationGetter();
        },
      },
    ];
    const deltaGetter = vi.fn(() => ops);
    const deltaEvent = Object.defineProperty(
      { type: EventType.STATE_DELTA },
      'delta',
      { get: deltaGetter }
    ) as StateDeltaEvent;
    expect(applyState(ownState({}), deltaEvent)).toStrictEqual({
      added: { optional: undefined },
    });
    expect(deltaGetter).toHaveBeenCalledOnce();
    expect(operationGetter).toHaveBeenCalledOnce();
    const failure = { opaque: 'last operation getter' };
    const broken = [
      { op: 'replace', path: '/missing', value: 1 },
      {
        op: 'add',
        path: '/later',
        get value(): never {
          throw failure;
        },
      },
    ];
    expect(() => applyState(ownState({}), delta(broken))).toThrow(failure);
  });

  it.each([
    new (class Data {
      value = 1;
    })(),
    new Date(),
    () => undefined,
    Symbol('value'),
  ])(
    'rejects nonportable data %s without altering prior observations or caller values',
    (invalid) => {
      const previous = ownState({ value: 1 });
      const valid = { nested: [1] };
      for (const event of [
        snapshot({ valid, invalid }),
        delta([
          { op: 'replace', path: '/value', value: valid },
          { op: 'add', path: '/invalid', value: invalid },
        ]),
      ]) {
        expect(() => applyState(previous, event)).toThrow(TypeError);
        expect(previous).toEqual({ value: 1 });
        expect(Object.isFrozen(valid.nested)).toBe(false);
      }
    }
  );

  it('propagates cycles and throwing getters without publishing partial batches', () => {
    const previous = ownState({ value: 1 });
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(() => ownState(cycle)).toThrow(TypeError);
    expect(Object.isFrozen(cycle)).toBe(false);
    const error = new Error('getter');
    const source = {
      get value(): never {
        throw error;
      },
    };
    expect(() => applyState(previous, snapshot(source))).toThrow(error);
    for (const invalid of [
      { op: 'replace', path: '/missing', value: 1 },
      { op: 'copy', from: '/missing', path: '/copied' },
    ]) {
      expect(() =>
        applyState(
          previous,
          delta([{ op: 'replace', path: '/value', value: 9 }, invalid])
        )
      ).toThrow();
      expect(previous).toEqual({ value: 1 });
    }
  });

  it('does not inspect event metadata or normalize protocol-shaped state', () => {
    const value = {
      role: 'future',
      arguments: '{ unfinished',
      subagentRunId: null,
    };
    const event = Object.assign(snapshot(value), { metadata: () => undefined });
    expect(applyState(undefined, event)).toStrictEqual(value);
  });
});
