import {
  createPartialMarkdownParser,
  type MarkdownNode as ParserNode,
} from '@cacheplane/partial-markdown';
import { describe, expect, it } from 'vitest';
import { createProjection } from './projection.js';
import type { MarkdownNode } from './types.js';
const walk = (
  node: MarkdownNode | ParserNode | null
): readonly (MarkdownNode | ParserNode)[] =>
  node
    ? [node, ...('children' in node ? node.children.flatMap(walk) : [])]
    : [];
function find<T extends MarkdownNode['type']>(
  root: MarkdownNode | ParserNode | null,
  type: T
): Extract<
  MarkdownNode | ParserNode,
  {
    type: T;
  }
> {
  const node = walk(root).find((node) => node.type === type);
  if (!node) throw new Error(`Missing ${type}`);
  return node as Extract<
    MarkdownNode | ParserNode,
    {
      type: T;
    }
  >;
}
describe('owned canonical Markdown projection', () => {
  it('inspects a cached graph without allocating tentative node records', () => {
    const parser = createPartialMarkdownParser();
    parser.push('stable\n\n- [x] task\n\n');
    const work = { visits: 0, nodes: 0, arrays: 0, definitions: 0 },
      project = createProjection(work);
    const first = project(parser.root);
    expect(work.nodes).toBeGreaterThan(0);
    work.nodes = 0;
    work.visits = 0;
    work.arrays = 0;
    work.definitions = 0;
    expect(project(parser.root)).toBe(first);
    expect(work.visits).toBeGreaterThan(0);
    expect(work.nodes).toBe(0);
    expect(work.arrays).toBe(0);
    expect(work.definitions).toBe(0);
  });
  it('keeps an empty root null, including after finish', () => {
    const parser = createPartialMarkdownParser(),
      project = createProjection();
    expect(project(parser.root)).toBeNull();
    parser.finish();
    expect(project(parser.root)).toBeNull();
  });
  it('owns tasks and table alignments; consumer mutations cannot change canonical data', () => {
    const parser = createPartialMarkdownParser(),
      project = createProjection();
    parser.push('- [ ] first\n\n| a | b |\n| --- | :---: |\n| x | y |\n\n');
    const root = project(parser.root);
    const task = find(root, 'list-item'),
      table = find(root, 'table');
    expect(task.task).toEqual({ checked: false });
    expect(table.alignments).toEqual([null, 'center']);
    expect(() =>
      Reflect.set(required(task.task), 'checked', true)
    ).not.toThrow();
    expect(Reflect.set(required(task.task), 'checked', true)).toBe(false);
    expect(Reflect.set(table.alignments, '0', 'right')).toBe(false);
    expect(Reflect.set(task, 'status', 'pending')).toBe(false);
    expect(Reflect.set(required(root).children, '0', null)).toBe(false);
    expect(
      walk(root).every((n) => n.parent === null && Object.isFrozen(n))
    ).toBe(true);
    expect(find(parser.root, 'list-item').task).toEqual({ checked: false });
    expect(find(parser.root, 'table').alignments).toEqual([null, 'center']);
    expect(project(parser.root)).toBe(root);
  });
  it('owns definition values and exposes no map mutation or backing map through forEach', () => {
    const parser = createPartialMarkdownParser(),
      project = createProjection();
    parser.push(
      '[a][ref] and [^one]\n\n[ref]: /old "Title"\n\n[^one]: citation\n\n'
    );
    const root = required(project(parser.root));
    expect(root.linkDefinitions.size).toBe(1);
    expect(root.citations.size).toBe(1);
    expect(root.linkDefinitions.get('ref')?.url).toBe('/old');
    expect('clear' in root.linkDefinitions).toBe(false);
    expect('set' in root.linkDefinitions).toBe(false);
    expect('delete' in root.linkDefinitions).toBe(false);
    expect(Object.isFrozen(root.linkDefinitions)).toBe(true);
    root.linkDefinitions.forEach((value, key, map) => {
      expect(map).toBe(root.linkDefinitions);
      expect(map.get(key)).toBe(value);
      expect(Reflect.set(value, 'url', '/poison')).toBe(false);
      expect(Reflect.set(map, 'get', () => null)).toBe(false);
    });
    const citation = required(root.citations.get('one'));
    expect(Object.isFrozen(citation)).toBe(true);
    expect(Object.isFrozen(citation.children)).toBe(true);
    expect(Reflect.set(citation.children, '0', null)).toBe(false);
    const pair = [...root.linkDefinitions][0];
    pair[0] = 'changed';
    expect([...root.linkDefinitions.keys()]).toEqual(['ref']);
    expect([...root.linkDefinitions.values()][0].url).toBe('/old');
    expect(required(parser.root).linkDefinitions.get('ref')?.url).toBe('/old');
    expect(project(parser.root)).toBe(root);
  });
  it('observes canonical image completion and retains the prior streaming snapshot', () => {
    const parser = createPartialMarkdownParser(),
      project = createProjection();
    parser.push('![alt](/url)');
    const before = required(project(parser.root));
    expect(find(before, 'image').status).toBe('streaming');
    parser.finish();
    const after = required(project(parser.root));
    expect(find(parser.root, 'image').status).toBe('complete');
    expect(find(after, 'image').status).toBe('complete');
    expect(find(before, 'image').status).toBe('streaming');
    expect(after).not.toBe(before);
    expect(find(after, 'image')).not.toBe(find(before, 'image'));
  });
  it('retains all fragmented snapshots through reinterpretation and shares unchanged subtrees', () => {
    const parser = createPartialMarkdownParser(),
      project = createProjection();
    parser.push('stable\n\n');
    const first = required(project(parser.root));
    const retained = JSON.stringify(first);
    parser.push('-');
    const paragraph = required(project(parser.root));
    parser.push(' item');
    const list = required(project(parser.root));
    expect(list.children[0]).toBe(first.children[0]);
    expect(paragraph.children[1].type).toBe('paragraph');
    expect(list.children[1].type).toBe('list');
    expect(list.children[1].id).toBe(paragraph.children[1].id);
    expect(JSON.stringify(first)).toBe(retained);
    expect(project(parser.root)).toBe(list);
    parser.finish();
    project(parser.root);
    expect(JSON.stringify(first)).toBe(retained);
  });
  it('never shares different canonical objects just because numeric IDs match', () => {
    const a = createPartialMarkdownParser(),
      b = createPartialMarkdownParser(),
      project = createProjection();
    a.push('same');
    b.push('same');
    expect(required(a.root).id).toBe(required(b.root).id);
    const first = project(a.root),
      second = project(b.root);
    expect(first).not.toBe(second);
    expect(required(first).children[0]).not.toBe(required(second).children[0]);
  });
  it('publishes definition and reference resolution changes without mutating retained values', () => {
    const parser = createPartialMarkdownParser(),
      project = createProjection();
    parser.push('[a][ref] and [^one]\n\n');
    const before = required(project(parser.root));
    expect(find(before, 'link-reference').resolved).toBe(false);
    parser.push('[ref]: /new "Title"\n\n[^one]: citation\n\n');
    const after = required(project(parser.root));
    expect(find(after, 'link-reference')).toMatchObject({
      resolved: true,
      url: '/new',
      title: 'Title',
    });
    expect(find(before, 'link-reference').resolved).toBe(false);
    expect(before.linkDefinitions.size).toBe(0);
    expect(before.citations.size).toBe(0);
    expect(after.linkDefinitions.size).toBe(1);
    expect(after.citations.size).toBe(1);
    const link = required(after.linkDefinitions.get('ref')),
      citation = required(after.citations.get('one'));
    required(required(parser.root).linkDefinitions.get('ref')).url = '/later';
    required(required(parser.root).citations.get('one')).index = 7;
    const changed = required(project(parser.root));
    expect(changed.linkDefinitions.get('ref')?.url).toBe('/later');
    expect(changed.citations.get('one')?.index).toBe(7);
    expect(link.url).toBe('/new');
    expect(citation.index).not.toBe(7);
  });
  it('checks every published scalar even when the canonical object identity is unchanged', () => {
    const parser = createPartialMarkdownParser(),
      project = createProjection();
    parser.push(
      '# heading\n\n> quote\n\n1. item\n\n- [x] task\n\n```js\ncode\n```\n\n*em* **strong** ~~strike~~ `code` [link](/url "title") <https://example.test> ![alt](/img) [a][ref] [^one]\n\n| a | b |\n| :--- | ---: |\n| x | y |\n\n[ref]: /reference\n\n[^one]: note\n\n---\n'
    );
    parser.finish();
    let root = required(project(parser.root));
    let checked = 0;
    for (const canonical of walk(parser.root)) {
      for (const [key, value] of Object.entries(canonical)) {
        if (
          key === 'type' ||
          !['string', 'number', 'boolean'].includes(typeof value)
        )
          continue;
        const prior = root;
        const next =
          typeof value === 'number'
            ? value + 1
            : typeof value === 'boolean'
            ? !value
            : value + '!';
        Reflect.set(canonical, key, next);
        root = required(project(parser.root));
        expect(root).not.toBe(prior);
        const owned = required(
          walk(root).find(
            (n) => n.id === canonical.id && n.type === canonical.type
          )
        );
        expect(Reflect.get(owned, key)).toBe(next);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected a parsed value');
  return value;
}
