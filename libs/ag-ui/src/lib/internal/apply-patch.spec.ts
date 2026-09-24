import { describe, it, expect } from 'vitest';
import { applyPatch, parsePointer, type JsonPatchOp } from './apply-patch';

describe('parsePointer', () => {
  it('returns empty array for the root pointer', () => {
    expect(parsePointer('')).toEqual([]);
  });

  it('splits a simple path', () => {
    expect(parsePointer('/foo/bar')).toEqual(['foo', 'bar']);
  });

  it('parses array indices as string tokens', () => {
    expect(parsePointer('/items/0/name')).toEqual(['items', '0', 'name']);
  });

  it('unescapes ~1 → "/"', () => {
    expect(parsePointer('/a~1b')).toEqual(['a/b']);
  });

  it('unescapes ~0 → "~"', () => {
    expect(parsePointer('/a~0b')).toEqual(['a~b']);
  });

  it('throws on a non-rooted pointer', () => {
    expect(() => parsePointer('foo')).toThrowError(/Invalid JSON Pointer/);
  });
});

describe('applyPatch — add', () => {
  it('adds a property at a top-level path', () => {
    const out = applyPatch({ a: 1 }, [{ op: 'add', path: '/b', value: 2 }]);
    expect(out).toEqual({ a: 1, b: 2 });
  });

  it('adds an element to an array (insert at index)', () => {
    const out = applyPatch({ xs: [1, 3] }, [{ op: 'add', path: '/xs/1', value: 2 }]);
    expect(out).toEqual({ xs: [1, 2, 3] });
  });

  it('appends to an array via "-"', () => {
    const out = applyPatch({ xs: [1, 2] }, [{ op: 'add', path: '/xs/-', value: 3 }]);
    expect(out).toEqual({ xs: [1, 2, 3] });
  });

  it('replaces the root when path is ""', () => {
    const out = applyPatch({ a: 1 }, [{ op: 'add', path: '', value: { b: 2 } }]);
    expect(out).toEqual({ b: 2 });
  });

  it('does not mutate the input', () => {
    const input = { a: 1 };
    const out = applyPatch(input, [{ op: 'add', path: '/b', value: 2 }]);
    expect(input).toEqual({ a: 1 });
    expect(out).not.toBe(input);
  });
});

describe('applyPatch — replace', () => {
  it('replaces an existing property', () => {
    const out = applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: 9 }]);
    expect(out).toEqual({ a: 9 });
  });

  it('replaces a nested property', () => {
    const out = applyPatch(
      { user: { name: 'old' } },
      [{ op: 'replace', path: '/user/name', value: 'new' }],
    );
    expect(out).toEqual({ user: { name: 'new' } });
  });

  it('replaces an array element by index', () => {
    const out = applyPatch({ xs: [1, 2, 3] }, [{ op: 'replace', path: '/xs/1', value: 99 }]);
    expect(out).toEqual({ xs: [1, 99, 3] });
  });
});

describe('applyPatch — remove', () => {
  it('removes a top-level property', () => {
    const out = applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/b' }]);
    expect(out).toEqual({ a: 1 });
  });

  it('removes an array element by index (shifts remaining)', () => {
    const out = applyPatch({ xs: [1, 2, 3] }, [{ op: 'remove', path: '/xs/1' }]);
    expect(out).toEqual({ xs: [1, 3] });
  });

  it('throws on missing key', () => {
    expect(() =>
      applyPatch({ a: 1 }, [{ op: 'remove', path: '/missing' }]),
    ).toThrowError(/non-existent key/);
  });
});

describe('applyPatch — composition', () => {
  it('applies multiple ops in order', () => {
    const ops: JsonPatchOp[] = [
      { op: 'add', path: '/b', value: 2 },
      { op: 'replace', path: '/a', value: 99 },
      { op: 'remove', path: '/b' },
    ];
    const out = applyPatch({ a: 1 }, ops);
    expect(out).toEqual({ a: 99 });
  });

  it('mid-batch failure throws (no partial commit semantics required by reducer)', () => {
    expect(() =>
      applyPatch({ a: 1 }, [
        { op: 'replace', path: '/a', value: 2 },
        { op: 'remove', path: '/missing' },
      ]),
    ).toThrowError();
  });
});

