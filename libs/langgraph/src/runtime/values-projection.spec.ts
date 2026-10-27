import type { ThreadState } from '@langchain/langgraph-sdk';
import { describe, expect, it } from 'vitest';
import { projectHistoryValues, projectValues } from './values-projection';
import type { StreamEvent } from './transport.types';

const values = (data?: unknown): StreamEvent => ({ type: 'values', data });
const checkpoint = (data?: unknown): StreamEvent => ({
  type: 'checkpoints',
  data,
});
const history = (value: unknown) => [{ values: value }] as ThreadState[];

describe('application values projection', () => {
  it('distinguishes unobserved values from an observed empty root', () => {
    expect(projectValues(undefined, values())).toBeUndefined();
    const empty = projectValues(undefined, values({}));
    expect(empty).toEqual({});
    expect(Object.isFrozen(empty)).toBe(true);
    expect(projectValues(empty, values({ messages: [] }))).toBe(empty);
  });

  it('replaces root state, correcting values and deleting omitted keys', () => {
    const previous = projectValues(
      undefined,
      values({ text: 'Long answer', removed: 1, list: [1, 2] })
    );
    const next = projectValues(
      previous,
      values({
        text: '',
        list: [],
        zero: 0,
        no: false,
        nil: null,
        absent: undefined,
      })
    );
    expect(next).toEqual({
      text: '',
      list: [],
      zero: 0,
      no: false,
      nil: null,
      absent: undefined,
    });
    expect(Object.hasOwn(next ?? {}, 'removed')).toBe(false);
    expect(Object.hasOwn(next ?? {}, 'absent')).toBe(true);
    expect(previous).toEqual({ text: 'Long answer', removed: 1, list: [1, 2] });
  });

  it('excludes only reserved fields in authoritative checkpoints and history', () => {
    const input = {
      messages: ['wire'],
      __interrupt__: [],
      tools: [],
      __other__: true,
      nested: { messages: 'keep', __interrupt__: 'keep' },
    };
    const expected = {
      tools: [],
      __other__: true,
      nested: { messages: 'keep', __interrupt__: 'keep' },
    };
    const next = projectValues(undefined, checkpoint({ values: input }));
    expect(next).toEqual(expected);
    expect(projectHistoryValues(undefined, history(input))).toEqual(expected);
    expect(input.messages).toEqual(['wire']);
  });

  for (const interrupt of [[], [{ value: 'pause' }], undefined]) {
    it(`ignores live interrupt control envelopes (${JSON.stringify(
      interrupt
    )})`, () => {
      const previous = projectValues(undefined, values({ saved: 'state' }));
      expect(
        projectValues(previous, values({ __interrupt__: interrupt }))
      ).toBe(previous);
      expect(
        projectValues(
          previous,
          values({ __interrupt__: interrupt, saved: 'ignore control payload' })
        )
      ).toBe(previous);
      expect(
        projectValues(undefined, values({ __interrupt__: interrupt }))
      ).toBeUndefined();
    });
  }

  it('requires explicit checkpoint data.values and replaces from that record', () => {
    const previous = projectValues(undefined, values({ keep: 1 }));
    expect(projectValues(previous, checkpoint({ keep: 2 }))).toBe(previous);
    expect(projectValues(previous, checkpoint({ values: {} }))).toEqual({});
    expect(
      projectValues(previous, checkpoint({ values: { next: 2 }, ignored: 1 }))
    ).toEqual({ next: 2 });
  });

  for (const data of [undefined, null, false, 0, '', []]) {
    it(`ignores non-record live state but clears non-record history (${JSON.stringify(
      data
    )})`, () => {
      const previous = projectValues(undefined, values({ keep: true }));
      expect(projectValues(previous, values(data))).toBe(previous);
      expect(projectValues(previous, checkpoint({ values: data }))).toBe(
        previous
      );
      expect(projectHistoryValues(previous, history(data))).toBeUndefined();
    });
  }

  it('uses only the latest history checkpoint and treats missing history as authoritative', () => {
    const previous = projectValues(undefined, values({ stale: true }));
    const next = projectHistoryValues(previous, [
      ...history({ fresh: 2 }),
      ...history({ old: 1 }),
    ]);
    expect(next).toEqual({ fresh: 2 });
    expect(projectHistoryValues(next, [])).toBeUndefined();
    expect(projectHistoryValues(next, [{}] as ThreadState[])).toBeUndefined();
    expect(projectHistoryValues(next, history({}))).toEqual({});
  });

  for (const event of [
    { type: 'values', namespace: ['child'], data: { wrong: true } },
    {
      type: 'checkpoints',
      namespace: ['child'],
      data: { values: { wrong: true } },
    },
    { type: 'values|child', data: { wrong: true } },
    { type: 'checkpoints|child', data: { values: { wrong: true } } },
    { type: 'updates', data: { node: { wrong: true } } },
    { type: 'custom', data: { wrong: true } },
    { type: 'messages', data: { wrong: true } },
    { type: 'messages/complete', data: { wrong: true } },
  ] satisfies StreamEvent[]) {
    it(`ignores ${event.type} namespace=${
      'namespace' in event ? event.namespace : ''
    }`, () => {
      const previous = projectValues(undefined, values({ keep: 1 }));
      expect(projectValues(previous, event)).toBe(previous);
      expect(projectValues(undefined, event)).toBeUndefined();
    });
  }

  it('retains equal root identity across key order and history reads', () => {
    const previous = projectValues(undefined, {
      ...values({ a: { b: [1, { c: 2 }] }, count: 3 }),
      namespace: [],
    });
    expect(
      projectValues(previous, values({ count: 3, a: { b: [1, { c: 2 }] } }))
    ).toBe(previous);
    expect(
      projectHistoryValues(
        previous,
        history({ count: 3, messages: [], a: { b: [1, { c: 2 }] } })
      )
    ).toBe(previous);
  });

  it('shares unchanged nested branches within changed records and arrays', () => {
    const previous = projectValues(
      undefined,
      values({
        stable: { x: 1 },
        changed: { child: { same: true }, value: 1 },
        items: [{ same: 1 }, { change: 1 }],
      })
    );
    const next = projectValues(
      previous,
      values({
        stable: { x: 1 },
        changed: { child: { same: true }, value: 2 },
        items: [{ same: 1 }, { change: 2 }],
      })
    );
    expect(next).not.toBe(previous);
    expect(next?.['stable']).toBe(previous?.['stable']);
    const oldChanged = previous?.['changed'] as Record<string, unknown>;
    const newChanged = next?.['changed'] as Record<string, unknown>;
    expect(newChanged).not.toBe(oldChanged);
    expect(newChanged['child']).toBe(oldChanged['child']);
    expect((next?.['items'] as unknown[])[0]).toBe(
      (previous?.['items'] as unknown[])[0]
    );
    expect((next?.['items'] as unknown[])[1]).not.toBe(
      (previous?.['items'] as unknown[])[1]
    );
  });

  it('owns nested plain data without freezing or retaining the caller objects', () => {
    const source = { nested: { entries: [{ count: 1 }] } };
    const next = projectValues(undefined, values(source));
    expect(next).not.toBe(source);
    expect(next?.['nested']).not.toBe(source.nested);
    expect(Object.isFrozen(source.nested)).toBe(false);
    source.nested.entries[0].count = 2;
    source.nested.entries.push({ count: 3 });
    expect(next).toEqual({ nested: { entries: [{ count: 1 }] } });
    const nested = next?.['nested'] as { entries: { count: number }[] };
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.entries)).toBe(true);
    expect(Object.isFrozen(nested.entries[0])).toBe(true);
  });

  it('does not trust shallow-frozen external roots or previous values', () => {
    const nested = { count: 1 };
    const source = Object.freeze({ nested });
    const next = projectValues(source, values(source));
    expect(next).not.toBe(source);
    expect(next?.['nested']).not.toBe(nested);
    nested.count = 9;
    expect(next).toEqual({ nested: { count: 1 } });
  });

  it('preserves null-prototype records and own prototype-named data safely', () => {
    const source = Object.assign(Object.create(null), { constructor: 'data' });
    source.__proto__ = { safe: true };
    const next = projectValues(undefined, values(source));
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
    expect(Object.hasOwn(next ?? {}, '__proto__')).toBe(true);
    expect(next?.['__proto__']).toEqual({ safe: true });
    expect(next?.['constructor']).toBe('data');
  });

  it('does not traverse excluded reserved contents or live interrupt getters', () => {
    const source = {
      keep: true,
      get messages() {
        throw new Error('reserved');
      },
      get __interrupt__() {
        throw new Error('reserved');
      },
    };
    expect(projectValues(undefined, values(source))).toBeUndefined();
    expect(projectValues(undefined, checkpoint({ values: source }))).toEqual({
      keep: true,
    });
    expect(projectHistoryValues(undefined, history(source))).toEqual({
      keep: true,
    });
  });

  it('rejects cyclic application values through the existing ownership boundary', () => {
    const source: Record<string, unknown> = {};
    source['self'] = source;
    expect(() => projectValues(undefined, values(source))).toThrow(TypeError);
    expect(() =>
      projectHistoryValues(undefined, history({ nested: source }))
    ).toThrow(TypeError);
    expect(source['self']).toBe(source);
    expect(Object.isFrozen(source)).toBe(false);
  });

  for (const unsupported of [new Date(0), new Map(), () => undefined, 1n]) {
    it(`rejects unsupported nested application data (${typeof unsupported})`, () => {
      expect(() => projectValues(undefined, values({ unsupported }))).toThrow(
        TypeError
      );
      expect(() =>
        projectHistoryValues(undefined, history({ unsupported }))
      ).toThrow(TypeError);
    });
  }

  it('rejects unsupported object roots instead of fabricating empty state', () => {
    expect(() => projectValues(undefined, values(new Date(0)))).toThrow(
      TypeError
    );
    expect(() => projectHistoryValues(undefined, history(new Map()))).toThrow(
      TypeError
    );
  });
});
