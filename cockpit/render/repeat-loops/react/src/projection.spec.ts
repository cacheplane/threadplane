import { createPartialJsonParser, materialize } from '@cacheplane/partial-json';
import { describe, expect, it } from 'vitest';
import { projectPartialSpec, validateCompleteSpec } from './projection';
import { REPEAT_SAMPLES } from './specs';

const complete = () => ({
  root: 'root',
  elements: {
    root: {
      type: 'Heading',
      props: { content: 'Simple List' },
      children: ['group'],
    },
    group: {
      type: 'Card',
      props: { title: 'Items' },
      repeat: { statePath: '/items', key: 'id' },
      children: ['row'],
    },
    row: {
      type: 'Text',
      props: {
        content: { $item: 'label' },
        itemId: { $item: 'id' },
        index: { $index: true },
      },
    },
  },
});

describe('owned keyed repeat projection', () => {
  it('copies and freezes the admitted native container and child binding shape', () => {
    const source = complete(),
      projected = validateCompleteSpec(source);
    expect(projected).toEqual(source);
    expect(Object.isFrozen(projected.elements.group.repeat)).toBe(true);
    expect(Object.isFrozen(projected.elements.row.props.index)).toBe(true);
    expect(Object.isFrozen(source.elements.group.repeat)).toBe(false);
    source.elements.group.repeat.key = 'changed';
    source.elements.row.props.content.$item = 'changed';
    expect(projected.elements.group.repeat?.key).toBe('id');
    expect(projected.elements.row.props.content).toEqual({ $item: 'label' });
  });

  it('accepts every actual sample prefix including false placeholders while reading true', () => {
    expect(REPEAT_SAMPLES.map((sample) => sample.label)).toEqual([
      'Simple List',
      'Task List',
      'Sections',
    ]);
    let pendingFalse = 0;
    for (const sample of REPEAT_SAMPLES) {
      const parser = createPartialJsonParser();
      let retained: ReturnType<typeof projectPartialSpec> = null,
        frozen = '';
      for (const character of sample.json) {
        parser.push(character);
        const input = parser.root ? materialize(parser.root) : null;
        const projected = projectPartialSpec(input);
        if (projected && !retained) {
          retained = projected;
          frozen = JSON.stringify(projected);
        }
        if (retained) expect(JSON.stringify(retained)).toBe(frozen);
        const row = (
          input as {
            elements?: { row?: { props?: { index?: { $index?: boolean } } } };
          } | null
        )?.elements?.row;
        if (row?.props?.index?.$index === false) {
          pendingFalse++;
          expect(projected?.elements.row?.props.index).toBeUndefined();
        }
        if (projected)
          for (const element of Object.values(projected.elements)) {
            if (element.repeat)
              expect(element.repeat).toEqual({
                statePath: '/items',
                key: 'id',
              });
            for (const child of element.children ?? [])
              expect(Object.hasOwn(projected.elements, child)).toBe(true);
          }
      }
      parser.finish();
      expect(parser.root?.status).toBe('complete');
      expect(validateCompleteSpec(materialize(parser.root!))).toEqual(
        JSON.parse(sample.json)
      );
      expect(retained).not.toBeNull();
    }
    expect(pendingFalse).toBeGreaterThanOrEqual(3);
  });

  it('withholds a repeating container until both exact metadata fields are ready', () => {
    for (const repeat of [
      undefined,
      {},
      { statePath: '/ite', key: 'id' },
      { statePath: '/items' },
      { statePath: '/items', key: 'i' },
    ]) {
      const source = complete();
      Object.assign(source.elements.group, { repeat });
      const partial = projectPartialSpec(source);
      expect(partial?.elements.group).toBeUndefined();
      expect(partial?.elements.root.children).toEqual([]);
      expect(() => validateCompleteSpec(source)).toThrow();
    }
  });

  it('withholds partial item and index values while rejecting complete false or unknown expressions', () => {
    for (const [key, value] of [
      ['content', {}],
      ['content', { $item: 'lab' }],
      ['itemId', { $item: 'i' }],
      ['index', { $index: false }],
    ] as const) {
      const source = complete();
      Object.assign(source.elements.row.props, { [key]: value });
      expect(
        projectPartialSpec(source)?.elements.row.props[key]
      ).toBeUndefined();
      expect(() => validateCompleteSpec(source)).toThrow();
    }
    for (const value of [
      { $item: '' },
      { $item: 'private' },
      { $item: 'label', extra: true },
      { $bindItem: 'label' },
      { $state: '/items' },
      null,
      [],
    ]) {
      const source = complete();
      Object.assign(source.elements.row.props, { content: value });
      expect(() => validateCompleteSpec(source)).toThrow();
    }
  });

  it('rejects bindings outside repeat scope, repeats on a leaf, and nested repeats', () => {
    const outside = complete();
    outside.elements.root.children = ['group', 'row'];
    expect(() => validateCompleteSpec(outside)).toThrow();
    const leaf = complete();
    Object.assign(leaf.elements.row, {
      repeat: { statePath: '/items', key: 'id' },
    });
    expect(() => validateCompleteSpec(leaf)).toThrow();
    const nested = complete();
    Object.assign(nested.elements.row, {
      type: 'Card',
      props: { title: 'Nested' },
      repeat: { statePath: '/items', key: 'id' },
    });
    expect(() => validateCompleteSpec(nested)).toThrow();
    for (const repeat of [
      { statePath: '/private', key: 'id' },
      { statePath: '/items', key: 'label' },
      { statePath: '/items', key: 'id', extra: true },
    ]) {
      const source = complete();
      Object.assign(source.elements.group, { repeat });
      expect(() => validateCompleteSpec(source)).toThrow();
    }
  });

  it('does not invoke expression or metadata accessors and rejects executable fields', () => {
    let reads = 0;
    const accessor = Object.defineProperty({}, '$item', {
      enumerable: true,
      get: () => {
        reads++;
        return 'label';
      },
    });
    const source = complete();
    Object.assign(source.elements.row.props, { content: accessor });
    expect(() => validateCompleteSpec(source)).toThrow();
    const metadata = complete();
    Object.assign(metadata.elements.group, {
      repeat: Object.defineProperty({ key: 'id' }, 'statePath', {
        enumerable: true,
        get: () => {
          reads++;
          return '/items';
        },
      }),
    });
    expect(() => validateCompleteSpec(metadata)).toThrow();
    expect(reads).toBe(0);
    const executable = complete();
    Object.assign(executable.elements.row, { on: { click: 'remove' } });
    expect(() => validateCompleteSpec(executable)).toThrow();
  });

  it('rejects cycles, duplicate children, missing final rows and oversized literal data', () => {
    for (const children of [['root'], ['row', 'row'], ['absent']]) {
      const source = complete();
      source.elements.group.children = children;
      expect(() => validateCompleteSpec(source)).toThrow();
    }
    const source = complete();
    source.elements.group.props.title = 'x'.repeat(16 * 1024 + 1);
    expect(() => validateCompleteSpec(source)).toThrow();
    expect(projectPartialSpec(null)).toBeNull();
  });
});