describe('applyPatch — escape sequences in pointer', () => {
  it('handles "/" in keys via ~1', () => {
    const out = applyPatch({ 'a/b': 1 }, [{ op: 'replace', path: '/a~1b', value: 2 }]);
    expect(out).toEqual({ 'a/b': 2 });
  });

  it('handles "~" in keys via ~0', () => {
    const out = applyPatch({ 'a~b': 1 }, [{ op: 'replace', path: '/a~0b', value: 2 }]);
    expect(out).toEqual({ 'a~b': 2 });
  });
});

describe('applyPatch — move/copy/test', () => {
  it('move: relocates a value from one path to another', () => {
    const out = applyPatch(
      { a: 1, b: 2 },
      [{ op: 'move', path: '/c', from: '/b' }],
    );
    expect(out).toEqual({ a: 1, c: 2 });
  });

  it('copy: duplicates a value at a new path', () => {
    const out = applyPatch(
      { a: { x: 1 } },
      [{ op: 'copy', path: '/b', from: '/a' }],
    );
    expect(out).toEqual({ a: { x: 1 }, b: { x: 1 } });
    // Confirm deep clone (no shared reference)
    (out as { a: { x: number }; b: { x: number } }).b.x = 99;
    expect((out as { a: { x: number } }).a.x).toBe(1);
  });

  it('test: passes when the value matches', () => {
    const out = applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 1 }]);
    expect(out).toEqual({ a: 1 });
  });

  it('test: throws when the value does not match', () => {
    expect(() =>
      applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 2 }]),
    ).toThrowError(/'test' op failed/);
  });
});

describe('applyPatch — existing own paths', () => {
  it.each([
    { op: 'replace', path: '/missing', value: 2 },
    { op: 'copy', from: '/missing', path: '/copy' },
    { op: 'move', from: '/missing', path: '/moved' },
    { op: 'test', path: '/missing', value: undefined },
    { op: 'copy', from: '/toString', path: '/copy' },
    { op: 'remove', path: '/constructor' },
  ] satisfies JsonPatchOp[])('rejects absent or inherited members: $op $path', (op) => {
    expect(() => applyPatch({ a: 1 }, [op])).toThrow();
  });

  it.each(['constructor', 'toString', '__proto__'])('never traverses inherited %s', (key) => {
    const input = { nested: {} };
    for (const op of [
      { op: 'add', path: `/nested/${key}/field`, value: 1 },
      { op: 'replace', path: `/nested/${key}`, value: 1 },
      { op: 'remove', path: `/nested/${key}` },
      { op: 'copy', from: `/nested/${key}`, path: '/copy' },
    ] satisfies JsonPatchOp[]) {
      expect(() => applyPatch(input, [op])).toThrow();
    }
  });

  it('distinguishes an own undefined value from an absent member', () => {
    const input = Object.freeze({ present: undefined });
    expect(applyPatch(input, [{ op: 'test', path: '/present', value: undefined }])).toBe(input);
    expect(applyPatch(input, [{ op: 'replace', path: '/present', value: 1 }])).toEqual({ present: 1 });
    expect(applyPatch(input, [{ op: 'remove', path: '/present' }])).toEqual({});
    const copied = applyPatch(input, [{ op: 'copy', from: '/present', path: '/copy' }]);
    expect(Object.hasOwn(copied, 'copy')).toBe(true);
    expect(copied).toEqual({ present: undefined, copy: undefined });
    expect(applyPatch(input, [{ op: 'move', from: '/present', path: '/moved' }])).toEqual({ moved: undefined });
  });

  it.each(['missing', 'scalar', 'nil', 'present'])('rejects non-container or missing intermediate %s', (key) => {
    const input = { scalar: 1, nil: null, present: undefined };
    expect(() => applyPatch(input, [{ op: 'add', path: `/${key}/child`, value: 1 }])).toThrow();
  });
});

