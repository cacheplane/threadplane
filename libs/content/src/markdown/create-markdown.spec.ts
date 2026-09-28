import { createPartialMarkdownParser } from '@cacheplane/partial-markdown';
import { describe, expect, it, vi } from 'vitest';
import { createMarkdown, createMarkdownOwner } from './create-markdown.js';
import { createProjection } from './projection.js';
import type { MarkdownDocument } from './types.js';

const doc = (
  content: string,
  phase: MarkdownDocument['phase'] = 'streaming',
  generation = 'a'
): MarkdownDocument => ({ generation, phase, content });
function instrument() {
  const pushes: string[] = [],
    counts = { parsers: 0, finish: 0, project: 0 };
  const fail = { push: false, finish: false, project: false, create: false };
  const work = {
    createParser() {
      counts.parsers++;
      if (fail.create) throw new Error('create failure');
      const parser = createPartialMarkdownParser();
      return {
        get root() {
          return parser.root;
        },
        push(text: string) {
          pushes.push(text);
          const events = parser.push(text);
          if (fail.push) throw new Error('push failure');
          return events;
        },
        finish() {
          counts.finish++;
          const events = parser.finish();
          if (fail.finish) throw new Error('finish failure');
          return events;
        },
      };
    },
    createProjection() {
      const project = createProjection();
      return (root: Parameters<typeof project>[0]) => {
        counts.project++;
        const owned = project(root);
        if (fail.project) throw new Error('project failure');
        return owned;
      };
    },
  };
  return { pushes, counts, fail, work };
}
describe('Markdown owner', () => {
  it('parses synchronously, captures input, and keeps reads/subscriptions/no-ops inert', () => {
    const probe = instrument(),
      input = {
        generation: 'a',
        phase: 'streaming' as const,
        content: 'hello',
      };
    const owner = createMarkdownOwner(input, {}, probe.work),
      first = owner.getSnapshot();
    expect(first.root?.type).toBe('document');
    expect(probe.pushes).toEqual(['hello']);
    expect(probe.counts).toEqual({ parsers: 1, finish: 0, project: 1 });
    input.content = 'poison';
    expect(first.document.content).toBe('hello');
    const notify = vi.fn(),
      release = owner.subscribe(notify);
    for (let i = 0; i < 10; i++) {
      expect(owner.getSnapshot()).toBe(first);
      owner.update(doc('hello'));
    }
    release();
    release();
    expect(notify).not.toHaveBeenCalled();
    expect(probe.counts).toEqual({ parsers: 1, finish: 0, project: 1 });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.document)).toBe(true);
  });
  it('appends only suffix, finishes once, replaces generation, and never finishes on dispose', () => {
    const probe = instrument(),
      owner = createMarkdownOwner(doc('a'), {}, probe.work);
    owner.update(doc('abc'));
    owner.update(doc('abcd', 'complete'));
    owner.update(doc('abcd', 'complete'));
    expect(probe.pushes).toEqual(['a', 'bc', 'd']);
    expect(probe.counts.finish).toBe(1);
    owner.update(doc('new', 'streaming', 'b'));
    expect(probe.pushes).toEqual(['a', 'bc', 'd', 'new']);
    expect(probe.counts.parsers).toBe(2);
    const snapshot = owner.getSnapshot();
    owner.dispose();
    owner.dispose();
    expect(owner.getSnapshot()).toBe(snapshot);
    expect(probe.counts.finish).toBe(1);
    const notify = vi.fn();
    owner.subscribe(notify)();
    expect(notify).not.toHaveBeenCalled();
    expect(() => owner.update(doc('other'))).toThrow(/disposed/);
  });
  it('keeps empty input null after finish and finishes an empty suffix once', () => {
    const probe = instrument(),
      owner = createMarkdownOwner(doc(''), {}, probe.work);
    owner.update(doc('', 'complete'));
    owner.update(doc('', 'complete'));
    expect(owner.getSnapshot().root).toBeNull();
    expect(probe.counts.finish).toBe(1);
  });
  it('throws all same-generation violations before parser work and preserves the snapshot', () => {
    const probe = instrument(),
      owner = createMarkdownOwner(doc('hello'), {}, probe.work);
    const first = owner.getSnapshot();
    for (const input of [doc('h'), doc('world')])
      expect(() => owner.update(input)).toThrow(/contract/);
    expect(owner.getSnapshot()).toBe(first);
    expect(probe.pushes).toEqual(['hello']);
    owner.update(doc('hello', 'complete'));
    const complete = owner.getSnapshot();
    expect(() => owner.update(doc('hello'))).toThrow(/complete-to-streaming/);
    expect(() => owner.update(doc('hello!', 'complete'))).toThrow(
      /post-completion/
    );
    expect(owner.getSnapshot()).toBe(complete);
    expect(probe.counts.finish).toBe(1);
  });
  it('captures explicit rebuild policy once and uses a fresh parser for violations', () => {
    const probe = instrument();
    let reads = 0;
    const owner = createMarkdownOwner(
      doc('hello'),
      {
        get violationPolicy(): 'rebuild' {
          reads++;
          return 'rebuild';
        },
      },
      probe.work
    );
    const first = owner.getSnapshot();
    owner.update(doc('other', 'complete'));
    owner.update(doc('short'));
    expect(reads).toBe(1);
    expect(probe.pushes).toEqual(['hello', 'other', 'short']);
    expect(probe.counts.parsers).toBe(3);
    expect(first.document.content).toBe('hello');
    expect(owner.getSnapshot().document.content).toBe('short');
  });
  it.each(['push', 'finish', 'project'] as const)(
    'recovers discarded derived state after %s failure without publishing or reparsing a no-op',
    (failure) => {
      const probe = instrument(),
        owner = createMarkdownOwner(doc('a'), {}, probe.work),
        notify = vi.fn();
      owner.subscribe(notify);
      const first = owner.getSnapshot();
      probe.fail[failure] = true;
      expect(() => owner.update(doc('ab', 'complete'))).toThrow(/failure/);
      expect(owner.getSnapshot()).toBe(first);
      expect(notify).not.toHaveBeenCalled();
      const counts = { ...probe.counts };
      owner.update(doc('a'));
      expect(probe.counts).toEqual(counts);
      probe.fail[failure] = false;
      probe.fail.create = true;
      expect(() => owner.update(doc('abc', 'complete'))).toThrow(
        /create failure/
      );
      expect(() => owner.update(doc('abc', 'complete'))).toThrow(
        /create failure/
      );
      expect(owner.getSnapshot()).toBe(first);
      probe.fail.create = false;
      owner.update(doc('abc', 'complete'));
      expect(owner.getSnapshot().document).toEqual(doc('abc', 'complete'));
      expect(notify).toHaveBeenCalledTimes(1);
      const text = JSON.stringify(owner.getSnapshot().root);
      expect(text).toContain('abc');
      expect(text).not.toContain('ababc');
    }
  );
  it('captures each caller primitive once and classifies against a getter-triggered inner update', () => {
    const owner = createMarkdown(doc('a'));
    const reads = { generation: 0, phase: 0, content: 0 };
    owner.update({
      get generation() {
        reads.generation++;
        owner.update(doc('ab'));
        return 'a';
      },
      get phase(): 'streaming' {
        reads.phase++;
        return 'streaming';
      },
      get content() {
        reads.content++;
        return 'abc';
      },
    });
    expect(reads).toEqual({ generation: 1, phase: 1, content: 1 });
    expect(owner.getSnapshot().document.content).toBe('abc');
    expect(JSON.stringify(owner.getSnapshot().root)).toContain('abc');
  });
  it('outer rejection or throwing getter never rolls back an inner accepted update', () => {
    const owner = createMarkdown(doc('a'));
    expect(() =>
      owner.update({
        generation: 'a',
        phase: 'streaming',
        get content() {
          owner.update(doc('ab'));
          return 'a';
        },
      })
    ).toThrow(/contract/);
    const inner = owner.getSnapshot();
    expect(() =>
      owner.update({
        generation: 'a',
        phase: 'streaming',
        get content(): string {
          owner.update(doc('abc'));
          throw new Error('getter');
        },
      })
    ).toThrow('getter');
    expect(inner.document.content).toBe('ab');
    expect(owner.getSnapshot().document.content).toBe('abc');
  });
  it('getter disposal is terminal and disposed updates do not read input', () => {
    const owner = createMarkdown(doc('a')),
      first = owner.getSnapshot();
    expect(() =>
      owner.update({
        get generation() {
          owner.dispose();
          return 'a';
        },
        phase: 'streaming',
        content: 'ab',
      })
    ).toThrow(/disposed/);
    expect(owner.getSnapshot()).toBe(first);
    expect(() =>
      owner.update({
        get generation(): string {
          throw new Error('must not read');
        },
        phase: 'streaming',
        content: '',
      })
    ).toThrow(/disposed/);
  });
  it('commits before callbacks, coalesces reentrant invalidations, and contains errors', () => {
    const owner = createMarkdown(doc('a')),
      seen: string[] = [];
    let depth = 0,
      maxDepth = 0;
    owner.subscribe(() => {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      seen.push('first:' + owner.getSnapshot().document.content);
      if (owner.getSnapshot().document.content === 'ab') {
        owner.update(doc('abc'));
        owner.update(doc('abcd'));
      }
      depth--;
    });
    owner.subscribe(() => {
      throw new Error('observer');
    });
    owner.subscribe(() =>
      seen.push('last:' + owner.getSnapshot().document.content)
    );
    owner.update(doc('ab'));
    expect(maxDepth).toBe(1);
    expect(seen).toEqual(['first:ab', 'last:abcd', 'first:abcd', 'last:abcd']);
  });
  it('removes registrations during a pass, defers new registrations, and treats duplicates independently', () => {
    const owner = createMarkdown(doc('a')),
      seen: string[] = [],
      duplicate = () => seen.push('duplicate');
    let remove: () => void = () => undefined;
    owner.subscribe(() => {
      seen.push('first');
      remove();
      owner.subscribe(() => seen.push('new'));
    });
    remove = owner.subscribe(() => seen.push('removed'));
    const release = owner.subscribe(duplicate);
    owner.subscribe(duplicate);
    release();
    release();
    owner.update(doc('ab'));
    expect(seen).toEqual(['first', 'duplicate']);
    seen.length = 0;
    owner.update(doc('abc'));
    expect(seen).toEqual(['first', 'duplicate', 'new']);
  });
  it('disposal during notification stops the pass and pending invalidations; other owners remain independent', () => {
    const owner = createMarkdown(doc('a')),
      other = createMarkdown(doc('other')),
      later = vi.fn();
    owner.subscribe(() => {
      owner.update(doc('abc'));
      owner.dispose();
    });
    owner.subscribe(later);
    owner.update(doc('ab'));
    expect(owner.getSnapshot().document.content).toBe('abc');
    expect(later).not.toHaveBeenCalled();
    other.update(doc('other!'));
    expect(other.getSnapshot().document.content).toBe('other!');
  });
});
