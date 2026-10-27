import { create, push, finish } from '@cacheplane/json-stream';
import { describe, expect, it, vi } from 'vitest';
import { createJsonOwner } from './create-json.js';
import { createProjection } from './projection.js';
import type { JsonDocument } from './types.js';

const doc = (
  content: string,
  phase: JsonDocument['phase'] = 'streaming',
  generation = 'a'
): JsonDocument => ({ generation, phase, content });
function instrument() {
  const counts = { create: 0, push: 0, finish: 0, project: 0 };
  const suffixes: string[] = [];
  const fail = { create: false, push: false, finish: false, project: false };
  const work = {
    create() {
      counts.create++;
      if (fail.create) throw new Error('create failure');
      return create();
    },
    push(state: Parameters<typeof push>[0], text: string) {
      counts.push++;
      suffixes.push(text);
      const next = push(state, text);
      if (fail.push) throw new Error('push failure');
      return next;
    },
    finish(state: Parameters<typeof finish>[0]) {
      counts.finish++;
      const next = finish(state);
      if (fail.finish) throw new Error('finish failure');
      return next;
    },
    createProjection() {
      const project = createProjection();
      return (state: Parameters<typeof project>[0]) => {
        counts.project++;
        const owned = project(state);
        if (fail.project) throw new Error('project failure');
        return owned;
      };
    },
  };
  return { counts, suffixes, fail, work };
}

describe('JSON owner parser lifecycle', () => {
  it('feeds only suffixes, keeps reads/no-ops inert and finishes once', () => {
    const probe = instrument();
    const owner = createJsonOwner(doc('"a'), {}, probe.work);
    const snapshot = owner.getSnapshot();
    const notify = vi.fn();
    owner.subscribe(notify)();
    owner.update(doc('"a'));
    expect(owner.getSnapshot()).toBe(snapshot);
    expect(probe.counts).toEqual({ create: 1, push: 1, finish: 0, project: 1 });
    owner.update(doc('"ab'));
    owner.update(doc('"abc"', 'complete'));
    owner.update(doc('"abc"', 'complete'));
    expect(probe.suffixes).toEqual(['"a', 'b', 'c"']);
    expect(probe.counts.finish).toBe(1);
    owner.update(doc('[1', 'streaming', 'b'));
    expect(probe.counts.create).toBe(2);
    owner.dispose();
    owner.dispose();
    expect(probe.counts.finish).toBe(1);
    expect(notify).not.toHaveBeenCalled();
  });
  it('finishes empty suffixes exactly once and rejects violations before work', () => {
    const probe = instrument();
    const owner = createJsonOwner(doc(''), {}, probe.work);
    owner.update(doc('', 'complete'));
    const snapshot = owner.getSnapshot();
    expect(snapshot.error?.code).toBe('UNEXPECTED_END');
    owner.update(doc('', 'complete'));
    const counts = { ...probe.counts };
    expect(() => owner.update(doc('null', 'complete'))).toThrow(/contract/);
    expect(() => owner.update(doc(''))).toThrow(/contract/);
    expect(probe.counts).toEqual(counts);
    expect(probe.counts.finish).toBe(1);
    expect(owner.getSnapshot()).toBe(snapshot);
  });
  it('captures policy once and replaces invalid documents only on explicit rebuild', () => {
    const probe = instrument();
    let reads = 0;
    const owner = createJsonOwner(
      doc('{"a":1'),
      {
        get violationPolicy(): 'rebuild' {
          reads++;
          return 'rebuild';
        },
      },
      probe.work
    );
    owner.update(doc('true', 'complete'));
    owner.update(doc('null'));
    expect(reads).toBe(1);
    expect(probe.counts.create).toBe(3);
    expect(owner.getSnapshot().root?.value).toBeNull();
  });
  it.each(['push', 'finish', 'project'] as const)(
    'rolls back %s exceptions and replays accepted input on recovery',
    (failure) => {
      const probe = instrument();
      const owner = createJsonOwner(doc('"a'), {}, probe.work);
      const before = owner.getSnapshot(),
        notify = vi.fn();
      owner.subscribe(notify);
      probe.fail[failure] = true;
      expect(() => owner.update(doc('"ab"', 'complete'))).toThrow(/failure/);
      expect(owner.getSnapshot()).toBe(before);
      expect(before.root?.value).toBe('a');
      expect(notify).not.toHaveBeenCalled();
      const counts = { ...probe.counts };
      owner.update(doc('"a'));
      expect(probe.counts).toEqual(counts);
      probe.fail[failure] = false;
      probe.fail.create = true;
      expect(() => owner.update(doc('"abc"', 'complete'))).toThrow(
        /create failure/
      );
      expect(owner.getSnapshot()).toBe(before);
      probe.fail.create = false;
      owner.update(doc('"abc"', 'complete'));
      expect(owner.getSnapshot().root?.value).toBe('abc');
      expect(owner.getSnapshot().complete).toBe(true);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(probe.suffixes.slice(-2)).toEqual(['"a', 'bc"']);
    }
  );
});