describe('applyPatch — array path bounds', () => {
  it.each(['1', '2', '0'])('rejects missing array source or target index %s', (index) => {
    // Index 0 is a hole; 1 is the end; 2 exceeds the end.
    const input = { items: Object.freeze(new Array(1)) };
    for (const op of [
      { op: 'copy', from: `/items/${index}`, path: '/copy' },
      { op: 'move', from: `/items/${index}`, path: '/moved' },
      { op: 'test', path: `/items/${index}`, value: undefined },
      { op: 'replace', path: `/items/${index}`, value: 2 },
      { op: 'remove', path: `/items/${index}` },
      { op: 'add', path: `/items/${index}/child`, value: 2 },
    ] satisfies JsonPatchOp[]) {
      expect(() => applyPatch(input, [op])).toThrow();
    }
    expect(Object.hasOwn(input.items, 0)).toBe(false);
  });

  it.each(['-', '-1', '01', '1.0', '1e0'])('rejects non-element index %s for reads', (index) => {
    expect(() => applyPatch([1, 2], [{ op: 'copy', from: `/${index}`, path: '/0' }])).toThrow();
  });

  it('accepts own undefined array elements', () => {
    expect(applyPatch([undefined], [{ op: 'test', path: '/0', value: undefined }])).toEqual([undefined]);
    expect(applyPatch([undefined], [{ op: 'replace', path: '/0', value: 2 }])).toEqual([2]);
    expect(applyPatch([undefined], [{ op: 'remove', path: '/0' }])).toEqual([]);
  });

  it.each(['2', '-'])('inserts at the array end using %s', (index) => {
    expect(applyPatch([1, 2], [{ op: 'add', path: `/${index}`, value: 3 }])).toEqual([1, 2, 3]);
  });

  it('rejects add beyond the array end', () => {
    expect(() => applyPatch([1, 2], [{ op: 'add', path: '/3', value: 3 }])).toThrow();
  });

  it('preserves array move shifts and nested traversal', () => {
    expect(applyPatch(['a', 'b', 'c'], [{ op: 'move', from: '/0', path: '/2' }])).toEqual(['b', 'c', 'a']);
    const input = [{ value: 1 }];
    expect(applyPatch(input, [{ op: 'replace', path: '/0/value', value: 2 }])).toEqual([{ value: 2 }]);
    expect(applyPatch(input, [{ op: 'copy', from: '/0', path: '/1' }])).toEqual([{ value: 1 }, { value: 1 }]);
  });
});

