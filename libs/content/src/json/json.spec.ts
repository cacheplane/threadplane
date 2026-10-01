import { describe, expect, it, vi } from 'vitest';
import { createJson, type JsonDocument, type JsonSnapshot } from './index.js';

const doc = (
  content: string,
  phase: JsonDocument['phase'] = 'streaming',
  generation = 'a'
): JsonDocument => ({ content, phase, generation });
function object(snapshot: JsonSnapshot) {
  if (snapshot.root?.kind !== 'object') throw new Error('expected object');
  return snapshot.root;
}

describe('owned JSON documents', () => {
  it('exports an owned JSON factory', () => {
    expect(createJson).toBeTypeOf('function');
  });
  it('captures input synchronously and preserves snapshots on inert commands', () => {
    const input = doc('{"a":1}');
    const owner = createJson(input);
    const first = owner.getSnapshot();
    const notify = vi.fn();
    const release = owner.subscribe(notify);
    for (let i = 0; i < 5; i++) {
      owner.update(doc('{"a":1}'));
      expect(owner.getSnapshot()).toBe(first);
    }
    release();
    release();
    expect(notify).not.toHaveBeenCalled();
    expect(first.complete).toBe(true);
    expect(first.document.phase).toBe('streaming');
    expect(first.error).toBeNull();
    expect(first.root?.value).toEqual({ a: 1 });
    expect(first.document).not.toBe(input);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.document)).toBe(true);
  });
  it.each([
    { text: 't', value: undefined },
    { text: 'f', value: undefined },
    { text: 'n', value: undefined },
    { text: '-', value: undefined },
    { text: '12', value: undefined },
    { text: '1e+', value: undefined },
    { text: '"hel', value: 'hel' },
  ])('does not guess final values for $text', ({ text, value }) => {
    const owner = createJson(doc(text));
    expect(owner.getSnapshot().root?.value).toBe(value);
    expect(owner.getSnapshot().complete).toBe(false);
    expect(owner.getSnapshot().error).toBeNull();
  });
  it.each(['', '-', '1.', '1e+', 'tr', '"text', '{"a":1', '[1'])(
    'publishes incomplete-final-input diagnostics for %j',
    (text) => {
      const owner = createJson(doc(text, 'complete'));
      expect(owner.getSnapshot().error?.code).toBe('UNEXPECTED_END');
      expect(owner.getSnapshot().complete).toBe(false);
      expect(Object.isFrozen(owner.getSnapshot().error)).toBe(true);
    }
  );
  it('finishes numbers without treating source phase as syntax validity', () => {
    const owner = createJson(doc('12'));
    const before = owner.getSnapshot();
    owner.update(doc('12', 'complete'));
    expect(owner.getSnapshot().root?.value).toBe(12);
    expect(owner.getSnapshot().complete).toBe(true);
    expect(before.root?.value).toBeUndefined();
  });
  it('publishes terminal syntax errors and recovers with a new generation', () => {
    const owner = createJson(doc('{"a":1,}'));
    const first = owner.getSnapshot();
    expect(first.error?.code).toBe('INVALID_SYNTAX');
    expect(first.root?.value).toEqual({ a: 1 });
    expect(first.complete).toBe(false);
    owner.update(doc('{"a":1,}ignored', 'complete'));
    expect(owner.getSnapshot().error).toBe(first.error);
    owner.update(doc('{"b":2}', 'complete', 'b'));
    expect(owner.getSnapshot().error).toBeNull();
    expect(owner.getSnapshot().complete).toBe(true);
    expect(owner.getSnapshot().root?.value).toEqual({ b: 2 });
    const trailing = createJson(doc('true x', 'complete')).getSnapshot();
    expect(trailing.root?.status).toBe('complete');
    expect(trailing.error?.code).toBe('TRAILING_CONTENT');
    expect(trailing.complete).toBe(false);
  });
  it.each([
    '{"":1,"":2,"nested":{"":"value"}}',
    '{"__proto__":{"value":1},"constructor":false,"toString":null}',
    '{"__proto__":null,"__proto__":[{"":1}]}',
    '{"\\u005f\\u005fproto__":"value","a/b":{"~":true}}',
  ])('owns safe immutable keys across every split of %s', (text) => {
    for (let split = 0; split <= text.length; split++) {
      const owner = createJson(doc(text.slice(0, split)));
      const before = owner.getSnapshot();
      owner.update(doc(text, 'complete'));
      const root = object(owner.getSnapshot());
      expect(root.value).toEqual(JSON.parse(text));
      expect(owner.getSnapshot().error).toBeNull();
      expect(Object.getPrototypeOf(root.value)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(root.children)).toBe(Object.prototype);
      expect(Object.keys(root.value)).toEqual(Object.keys(JSON.parse(text)));
      for (const key of Object.keys(root.value)) {
        expect(Object.hasOwn(root.children, key)).toBe(true);
        expect(Object.getOwnPropertyDescriptor(root.value, key)).toMatchObject({
          enumerable: true,
          writable: false,
          configurable: false,
        });
      }
      expect(before.document.content).toBe(text.slice(0, split));
      expect(Object.isFrozen(root)).toBe(true);
      expect(Object.isFrozen(root.children)).toBe(true);
      expect(Object.isFrozen(root.value)).toBe(true);
      expect(Reflect.set(root.value, 'injected', true)).toBe(false);
      expect(Reflect.set(root.children, 'injected', root)).toBe(false);
    }
  });
  it('updates child status while sharing unchanged plain values and siblings', () => {
    const owner = createJson(doc('{"stable":[1],"child":{"value":1 '));
    const before = object(owner.getSnapshot());
    owner.update(doc('{"stable":[1],"child":{"value":1 }'));
    const after = object(owner.getSnapshot());
    expect(after).not.toBe(before);
    expect(after.children.child.status).toBe('complete');
    expect(before.children.child.status).toBe('incomplete');
    expect(after.children.stable).toBe(before.children.stable);
    expect(after.value).toBe(before.value);
    expect(after.children.child.value).toBe(before.children.child.value);
    expect(Reflect.set(after.children.stable.value as object, '0', 9)).toBe(
      false
    );
    expect(after).not.toHaveProperty('parentId');
    expect(after).not.toHaveProperty('parent');
  });
  it('rejects contract violations atomically and rebuilds only when selected', () => {
    const owner = createJson(doc('{"a":1'));
    const before = owner.getSnapshot();
    for (const text of ['{', '{"b":1'])
      expect(() => owner.update(doc(text))).toThrow(/contract/);
    expect(owner.getSnapshot()).toBe(before);
    owner.update(doc('{"a":1}', 'complete'));
    const complete = owner.getSnapshot();
    expect(() => owner.update(doc('{"a":1}'))).toThrow(/complete-to-streaming/);
    expect(() => owner.update(doc('{"a":1} ', 'complete'))).toThrow(
      /post-completion/
    );
    expect(owner.getSnapshot()).toBe(complete);
    const rebuild = createJson(doc('{"a":1,}'), { violationPolicy: 'rebuild' });
    rebuild.update(doc('{"a":2}', 'complete'));
    expect(rebuild.getSnapshot().complete).toBe(true);
    expect(rebuild.getSnapshot().root?.value).toEqual({ a: 2 });
  });
  it('coalesces listener reentry, contains observer errors and respects registration lifetimes', () => {
    const owner = createJson(doc('"a'));
    const seen: string[] = [];
    let remove: () => void = () => undefined;
    owner.subscribe(() => {
      seen.push(owner.getSnapshot().document.content);
      remove();
      if (owner.getSnapshot().document.content === '"ab')
        owner.update(doc('"abc'));
    });
    remove = owner.subscribe(() => seen.push('removed'));
    owner.subscribe(() => {
      throw new Error('observer');
    });
    const same = vi.fn();
    const release = owner.subscribe(same);
    owner.subscribe(same);
    release();
    expect(() => owner.update(doc('"ab'))).not.toThrow();
    expect(seen).toEqual(['"ab', '"abc']);
    expect(same).toHaveBeenCalledTimes(2);
  });
  it('captures getters once against the latest snapshot and respects getter disposal', () => {
    const owner = createJson(doc('"a'));
    const reads = { generation: 0, phase: 0, content: 0 };
    owner.update({
      get generation() {
        reads.generation++;
        owner.update(doc('"ab'));
        return 'a';
      },
      get phase(): 'streaming' {
        reads.phase++;
        return 'streaming';
      },
      get content() {
        reads.content++;
        return '"abc';
      },
    });
    expect(reads).toEqual({ generation: 1, phase: 1, content: 1 });
    expect(owner.getSnapshot().root?.value).toBe('abc');
    expect(() =>
      owner.update({
        generation: 'a',
        phase: 'streaming',
        get content() {
          owner.dispose();
          return '"abcd';
        },
      })
    ).toThrow(/disposed/);
    expect(() =>
      owner.update({
        get generation(): string {
          throw new Error('must not read');
        },
        phase: 'streaming',
        content: '',
      })
    ).toThrow(/disposed/);
    expect(owner.getSnapshot().root?.value).toBe('abc');
  });
  it('disposes idempotently during notifications and keeps the accepted snapshot readable', () => {
    const owner = createJson(doc('"a'));
    const later = vi.fn();
    owner.subscribe(() => {
      owner.update(doc('"abc'));
      owner.dispose();
    });
    owner.subscribe(later);
    owner.update(doc('"ab'));
    owner.dispose();
    const retained = owner.getSnapshot();
    expect(retained.root?.value).toBe('abc');
    expect(retained.complete).toBe(false);
    expect(later).not.toHaveBeenCalled();
    owner.subscribe(later)();
    expect(() => owner.update(doc('"abcd'))).toThrow(/disposed/);
    expect(owner.getSnapshot()).toBe(retained);
  });
});
