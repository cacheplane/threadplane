import type { ThreadState } from '@langchain/langgraph-sdk';
import { describe, expect, it } from 'vitest';
import {
  identifyInterrupts,
  projectHistoryInterrupts,
  projectInterrupts,
  resumeValue,
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

describe('published interrupt ids', () => {
  it('keeps backend ids and names the rest by breakpoint or position', () => {
    const wire = projectInterrupts(
      [],
      control([
        { id: 'approve', value: 'Proceed?', namespace: ['task'] },
        { value: 'No id' },
        { id: 'interrupt-1', value: 'Taken name' },
      ])
    );
    const published = identifyInterrupts(wire);
    expect(published).toEqual([
      { id: 'approve', value: 'Proceed?', namespace: ['task'] },
      { id: 'interrupt-1-1', value: 'No id' },
      { id: 'interrupt-1', value: 'Taken name' },
    ]);
    expect(published[0]).toBe(wire[0]);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published[1])).toBe(true);
    // One wire batch has one published list.
    expect(identifyInterrupts(wire)).toBe(published);
    expect(identifyInterrupts(projectInterrupts([], control([])))).toEqual([
      { id: 'breakpoint', when: 'breakpoint' },
    ]);
    expect(
      identifyInterrupts(projectInterrupts([], control([{ value: 0 }])))
    ).toEqual([{ id: 'interrupt-0', value: 0 }]);
  });
});

describe('resume value', () => {
  const one = projectInterrupts([], control([{ id: 'approve', value: 'Q' }]));
  const several = projectInterrupts(
    [],
    control([{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { value: 3 }])
  );

  it('sends the response value as is for one pending interrupt', () => {
    for (const value of [undefined, null, false, 0, '', { approve: true }])
      expect(
        resumeValue(
          [{ interruptId: 'approve', status: 'resolved', value }],
          one
        )
      ).toBe(value);
    const breakpoint = projectInterrupts([], control([]));
    expect(
      resumeValue(
        [{ interruptId: 'breakpoint', status: 'resolved' }],
        breakpoint
      )
    ).toBeUndefined();
    const unnamed = projectInterrupts([], control([{ value: 'Q' }]));
    expect(
      resumeValue(
        [{ interruptId: 'interrupt-0', status: 'resolved', value: 'yes' }],
        unnamed
      )
    ).toBe('yes');
  });

  it('answers several pending interrupts by backend id, all or some', () => {
    expect(
      resumeValue(
        [
          { interruptId: 'b', status: 'resolved', value: { ok: true } },
          { interruptId: 'a', status: 'resolved', value: null },
        ],
        several
      )
    ).toEqual({ b: { ok: true }, a: null });
    expect(
      resumeValue(
        [{ interruptId: 'a', status: 'resolved', value: 'only' }],
        several
      )
    ).toEqual({ a: 'only' });
  });

  it.each([
    [undefined, /at least one/],
    [[], /at least one/],
    [[null], /names its interrupt by id/],
    [[{ status: 'resolved' }], /names its interrupt by id/],
    [
      [{ interruptId: 'other', status: 'resolved' }],
      /No pending interrupt has the id "other"/,
    ],
    [
      [
        { interruptId: 'approve', status: 'resolved' },
        { interruptId: 'approve', status: 'resolved' },
      ],
      /"approve" is answered twice/,
    ],
    [
      [{ interruptId: 'approve', status: 'cancelled' }],
      /cannot cancel an interrupt/,
    ],
    [[{ interruptId: 'approve', status: 'done' }], /status "resolved"/],
    [[{ interruptId: 'approve' }], /status "resolved"/],
  ])('rejects %j', (responses, message) => {
    expect(() => resumeValue(responses, one)).toThrow(TypeError);
    expect(() => resumeValue(responses, one)).toThrow(message);
  });

  it('rejects what a batch answered by id cannot express', () => {
    expect(() =>
      resumeValue(
        [{ interruptId: 'interrupt-2', status: 'resolved', value: 1 }],
        several
      )
    ).toThrow(/has no backend id/);
    expect(() =>
      resumeValue([{ interruptId: 'a', status: 'resolved' }], several)
    ).toThrow(/needs a value while several interrupts are pending/);
  });

  it('reads each response field once', () => {
    const reads: string[] = [];
    const response = {
      get interruptId() {
        reads.push('interruptId');
        return 'approve';
      },
      get status() {
        reads.push('status');
        return 'resolved';
      },
      get value() {
        reads.push('value');
        return 1;
      },
    };
    expect(resumeValue([response], one)).toBe(1);
    expect(reads).toEqual(['interruptId', 'status', 'value']);
  });
});
