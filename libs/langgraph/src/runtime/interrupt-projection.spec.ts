import type { ThreadState } from '@langchain/langgraph-sdk';
import { describe, expect, it } from 'vitest';
import {
  projectHistoryInterrupts,
  projectInterrupts,
} from './interrupt-projection';
import type { StreamEvent } from './transport.types';

const control = (
  interrupts: unknown,
  type: 'values' | 'updates' = 'values'
): StreamEvent => ({
  type,
  data: { __interrupt__: interrupts },
});
const history = (...checkpoints: unknown[]) => checkpoints as ThreadState[];
const pending = () =>
  projectInterrupts([], control([{ id: 'first', value: 'pending' }]));

describe('interrupt projection', () => {
  for (const type of ['values', 'updates'] as const) {
    it(`reads root ${type} controls and preserves all SDK metadata and falsy payloads`, () => {
      const batch = [
        {
          id: 'a',
          value: { action_requests: [{ name: 'keep_wire_names' }] },
          namespace: ['child', 'task'],
          when: 'during',
          resumable: false,
          ns: ['legacy'],
        },
        { value: false },
        { value: 0 },
        { value: '' },
        { value: null },
        { value: undefined },
        {},
      ];
      expect(projectInterrupts([], control(batch, type))).toEqual(batch);
    });
  }

  for (const type of ['interrupt', 'interrupts'] as const) {
    for (const location of ['data', 'outer'] as const) {
      it(`reads the ${location} standalone ${type} wrapper`, () => {
        const item = { id: 'one', value: false };
        const payload = { [type]: type === 'interrupt' ? item : [item] };
        const event: StreamEvent =
          location === 'data' ? { type, data: payload } : { type, ...payload };
        expect(projectInterrupts([], event)).toEqual([item]);
      });
    }
  }

  it('merges batches in wire order with first string IDs retained and anonymous entries distinct', () => {
    const first = projectInterrupts(
      [],
      control([{ id: 'a', value: 1 }, { value: false }])
    );
    const next = projectInterrupts(
      first,
      control([
        { id: 'a', value: 'duplicate' },
        { id: 'b', value: 2 },
        { id: 'b', value: 'duplicate in batch' },
        { value: false },
        { id: '', value: 3 },
        { id: '', value: 4 },
      ])
    );
    expect(next).toEqual([
      { id: 'a', value: 1 },
      { value: false },
      { id: 'b', value: 2 },
      { value: false },
      { id: '', value: 3 },
    ]);
    expect(next[0]).toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next[3]).not.toBe(next[1]);
    expect(
      projectInterrupts(next, control([{ id: 'a', value: 'later' }]))
    ).toBe(next);
  });

  it('replaces dynamic batches with a breakpoint and replaces that sentinel with later dynamic controls', () => {
    const first = pending();
    const breakpoint = projectInterrupts(first, control([]));
    expect(breakpoint).toEqual([{ when: 'breakpoint' }]);
    expect(Object.isFrozen(breakpoint)).toBe(true);
    expect(Object.isFrozen(breakpoint[0])).toBe(true);
    expect(projectInterrupts(breakpoint, control([], 'updates'))).toBe(
      breakpoint
    );
    expect(
      projectInterrupts(breakpoint, control([{ id: 'next', value: 2 }]))
    ).toEqual([{ id: 'next', value: 2 }]);
  });

  it('clears on explicit empty standalone interrupts rather than creating a breakpoint', () => {
    const empty = projectInterrupts(pending(), {
      type: 'interrupts',
      data: { interrupts: [] },
    });
    expect(empty).toEqual([]);
    expect(Object.isFrozen(empty)).toBe(true);
    expect(
      projectInterrupts(empty, { type: 'interrupts', interrupts: [] })
    ).toBe(empty);
  });

  for (const data of [
    undefined,
    null,
    false,
    0,
    '',
    [],
    {},
    { interrupts: null },
  ]) {
    it(`does not fall back to an outer standalone wrapper when data is explicitly ${JSON.stringify(
      data
    )}`, () => {
      const previous = pending();
      expect(
        projectInterrupts(previous, {
          type: 'interrupts',
          data,
          interrupts: [{ id: 'wrong' }],
        })
      ).toBe(previous);
    });
  }

  it('requires the supported record/list wrapper shapes and own control fields', () => {
    const previous = pending();
    const malformed: StreamEvent[] = [
      { type: 'interrupt', data: { id: 'unwrapped' } },
      { type: 'interrupt', interrupt: [] },
      { type: 'interrupt', interrupt: 'wrong' },
      { type: 'interrupts', interrupts: {} },
      { type: 'interrupts', interrupts: [null] },
      control({ value: 'not an array' }),
      control([false]),
      control(undefined),
      {
        type: 'updates',
        data: { node: { __interrupt__: [{ id: 'nested' }] } },
      },
      { type: 'values', data: { messages: [], stage: 'complete' } },
    ];
    for (const event of malformed)
      expect(projectInterrupts(previous, event)).toBe(previous);
    const inherited = Object.create({ __interrupt__: [{ id: 'inherited' }] });
    // The inherited field is not a control; prototype-only records are unsupported if selected.
    expect(
      projectInterrupts(previous, { type: 'values', data: inherited })
    ).toBe(previous);
  });

  for (const event of [
    { type: 'values', namespace: ['child'] },
    { type: 'updates|child' },
    { type: 'checkpoints|child' },
    { type: 'interrupt', namespace: ['child'] },
    { type: 'custom' },
    { type: 'messages' },
    { type: 'messages/complete' },
    { type: 'tasks' },
  ] satisfies StreamEvent[]) {
    it(`ignores ${event.type} without reading interrupt payload getters`, () => {
      const previous = pending();
      expect(
        projectInterrupts(previous, {
          ...event,
          get data() {
            throw new Error('unrelated data');
          },
          get interrupts() {
            throw new Error('unrelated outer control');
          },
        })
      ).toBe(previous);
    });
  }

  it('replaces from root checkpoints and uses values controls before all task controls', () => {
    const checkpoint = {
      values: { __interrupt__: [{ id: 'values' }] },
      tasks: [{ interrupts: [{ id: 'task' }] }],
    };
    expect(
      projectInterrupts(pending(), { type: 'checkpoints', data: checkpoint })
    ).toEqual([{ id: 'values' }]);
    expect(projectHistoryInterrupts(pending(), history(checkpoint))).toEqual([
      { id: 'values' },
    ]);
    checkpoint.values.__interrupt__ = [];
    expect(projectHistoryInterrupts(pending(), history(checkpoint))).toEqual([
      { when: 'breakpoint' },
    ]);
  });

  it('restores every latest task interrupt in order without older or nested child task state', () => {
    const checkpoint = {
      values: { __interrupt__: 'malformed' },
      tasks: [
        { interrupts: [{ id: 'one', value: 1 }, { value: 'anonymous' }] },
        {
          interrupts: [
            { id: 'two', value: 2 },
            { id: 'one', value: 'duplicate' },
          ],
        },
        { state: { values: { __interrupt__: [{ id: 'child' }] } } },
        { interrupts: [] },
      ],
    };
    const expected = [
      { id: 'one', value: 1 },
      { value: 'anonymous' },
      { id: 'two', value: 2 },
    ];
    expect(
      projectHistoryInterrupts(
        pending(),
        history(checkpoint, { values: { __interrupt__: [{ id: 'old' }] } })
      )
    ).toEqual(expected);
    expect(
      projectInterrupts(pending(), { type: 'checkpoints', data: checkpoint })
    ).toEqual(expected);
  });

  it('clears authoritative missing history and checkpoints without inferring a pause from next', () => {
    const previous = pending();
    expect(projectHistoryInterrupts(previous, [])).toEqual([]);
    for (const checkpoint of [
      {},
      { next: ['pending'] },
      { values: {}, tasks: [] },
      { tasks: [{}] },
    ]) {
      expect(projectHistoryInterrupts(previous, history(checkpoint))).toEqual(
        []
      );
      expect(
        projectInterrupts(previous, { type: 'checkpoints', data: checkpoint })
      ).toEqual([]);
    }
  });

  for (const input of [undefined, null, false, 0, '', []]) {
    it(`ignores nonrecord live containers and treats nonrecord history as empty (${JSON.stringify(
      input
    )})`, () => {
      const previous = pending();
      expect(projectInterrupts(previous, { type: 'values', data: input })).toBe(
        previous
      );
      expect(
        projectInterrupts(previous, { type: 'checkpoints', data: input })
      ).toBe(previous);
      expect(projectHistoryInterrupts(previous, history(input))).toEqual([]);
    });
  }

  it('owns nested plain data, never freezes the source, and isolates later mutations', () => {
    const item = {
      id: 'a',
      value: { items: [{ count: 1 }] },
      namespace: ['root'],
      ns: ['legacy'],
    };
    const batch = [item];
    const next = projectInterrupts([], control(batch));
    expect(next).not.toBe(batch);
    expect(next[0]).not.toBe(item);
    expect(next[0].value).not.toBe(item.value);
    expect(Object.isFrozen(item)).toBe(false);
    expect(Object.isFrozen(item.value.items)).toBe(false);
    item.value.items[0].count = 2;
    item.namespace.push('later');
    expect(next[0]).toEqual({
      id: 'a',
      value: { items: [{ count: 1 }] },
      namespace: ['root'],
      ns: ['legacy'],
    });
    expect(Object.isFrozen(next[0].value)).toBe(true);
    expect(Object.isFrozen(next[0].namespace)).toBe(true);
  });

  it('preserves equal history array identity and unchanged nested branches in corrected records', () => {
    const checkpoint = {
      values: {
        __interrupt__: [
          { id: 'a', value: { stable: { count: 1 }, changed: 1 } },
          { id: 'b', value: false },
        ],
      },
    };
    const previous = projectHistoryInterrupts([], history(checkpoint));
    expect(
      projectHistoryInterrupts(previous, history(structuredClone(checkpoint)))
    ).toBe(previous);
    checkpoint.values.__interrupt__[0].value = {
      stable: { count: 1 },
      changed: 2,
    };
    const next = projectHistoryInterrupts(previous, history(checkpoint));
    expect(next).not.toBe(previous);
    expect(next[1]).toBe(previous[1]);
    expect((next[0].value as { stable: unknown }).stable).toBe(
      (previous[0].value as { stable: unknown }).stable
    );
  });

  it('does not trust shallow-frozen external prior arrays or records', () => {
    const value = { count: 1 };
    const source = Object.freeze([Object.freeze({ value })]);
    const next = projectHistoryInterrupts(
      source,
      history({ values: { __interrupt__: source } })
    );
    expect(next).not.toBe(source);
    value.count = 2;
    expect(next).toEqual([{ value: { count: 1 } }]);
  });

  for (const unsupported of [new Date(0), new Map(), () => undefined, 1n]) {
    it(`rejects unsupported nested payloads (${typeof unsupported})`, () => {
      expect(() =>
        projectInterrupts([], control([{ value: unsupported }]))
      ).toThrow(TypeError);
      expect(() =>
        projectHistoryInterrupts(
          [],
          history({ tasks: [{ interrupts: [{ value: unsupported }] }] })
        )
      ).toThrow(TypeError);
    });
  }

  it('rejects unsupported root interrupt records before selection can disguise their prototype', () => {
    class SdkInterrupt {
      id = 'sdk';
      value = 'unsupported';
    }
    expect(() => projectInterrupts([], control([new SdkInterrupt()]))).toThrow(
      TypeError
    );
    expect(() =>
      projectInterrupts([], {
        type: 'interrupt',
        interrupt: new SdkInterrupt(),
      })
    ).toThrow(TypeError);
    class SdkControl {
      __interrupt__ = [{ id: 'sdk' }];
    }
    expect(() =>
      projectInterrupts([], { type: 'values', data: new SdkControl() })
    ).toThrow(TypeError);
    expect(() =>
      projectHistoryInterrupts([], history({ values: new SdkControl() }))
    ).toThrow(TypeError);
  });

  it('rejects cyclic selected payloads without freezing caller data', () => {
    const value: Record<string, unknown> = {};
    value['self'] = value;
    expect(() => projectInterrupts([], control([{ value }]))).toThrow(
      TypeError
    );
    expect(() =>
      projectHistoryInterrupts(
        [],
        history({ values: { __interrupt__: [{ value }] } })
      )
    ).toThrow(TypeError);
    expect(value['self']).toBe(value);
    expect(Object.isFrozen(value)).toBe(false);
  });
});
