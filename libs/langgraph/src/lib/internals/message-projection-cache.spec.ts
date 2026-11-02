import { describe, it, expect, vi } from 'vitest';
import type { Message, MessageDelivery } from '@threadplane/chat';
import { createMemoizedMessageProjector } from './message-projection-cache';

type Raw = Record<PropertyKey, unknown>;
const simple = (id = 'a'): Raw => ({ id, type: 'ai', content: 'hello' });
function harness() {
  let delivery: MessageDelivery = { generation: 'a', phase: 'complete', outcome: 'success' };
  let duration: number | undefined;
  const getDelivery = vi.fn(() => delivery);
  const getReasoningDurationMs = vi.fn(() => duration);
  const project = vi.fn((raw: Raw): Message => ({
    id: String(raw['id']), role: 'assistant', content: String(raw['content']),
    delivery: getDelivery(), reasoningDurationMs: raw['reasoning'] ? getReasoningDurationMs() : undefined,
    extra: raw,
  }));
  const projectAll = createMemoizedMessageProjector({ project, getDelivery, getReasoningDurationMs });
  return { projectAll, project, getDelivery, getReasoningDurationMs,
    setDelivery: (value: MessageDelivery) => { delivery = value; },
    setDuration: (value: number | undefined) => { duration = value; } };
}