describe('applyPatch — safe own data keys', () => {
  it.each(['__proto__', 'constructor', 'prototype'])('adds and operates on own %s data safely', (key) => {
    const globalDescriptors = Object.getOwnPropertyDescriptors(Object.prototype);
    const input = Object.freeze({});
    const added = applyPatch<Record<string, unknown>>(input, [{ op: 'add', path: `/${key}`, value: { value: 1 } }]);
    expect(Object.hasOwn(added, key)).toBe(true);
    expect(Object.getPrototypeOf(added)).toBe(Object.prototype);
    expect(added[key]).toEqual({ value: 1 });
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(Object.hasOwn(input, key)).toBe(false);
    const updated = applyPatch(added, [
      { op: 'test', path: `/${key}/value`, value: 1 },
      { op: 'replace', path: `/${key}/value`, value: 2 },
      { op: 'copy', from: `/${key}`, path: '/copied' },
      { op: 'remove', path: `/${key}/value` },
    ]);
    expect(updated[key]).toEqual({});
    expect(updated['copied']).toEqual({ value: 2 });
    expect(Object.getPrototypeOf(updated)).toBe(Object.prototype);
    expect(applyPatch(updated, [{ op: 'replace', path: `/${key}`, value: 3 }])[key]).toBe(3);
    expect(Object.hasOwn(applyPatch(updated, [{ op: 'remove', path: `/${key}` }]), key)).toBe(false);
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(globalDescriptors);
  });

  it('accepts explicit own special keys from null-prototype input', () => {
    const input = Object.freeze(Object.assign(Object.create(null), JSON.parse('{"__proto__":{"value":1}}')));
    const out = applyPatch(input, [{ op: 'replace', path: '/__proto__/value', value: 2 }]);
    expect(Object.getPrototypeOf(input)).toBe(null);
    expect(Object.hasOwn(out, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(null);
    expect(out['__proto__']).toEqual({ value: 2 });
    expect(input['__proto__']).toEqual({ value: 1 });
  });
});

describe('applyPatch — portable data fidelity', () => {
  function payload() {
    const items = new Array(3);
    items[1] = undefined;
    items[2] = { value: 1 };
    Object.defineProperty(items, 'extra', { value: { value: 2 }, enumerable: true });
    const value = Object.assign(Object.create(null), { optional: undefined, items });
    return Object.freeze(value);
  }

  it.each(['add', 'replace', 'copy'] as const)('captures complete %s payloads without trusting frozen parents', (op) => {
    const value = payload();
    const input = { source: value, result: null };
    const output = applyPatch(input, [op === 'copy'
      ? { op, from: '/source', path: '/result' }
      : { op, path: '/result', value }]);
    const result = output.result as unknown as typeof value;
    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(Object.keys(result)).toEqual(['optional', 'items']);
    expect(Object.keys(result.items)).toEqual(['1', '2', 'extra']);
    expect(result.items.length).toBe(3);
    expect(result.items[1]).toBeUndefined();
    expect(result.items).not.toBe(value.items);
    expect(result.items.extra).not.toBe(value.items.extra);
    expect(Object.isFrozen(value.items)).toBe(false);
    value.items[2].value = 9;
    expect(result.items[2].value).toBe(1);
  });

  for (const constructor of [null, 1]) {
    for (const op of [
      { op: 'add', path: '/items/0', value: { value: 9 } },
      { op: 'remove', path: '/items/1' },
      { op: 'replace', path: '/items/1/value', value: 9 },
      { op: 'add', path: '/items/1/added', value: 9 },
      { op: 'remove', path: '/items/1/value' },
      { op: 'move', from: '/items/1', path: '/items/0' },
      { op: 'copy', from: '/items/1', path: '/items/0' },
    ] satisfies JsonPatchOp[]) {
      it(`preserves frozen sparse ancestors and extensions for ${op.op} ${op.path}, constructor=${constructor}`, () => {
        const items = new Array(3);
        items[1] = Object.freeze({ value: 1 });
        items[2] = undefined;
        const extra = { unchanged: true };
        for (const [key, value] of Object.entries({ extra, constructor, splice: 'payload', __proto__: null })) {
          Object.defineProperty(items, key, { value, enumerable: true });
        }
        Object.defineProperty(items, '__proto__', { value: extra, enumerable: true });
        Object.freeze(items);
        const input = Object.freeze(Object.assign(Object.create(null), { items, untouched: extra }));
        const descriptors = Object.getOwnPropertyDescriptors(items);
        const output = applyPatch(input, [op]);
        expect(Object.getPrototypeOf(output)).toBe(null);
        expect(Object.getPrototypeOf(output.items)).toBe(Array.prototype);
        for (const key of ['extra', 'constructor', 'splice', '__proto__']) {
          expect(Object.hasOwn(output.items, key)).toBe(true);
          expect(output.items[key]).toBe(items[key]);
        }
        expect(output.untouched).toBe(extra);
        expect(Object.getOwnPropertyDescriptors(items)).toEqual(descriptors);
        const inserted = op.op === 'add' && op.path === '/items/0' || op.op === 'copy';
        const removed = op.op === 'remove' && op.path === '/items/1';
        expect(output.items.length).toBe(inserted ? 4 : removed ? 2 : 3);
        const hole = inserted || op.op === 'move' ? 1 : 0;
        expect(Object.hasOwn(output.items, hole)).toBe(false);
        expect(Object.hasOwn(output.items, output.items.length - 1)).toBe(true);
        expect(output.items[output.items.length - 1]).toBeUndefined();
      });
    }
  }

  it('tests array own keys, holes, extensions and length as data', () => {
    const hole = new Array(1);
    expect(() => applyPatch(hole, [{ op: 'test', path: '', value: [undefined] }])).toThrow(/test/);
    const extended = Object.assign([undefined], { extra: undefined });
    expect(() => applyPatch(extended, [{ op: 'test', path: '', value: [undefined] }])).toThrow(/test/);
    expect(() => applyPatch(extended, [{ op: 'test', path: '', value: Object.assign([undefined], { other: undefined }) }])).toThrow(/test/);
    expect(() => applyPatch(extended, [{ op: 'test', path: '', value: Object.assign([undefined], { extra: 1 }) }])).toThrow(/test/);
    expect(applyPatch(extended, [{ op: 'test', path: '', value: Object.assign([undefined], { extra: undefined }) }])).toBe(extended);
    expect(() => applyPatch(hole, [{ op: 'test', path: '', value: new Array(2) }])).toThrow(/test/);
    expect(applyPatch(0, [{ op: 'test', path: '', value: -0 }])).toBe(0);
    expect(applyPatch(Object.create(null), [{ op: 'test', path: '', value: {} }])).toEqual({});
  });

  it.each([new Date(), () => undefined, Symbol('payload'), { nested: () => undefined }])('rejects nonportable inserted payload %s atomically', (value) => {
    const input = { value: { original: true } };
    expect(() => applyPatch(input, [{ op: 'replace', path: '/value', value }])).toThrow(TypeError);
    expect(input).toEqual({ value: { original: true } });
  });
});

describe('applyPatch — ownership and atomic failure', () => {
  it.each([
    { op: 'replace', path: '/missing', value: 2 },
    { op: 'copy', from: '/missing', path: '/copy' },
    { op: 'move', from: '/missing', path: '/moved' },
  ] satisfies JsonPatchOp[])('leaves frozen input and inserted payload unchanged after failing $op', (invalid) => {
    const items = Object.freeze([1, 2]);
    const branch = Object.freeze({ value: 1 });
    const input = Object.freeze({ items, branch });
    const payload = Object.freeze({ nested: Object.freeze({ value: 1 }) });
    expect(() => applyPatch(input, [
      { op: 'replace', path: '/items/0', value: 9 },
      { op: 'add', path: '/added', value: payload },
      { op: 'replace', path: '/added/nested/value', value: 9 },
      invalid,
    ])).toThrow();
    expect(input).toEqual({ items: [1, 2], branch: { value: 1 } });
    expect(input.items).toBe(items);
    expect(input.branch).toBe(branch);
    expect(payload.nested.value).toBe(1);
  });

  it('shares untouched branches and detaches inserted mutable values', () => {
    const input = Object.freeze({ changed: Object.freeze({ value: 1 }), untouched: Object.freeze({ value: 2 }) });
    const payload = { nested: { value: 3 } };
    const out = applyPatch<Record<string, unknown>>(input, [
      { op: 'replace', path: '/changed/value', value: 4 },
      { op: 'add', path: '/added', value: payload },
    ]);
    expect(out['untouched']).toBe(input.untouched);
    expect(out['changed']).not.toBe(input.changed);
    expect(out['added']).not.toBe(payload);
    payload.nested.value = 5;
    expect(out['added']).toEqual({ nested: { value: 3 } });
  });

  it('preserves root replacement and rejects root removal', () => {
    const value = { nested: { value: 2 } };
    const out = applyPatch({ old: 1 }, [{ op: 'replace', path: '', value }]);
    expect(out).toEqual(value);
    expect(out).not.toBe(value);
    expect(() => applyPatch(out, [{ op: 'remove', path: '' }])).toThrow('Cannot remove root');
  });
});
