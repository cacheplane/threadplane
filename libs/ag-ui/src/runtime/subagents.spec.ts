import { ok } from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import {
  EventType,
  type SubagentStartedEvent,
  type SubagentFinishedEvent,
  type SubagentErrorEvent,
} from '@ag-ui/client';
import { applySubagent, type Subagents } from './subagents';

const start = (subagentRunId = 'child'): SubagentStartedEvent => ({
  type: EventType.SUBAGENT_STARTED,
  subagentRunId,
  name: 'Worker',
});
const finish = (subagentRunId = 'child'): SubagentFinishedEvent => ({
  type: EventType.SUBAGENT_FINISHED,
  subagentRunId,
});
const failure = (subagentRunId = 'child'): SubagentErrorEvent => ({
  type: EventType.SUBAGENT_ERROR,
  subagentRunId,
  message: 'failed',
});
function frozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) frozen(child);
}

describe('private native child observation', () => {
  it('owns every start descriptor field and metadata without retaining external data', () => {
    const event: SubagentStartedEvent = {
      ...start(),
      description: 'Inspect',
      parentSubagentRunId: 'parent',
      parentToolCallId: 'call',
      parentMessageId: 'message',
      timestamp: 0,
      metadata: { trace: { attempts: [1] } },
    };
    const previous: Subagents = Object.freeze([]);
    const next = applySubagent(previous, event);
    expect(next).toStrictEqual([{ started: event }]);
    expect(next).not.toBe(previous);
    expect(previous).toEqual([]);
    expect(next[0].started).not.toBe(event);
    expect(next[0].started.metadata).not.toBe(event.metadata);
    frozen(next);
    ok(event.metadata);
    (event.metadata['trace'] as { attempts: number[] }).attempts.push(2);
    event.name = 'changed';
    expect(next[0].started.name).toBe('Worker');
    expect(next[0].started.metadata).toEqual({ trace: { attempts: [1] } });
  });

  it.each([
    undefined,
    { type: 'success' },
    { type: 'suspended' },
    { type: 'suspended', interruptIds: [] },
    { type: 'suspended', interruptIds: ['approval'] },
  ] satisfies SubagentFinishedEvent['outcome'][])(
    'captures finish outcome %j literally with owned result and separate metadata',
    (outcome) => {
      const previous = applySubagent([], {
        ...start(),
        metadata: { start: true },
      });
      const event: SubagentFinishedEvent = {
        ...finish(),
        result: { items: [1] },
        timestamp: 7,
        metadata: { finish: { value: true } },
        ...(outcome !== undefined && { outcome }),
      };
      const next = applySubagent(previous, event);
      expect(next).toStrictEqual([
        { started: previous[0].started, terminal: event },
      ]);
      expect(next[0].started).toBe(previous[0].started);
      expect(previous[0]).not.toHaveProperty('terminal');
      expect(next[0].terminal).not.toBe(event);
      expect(next[0].terminal?.metadata).toEqual({ finish: { value: true } });
      ok(next[0].terminal);
      expect(Object.hasOwn(next[0].terminal, 'outcome')).toBe(
        outcome !== undefined
      );
      frozen(next);
      event.result.items.push(2);
      if (outcome?.type === 'suspended') outcome.interruptIds?.push('changed');
      expect((next[0].terminal as SubagentFinishedEvent).result).toEqual({
        items: [1],
      });
      if (outcome?.type === 'suspended')
        expect((next[0].terminal as SubagentFinishedEvent).outcome).not.toBe(
          outcome
        );
    }
  );

  it('captures error evidence without synthesizing an outcome or merging metadata', () => {
    const previous = applySubagent([], {
      ...start(),
      metadata: { start: true },
    });
    const event = {
      ...failure(),
      code: '',
      timestamp: 0,
      metadata: { error: [1] },
    };
    const next = applySubagent(previous, event);
    expect(next[0].terminal).toStrictEqual(event);
    expect(next[0].started).toBe(previous[0].started);
    expect(next[0].terminal).not.toHaveProperty('outcome');
    frozen(next);
    event.metadata.error.push(2);
    expect(next[0].terminal?.metadata).toEqual({ error: [1] });
  });

  it('preserves start order and shares unaffected siblings and existing starts', () => {
    const parent = applySubagent([], start('parent'));
    const sibling = applySubagent(parent, start('sibling'));
    const nested = applySubagent(sibling, {
      ...start('nested'),
      parentSubagentRunId: 'parent',
    });
    const closedParent = applySubagent(nested, finish('parent'));
    const descendant = applySubagent(closedParent, {
      ...start('later'),
      parentSubagentRunId: 'parent',
    });
    const next = applySubagent(descendant, failure('nested'));
    expect(next.map((record) => record.started.subagentRunId)).toEqual([
      'parent',
      'sibling',
      'nested',
      'later',
    ]);
    expect(sibling[0]).toBe(parent[0]);
    expect(nested[1]).toBe(sibling[1]);
    expect(next[0]).toBe(descendant[0]);
    expect(next[1]).toBe(sibling[1]);
    expect(next[2].started).toBe(nested[2].started);
    expect(next[3]).toBe(descendant[3]);
    frozen(next);
  });

  it.each(['', '__proto__', 'constructor', 'toString'])(
    'uses literal child identity %j without dictionary collisions',
    (id) => {
      const next = applySubagent(
        applySubagent([], { ...start(id), name: '' }),
        finish(id)
      );
      expect(next).toStrictEqual([
        { started: { ...start(id), name: '' }, terminal: finish(id) },
      ]);
    }
  );

  it.each([start(), finish(), failure()])(
    'rejects ambiguous selected identity for $type',
    (event) => {
      const previous = Object.freeze([
        { started: start() },
        { started: start() },
      ]);
      expect(() => applySubagent(previous, event)).toThrow(TypeError);
      expect(previous).toHaveLength(2);
    }
  );

  it.each([finish(), failure()])(
    'requires an existing selected start for $type',
    (event) => {
      expect(() => applySubagent([], event)).toThrow(TypeError);
    }
  );

  it.each([undefined, finish(), failure()])(
    'rejects another start after evidence %j',
    (terminal) => {
      const previous = applySubagent([], start());
      const observed = terminal ? applySubagent(previous, terminal) : previous;
      expect(() => applySubagent(observed, start())).toThrow(TypeError);
      expect(observed[0].started).toBe(previous[0].started);
    }
  );

  it.each([finish(), failure()])(
    'rejects repeated or conflicting terminal $type',
    (terminal) => {
      for (const first of [finish(), failure()]) {
        const previous = applySubagent(applySubagent([], start()), first);
        expect(() => applySubagent(previous, terminal)).toThrow(TypeError);
        expect(previous[0].terminal).toStrictEqual(first);
      }
    }
  );

  it('does not validate unrelated identities or parent links', () => {
    const previous = Object.freeze([
      { started: start('other') },
      { started: start('other') },
    ]);
    const event = { ...start(), parentSubagentRunId: 'missing' };
    const next = applySubagent(previous, event);
    expect(next[0]).toBe(previous[0]);
    expect(next[1]).toBe(previous[1]);
    expect(next[2]).toStrictEqual({ started: event });
  });

  it('omits undefined optional fields and preserves falsy values and null results', () => {
    const previous = applySubagent([], {
      ...start(''),
      name: '',
      description: '',
      parentSubagentRunId: '',
      parentToolCallId: '',
      parentMessageId: '',
      metadata: undefined,
      timestamp: 0,
    });
    expect(previous[0].started).toStrictEqual({
      ...start(''),
      name: '',
      description: '',
      parentSubagentRunId: '',
      parentToolCallId: '',
      parentMessageId: '',
      timestamp: 0,
    });
    for (const result of [null, false, '', 0]) {
      const next = applySubagent(previous, {
        ...finish(''),
        result,
        outcome: undefined,
        timestamp: undefined,
        metadata: undefined,
      });
      expect(next[0].terminal).toStrictEqual({ ...finish(''), result });
    }
    expect(
      applySubagent(previous, { ...finish(''), result: undefined })[0].terminal
    ).toStrictEqual(finish(''));
    expect(
      applySubagent(previous, { ...failure(''), code: undefined })[0].terminal
    ).toStrictEqual(failure(''));
  });

  it('owns portable nested data from a frozen external parent including special own keys and array holes', () => {
    const items = new Array(3);
    items[1] = undefined;
    items[2] = { value: 1 };
    Object.defineProperty(items, 'extra', {
      value: { value: 2 },
      enumerable: true,
    });
    const payload = Object.assign(Object.create(null), {
      items,
      optional: undefined,
    });
    Object.defineProperty(payload, '__proto__', {
      value: { safe: true },
      enumerable: true,
    });
    Object.defineProperty(payload, 'constructor', {
      value: null,
      enumerable: true,
    });
    Object.freeze(payload);
    const next = applySubagent(applySubagent([], start()), {
      ...finish(),
      result: payload,
    });
    const owned = (next[0].terminal as SubagentFinishedEvent).result;
    expect(owned).toStrictEqual(payload);
    expect(owned).not.toBe(payload);
    expect(Object.getPrototypeOf(owned)).toBe(null);
    expect(Object.keys(owned.items)).toEqual(['1', '2', 'extra']);
    expect(owned.items).toHaveLength(3);
    expect(Object.hasOwn(owned.items, 0)).toBe(false);
    expect(Object.hasOwn(owned.items, 1)).toBe(true);
    frozen(next);
    items[2].value = 3;
    payload.__proto__.safe = false;
    expect(owned.items[2]).toEqual({ value: 1 });
    expect(owned.__proto__).toEqual({ safe: true });
  });

  it.each(['cycle', 'function', 'class', 'throwing getter'])(
    'rejects nonportable %s atomically in start, finish, and error metadata',
    (kind) => {
      const cycle: { self?: unknown } = {};
      cycle.self = cycle;
      const bad =
        kind === 'cycle'
          ? cycle
          : kind === 'function'
          ? () => undefined
          : kind === 'class'
          ? new Date(0)
          : Object.defineProperty({}, 'value', {
              enumerable: true,
              get() {
                throw new TypeError('getter');
              },
            });
      const previous = applySubagent([], start());
      for (const event of [
        { ...start('next'), metadata: { bad } },
        { ...finish(), result: bad },
        { ...failure(), metadata: { bad } },
      ]) {
        expect(() => applySubagent(previous, event)).toThrow(TypeError);
        expect(previous).toStrictEqual([{ started: start() }]);
      }
    }
  );

  it.each([start(), finish(), failure()])(
    'ignores rawEvent and unknown extension getters for $type',
    (event) => {
      const fail = vi.fn(() => {
        throw new Error('unused');
      });
      Object.defineProperties(event, {
        rawEvent: { enumerable: true, get: fail },
        extension: { enumerable: true, get: fail },
      });
      const previous =
        event.type === EventType.SUBAGENT_STARTED
          ? []
          : applySubagent([], start());
      const next = applySubagent(previous, event);
      expect(next).toHaveLength(1);
      expect(fail).not.toHaveBeenCalled();
      const captured =
        event.type === EventType.SUBAGENT_STARTED
          ? next[0].started
          : next[0].terminal;
      expect(captured).not.toHaveProperty('rawEvent');
      expect(captured).not.toHaveProperty('extension');
    }
  );

  it.each([
    {
      ...start(),
      description: '',
      parentSubagentRunId: '',
      parentToolCallId: '',
      parentMessageId: '',
      timestamp: 0,
      metadata: { value: 1 },
    },
    {
      ...finish(),
      result: null,
      outcome: { type: 'success' as const },
      timestamp: 0,
      metadata: {},
    },
    { ...failure(), code: '', timestamp: 0, metadata: {} },
  ])('reads each used event field once for $type', (source) => {
    const getters = Object.fromEntries(
      Object.entries(source).map(([key, value]) => [key, vi.fn(() => value)])
    );
    const event = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(getters).map(([key, get]) => [
          key,
          { enumerable: true, get },
        ])
      )
    ) as typeof source;
    const previous =
      source.type === EventType.SUBAGENT_STARTED
        ? []
        : applySubagent([], start());
    const next = applySubagent(previous, event);
    expect(
      source.type === EventType.SUBAGENT_STARTED
        ? next[0].started
        : next[0].terminal
    ).toStrictEqual(source);
    for (const get of Object.values(getters))
      expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([start(), finish(), failure()])(
    'leaves previous evidence untouched when a used top-level getter throws for $type',
    (event) => {
      const previous = applySubagent([], start('existing'));
      const error = new Error('used metadata');
      Object.defineProperty(event, 'metadata', {
        get() {
          throw error;
        },
      });
      const selected =
        event.type === EventType.SUBAGENT_STARTED
          ? previous
          : applySubagent(previous, start());
      expect(() => applySubagent(selected, event)).toThrow(error);
      expect(selected[0]).toBe(previous[0]);
      expect(selected.every((record) => record.terminal === undefined)).toBe(
        true
      );
    }
  );
});