describe('memoized neutral message projector', () => {
  it('reuses unchanged simple rows and preserves original extra identity', () => {
    const h = harness(), row = simple();
    const first = h.projectAll([row])[0], second = h.projectAll([row])[0];
    expect(second).toBe(first); expect(second.extra).toBe(row); expect(h.project).toHaveBeenCalledTimes(1);
  });
  it('never reuses a replaced raw object with identical ID and text', () => {
    const h = harness(), first = h.projectAll([simple()])[0], next = simple();
    expect(h.projectAll([next])[0]).not.toBe(first); expect(h.project).toHaveBeenCalledTimes(2);
  });
  it('compares every primitive key including added/deleted fields, symbols and descriptor flags', () => {
    const mutations: Array<(row: Raw) => void> = [
      r => { r['content'] = 'hello world'; }, r => { r['type'] = 'human'; },
      r => { r['id'] = 'new-id'; }, r => { r['custom'] = 'new'; },
      r => { delete r['custom']; }, r => { r['custom'] = -0; },
      r => { r[Symbol.for('extra')] = 2; }, r => { delete r[Symbol.for('extra')]; },
      r => { Object.defineProperty(r, 'custom', { enumerable: false }); },
    ];
    for (const mutate of mutations) {
      const h = harness(), row = { ...simple(), custom: 0, [Symbol.for('extra')]: 1 };
      const first = h.projectAll([row])[0]; mutate(row);
      expect(h.projectAll([row])[0]).not.toBe(first); expect(h.project).toHaveBeenCalledTimes(2);
    }
  });
  it('uses Object.is for primitive snapshots and accepts null-prototype records', () => {
    const h = harness(), row = Object.assign(Object.create(null) as Raw, simple(), { custom: NaN });
    const first = h.projectAll([row])[0]; expect(h.projectAll([row])[0]).toBe(first);
    row['custom'] = 0; expect(h.projectAll([row])[0]).not.toBe(first);
  });
  it('rejects accessors without invoking their getters and always delegates opaque projection', () => {
    let reads = 0; const row = simple(); Object.defineProperty(row, 'privateMetadata', { get() { reads++; return {}; } });
    const h = harness(), first = h.projectAll([row])[0]; expect(h.projectAll([row])[0]).not.toBe(first);
    expect(reads).toBe(0); expect(h.project).toHaveBeenCalledTimes(2);
  });
  it('falls back for all nested/functions/classes/arrays and missing stable identity or own string type/content', () => {
    class SDKMessage { id = 'a'; type = 'ai'; content = 'hello'; }
    const records: object[] = [
      { ...simple(), additional_kwargs: {} }, { ...simple(), tool_calls: [] },
      { ...simple(), custom: {} }, { ...simple(), content: [{ type: 'text', text: 'hello' }] },
      { ...simple(), method: () => 'hello' }, { ...simple(), _getType: undefined },
      new SDKMessage(), Object.assign([], simple()), { type: 'ai', content: 'hello' },
      { ...simple(), id: '' }, { id: 'a', content: 'hello' },
    ];
    for (const raw of records) { const h = harness(), row = raw as Raw;
      const first = h.projectAll([row])[0]; expect(h.projectAll([row])[0]).not.toBe(first); }
  });
  it('declines inherited normalized fields and methods even on Object.prototype', () => {
    for (const key of ['_getType', 'name', 'tool_call_id', 'reasoning', 'additional_kwargs', 'tool_calls']) {
      const saved = Object.getOwnPropertyDescriptor(Object.prototype, key);
      try {
        Object.defineProperty(Object.prototype, key, { value: 'inherited', configurable: true });
        const h = harness(), row = simple(), first = h.projectAll([row])[0];
        expect(h.projectAll([row])[0]).not.toBe(first);
      } finally { if (saved) Object.defineProperty(Object.prototype, key, saved); else Reflect.deleteProperty(Object.prototype, key); }
    }
  });
  it('invalidates semantic delivery changes without requiring raw text changes', () => {
    const h = harness(), row = simple(), first = h.projectAll([row])[0];
    h.setDelivery({ generation: 'a', phase: 'complete', outcome: 'success' });
    expect(h.projectAll([row])[0]).toBe(first);
    for (const delivery of [
      { generation: 'a', phase: 'streaming' }, { generation: 'a', phase: 'complete', outcome: 'error' },
      { generation: 'a', phase: 'complete', outcome: 'interrupted' },
      { generation: 'new', phase: 'complete', outcome: 'success' },
    ] as MessageDelivery[]) { const before = h.projectAll([row])[0]; h.setDelivery(delivery); expect(h.projectAll([row])[0]).not.toBe(before); }
  });
  it('invalidates reasoning-duration changes and never queries timing for nonreasoning rows', () => {
    const h = harness(), row = { ...simple(), reasoning: 'thought' };
    const first = h.projectAll([row])[0]; h.setDuration(250);
    const next = h.projectAll([row])[0]; expect(next).not.toBe(first); expect(next.reasoningDurationMs).toBe(250);
    h.getReasoningDurationMs.mockClear(); h.projectAll([simple()]); h.projectAll([simple()]);
    expect(h.getReasoningDurationMs).not.toHaveBeenCalled();
  });
  it('prunes removals and thread changes, preserves actual order, and keeps distinct same-ID raw rows separate', () => {
    const h = harness(), a = simple(), b = simple(), first = h.projectAll([a, b]);
    expect(first[0]).not.toBe(first[1]); expect(h.projectAll([b, a])).toEqual([first[1], first[0]]);
    h.projectAll([b]); expect(h.projectAll([a, b])[0]).not.toBe(first[0]);
    const before = h.projectAll([a])[0]; h.projectAll([]); expect(h.projectAll([a])[0]).not.toBe(before);
  });
  it('reprojects when consumers mutate returned message content, role, shape or delivery', () => {
    for (const mutate of [
      (m: Message) => { m.content = 'consumer edit'; },
      (m: Message) => { m.role = 'user'; },
      (m: Message) => { (m as unknown as Raw)['custom'] = 'consumer edit'; },
      (m: Message) => { (m.delivery as unknown as Raw)['phase'] = 'streaming'; },
      (m: Message) => { (m.delivery as unknown as Raw)['custom'] = 'consumer edit'; },
    ]) { const h = harness(), row = simple(), first = h.projectAll([row])[0]; mutate(first);
      expect(h.projectAll([row])[0]).not.toBe(first); expect(h.project).toHaveBeenCalledTimes(2); }
  });
  it('declines caching unexpected complex projection fields outside raw extra and delivery', () => {
    const project = vi.fn((raw: Raw): Message => ({ id: 'a', role: 'assistant', content: 'x', extra: raw, delivery: { generation: 'a', phase: 'complete', outcome: 'success' }, citations: [{ id: 'x', index: 1, title: 'citation' }] }));
    const all = createMemoizedMessageProjector({ project, getDelivery: () => ({ generation: 'a', phase: 'complete', outcome: 'success' }) });
    const row = simple(), first = all([row])[0]; expect(all([row])[0]).not.toBe(first); expect(project).toHaveBeenCalledTimes(2);
  });
  it('never aliases duplicate occurrences of the exact same raw object', () => {
    const h = harness(), row = simple();
    const unique = h.projectAll([row])[0];
    for (let i = 0; i < 2; i++) { const pair = h.projectAll([row, row]);
      expect(pair[0]).not.toBe(pair[1]); expect(pair[0]).not.toBe(unique); }
    expect(h.projectAll([row])[0]).not.toBe(unique);
  });
  it('does not swallow original projection errors', () => {
    const failure = Error('actual projection failure');
    const projectAll = createMemoizedMessageProjector({ project: () => { throw failure; }, getDelivery: () => ({ generation: 'a', phase: 'complete', outcome: 'success' }) });
    expect(() => projectAll([simple()])).toThrow(failure);
  });
  it('keeps heavy complex rows conservative and invalidates a former fast-path row when nested metadata appears', () => {
    const h = harness(), rows = Array.from({ length: 1000 }, (_, i) => ({ ...simple(String(i)), custom: { revision: 0 } }));
    const first = h.projectAll(rows); for (const row of rows) row.custom.revision++;
    const second = h.projectAll(rows); expect(second.every((m, i) => m !== first[i])).toBe(true);
    expect(h.project).toHaveBeenCalledTimes(2000);
    const row = simple(), cached = h.projectAll([row])[0]; row['custom'] = { revision: 1 };
    const opaque = h.projectAll([row])[0]; expect(opaque).not.toBe(cached);
    (row['custom'] as { revision: number }).revision++; expect(h.projectAll([row])[0]).not.toBe(opaque);
  });
});
