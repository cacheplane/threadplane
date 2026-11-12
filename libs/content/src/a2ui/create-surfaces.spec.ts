import { describe, expect, it, vi } from 'vitest';
import type { A2uiMessage } from '@threadplane/a2ui';
import * as entry from './index.js';

const create = (surfaceId = 'a'): A2uiMessage => ({ version: 'v0.9', createSurface: { surfaceId, catalogId: 'catalog' } });
const root = (surfaceId = 'a'): A2uiMessage => ({ version: 'v0.9', updateComponents: { surfaceId, components: [{ id: 'root', component: 'Text', text: 'hello' }] } });
const model = (value: unknown): A2uiMessage => ({ version: 'v0.9', updateDataModel: { surfaceId: 'a', value } });

describe('createA2uiSurfaces', () => {
  it('exposes one runtime factory and retains identity across staged commands', () => {
    expect(Object.keys(entry).sort()).toEqual(['createA2uiActionMessage', 'createA2uiSurfaces', 'evaluateA2uiChecks', 'resolveA2uiValue']);
    const owner = entry.createA2uiSurfaces();
    const empty = owner.getSnapshot();
    const notify = vi.fn();
    owner.subscribe(notify);
    expect(notify).not.toHaveBeenCalled();
    owner.apply(create());
    owner.apply(model({ queued: true }));
    expect(owner.getSnapshot()).toBe(empty);
    expect(empty.surfaces).toEqual([]);
    owner.apply(root());
    expect(owner.getSnapshot()).not.toBe(empty);
    expect(owner.getSnapshot().surfaces[0].dataModel).toEqual({ queued: true });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot()).toBe(owner.getSnapshot());
  });

  it('captures caller inputs, freezes snapshots and preserves retained values', () => {
    const owner = entry.createA2uiSurfaces();
    owner.apply(create());
    owner.apply(root());
    const input = { nested: { values: ['original', undefined] } };
    owner.apply(model(input));
    const retained = owner.getSnapshot();
    input.nested.values[0] = 'changed';
    expect(Object.isFrozen(input.nested.values)).toBe(false);
    const value = retained.surfaces[0].dataModel;
    expect(value).toEqual({ nested: { values: ['original', undefined] } });
    expect(() => Object.assign(value as object, { other: true })).toThrow();
    expect(() => (retained.surfaces as unknown[]).pop()).toThrow();
    owner.apply(model({ replacement: true }));
    expect(retained.surfaces[0].dataModel).toBe(value);
    expect(owner.getSnapshot().surfaces[0].dataModel).toEqual({ replacement: true });
  });

  it('does not publish or change staging when capture fails', () => {
    const owner = entry.createA2uiSurfaces();
    const notify = vi.fn();
    owner.subscribe(notify);
    owner.apply(create());
    owner.apply(model({ accepted: true }));
    const before = owner.getSnapshot();
    expect(() => owner.apply(model({ invalid: Infinity }))).toThrow();
    expect(owner.getSnapshot()).toBe(before);
    expect(notify).not.toHaveBeenCalled();
    owner.apply(root());
    expect(owner.getSnapshot().surfaces[0].dataModel).toEqual({ accepted: true });
  });

  it('keeps duplicate callback registrations independent and unsubscribe idempotent', () => {
    const owner = entry.createA2uiSurfaces();
    const notify = vi.fn();
    const first = owner.subscribe(notify);
    const second = owner.subscribe(notify);
    owner.apply(create());
    owner.apply(root());
    expect(notify).toHaveBeenCalledTimes(2);
    first(); first();
    owner.apply(model(1));
    expect(notify).toHaveBeenCalledTimes(3);
    second();
    owner.apply(model(2));
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it('publishes before notifying and swallows observer failures', () => {
    const owner = entry.createA2uiSurfaces();
    const observed: unknown[] = [];
    owner.subscribe(() => { throw new Error('observer'); });
    owner.subscribe(() => observed.push(owner.getSnapshot()));
    owner.apply(create());
    expect(() => owner.apply(root())).not.toThrow();
    expect(observed).toEqual([owner.getSnapshot()]);
  });

  it('drains reentrant publication synchronously with coherent latest snapshots', () => {
    const owner = entry.createA2uiSurfaces();
    const seen: unknown[] = [];
    let nested = false;
    let depth = 0, maximumDepth = 0;
    owner.subscribe(() => {
      depth++; maximumDepth = Math.max(depth, maximumDepth);
      if (!nested) { nested = true; owner.apply(model({ latest: true })); }
      depth--;
    });
    owner.subscribe(() => seen.push(owner.getSnapshot().surfaces[0].dataModel));
    owner.apply(create()); owner.apply(root());
    expect(maximumDepth).toBe(1);
    expect(seen).toEqual([{ latest: true }, { latest: true }]);
  });

  it('honors unsubscribe and dispose during notification and keeps the last snapshot', () => {
    const owner = entry.createA2uiSurfaces();
    const skipped = vi.fn(), afterDispose = vi.fn();
    let unsubscribe: () => void = () => undefined;
    owner.subscribe(() => { unsubscribe(); owner.dispose(); });
    unsubscribe = owner.subscribe(skipped);
    owner.subscribe(afterDispose);
    owner.apply(create()); owner.apply(root());
    const retained = owner.getSnapshot();
    expect(retained.surfaces).toHaveLength(1);
    expect(skipped).not.toHaveBeenCalled();
    expect(afterDispose).not.toHaveBeenCalled();
    owner.dispose(); unsubscribe();
    const late = vi.fn();
    owner.subscribe(late)();
    expect(late).not.toHaveBeenCalled();
    expect(() => owner.apply(model('late'))).toThrow(/disposed/);
    expect(owner.getSnapshot()).toBe(retained);
  });

  it('isolates owners and discards staged work on disposal', () => {
    const first = entry.createA2uiSurfaces(), second = entry.createA2uiSurfaces();
    first.apply(create()); first.apply(model('staged')); first.dispose();
    second.apply(create()); second.apply(root());
    expect(first.getSnapshot().surfaces).toEqual([]);
    expect(() => first.apply(root())).toThrow(/disposed/);
    expect(second.getSnapshot().surfaces[0].dataModel).toEqual({});
    const retained = second.getSnapshot();
    second.apply({ version: 'v0.9', deleteSurface: { surfaceId: 'a' } });
    expect(second.getSnapshot().surfaces).toEqual([]);
    expect(retained.surfaces).toHaveLength(1);
  });

  it('skips a registration removed by an earlier observer without disposing', () => {
    const owner = entry.createA2uiSurfaces();
    const removed = vi.fn(), remaining = vi.fn();
    let unsubscribe: () => void = () => undefined;
    owner.subscribe(() => unsubscribe());
    unsubscribe = owner.subscribe(removed);
    owner.subscribe(remaining);
    owner.apply(create()); owner.apply(root());
    expect(removed).not.toHaveBeenCalled();
    expect(remaining).toHaveBeenCalledTimes(1);
    owner.apply(model('still active'));
    expect(remaining).toHaveBeenCalledTimes(2);
  });

  describe('setValue', () => {
    const live = () => {
      const owner = entry.createA2uiSurfaces();
      owner.apply(create());
      owner.apply(root());
      owner.apply(model({ form: { name: 'Ada', tags: ['a', 'b'] }, keep: 1 }));
      return owner;
    };
    const data = (owner: ReturnType<typeof live>) => owner.getSnapshot().surfaces[0].dataModel;

    it('replaces one value, publishes once and shares untouched branches', () => {
      const owner = live();
      const before = owner.getSnapshot();
      const notify = vi.fn();
      owner.subscribe(notify);
      expect(owner.setValue('a', '/form/name', 'Grace')).toBe(true);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(owner.getSnapshot()).not.toBe(before);
      expect(data(owner)).toEqual({ form: { name: 'Grace', tags: ['a', 'b'] }, keep: 1 });
      const tags = (value: unknown) => (value as { form: { tags: unknown } }).form.tags;
      expect(tags(data(owner))).toBe(tags(before.surfaces[0].dataModel));
      expect(Object.isFrozen(data(owner))).toBe(true);
      // The earlier snapshot is untouched.
      expect(before.surfaces[0].dataModel).toEqual({ form: { name: 'Ada', tags: ['a', 'b'] }, keep: 1 });
    });

    it('creates missing parents, writes array entries and captures the value', () => {
      const owner = live();
      expect(owner.setValue('a', '/new/deep', true)).toBe(true);
      expect(owner.setValue('a', '/form/tags/1', 'z')).toBe(true);
      const input = { list: [1] };
      expect(owner.setValue('a', '/object', input)).toBe(true);
      input.list.push(2);
      expect(data(owner)).toEqual({ form: { name: 'Ada', tags: ['a', 'z'] }, keep: 1, new: { deep: true }, object: { list: [1] } });
    });

    it('publishes nothing when a primitive is rewritten unchanged or an absent value is deleted', () => {
      const owner = live();
      const before = owner.getSnapshot();
      const notify = vi.fn();
      owner.subscribe(notify);
      expect(owner.setValue('a', '/form/name', 'Ada')).toBe(false);
      expect(owner.setValue('a', '/keep', 1)).toBe(false);
      expect(owner.setValue('a', '/absent', undefined)).toBe(false);
      expect(owner.getSnapshot()).toBe(before);
      expect(notify).not.toHaveBeenCalled();
      // A present value written as null, or deleted, is a change.
      expect(owner.setValue('a', '/keep', null)).toBe(true);
      expect(owner.setValue('a', '/keep', undefined)).toBe(true);
      expect(data(owner)).toEqual({ form: { name: 'Ada', tags: ['a', 'b'] } });
      expect(notify).toHaveBeenCalledTimes(2);
    });

    it('ignores a surface that is not live and never stages one', () => {
      const owner = live();
      const before = owner.getSnapshot();
      expect(owner.setValue('missing', '/x', 1)).toBe(false);
      const staged = entry.createA2uiSurfaces();
      staged.apply(create('b'));
      expect(staged.setValue('b', '/x', 1)).toBe(false);
      staged.apply(root('b'));
      expect(staged.getSnapshot().surfaces[0].dataModel).toEqual({});
      expect(owner.getSnapshot()).toBe(before);
    });

    it('rejects a root or relative path and an unsupported value without changing anything', () => {
      const owner = live();
      const before = owner.getSnapshot();
      for (const path of ['', '/', '//', 'form/name', undefined as unknown as string])
        expect(() => owner.setValue('a', path, 1)).toThrow(/below the data model root/);
      expect(() => owner.setValue('a', '/x', Number.NaN)).toThrow(/finite plain data/);
      expect(() => owner.setValue('a', '/x', new Date() as never)).toThrow();
      expect(owner.getSnapshot()).toBe(before);
    });

    it('is replaced by a later agent update at the same path, and replaces an earlier one', () => {
      const owner = live();
      owner.setValue('a', '/form/name', 'Grace');
      owner.apply({ version: 'v0.9', updateDataModel: { surfaceId: 'a', path: '/form/name', value: 'Agent' } });
      expect((data(owner) as { form: { name: string } }).form.name).toBe('Agent');
      owner.setValue('a', '/form/name', 'User');
      expect((data(owner) as { form: { name: string } }).form.name).toBe('User');
    });

    it('throws after disposal', () => {
      const owner = live();
      owner.dispose();
      expect(() => owner.setValue('a', '/x', 1)).toThrow(/disposed/);
    });
  });
});
