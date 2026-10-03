import { createPartialJsonParser, materialize } from '@cacheplane/partial-json';
import { describe, expect, it } from 'vitest';
import { projectPartialSpec, validateCompleteSpec } from './projection';
import { STATE_SAMPLES } from './specs';

function complete(value: unknown = { $state: '/user/name' }) {
  return {
    root: 'root',
    elements: {
      root: {
        type: 'Card',
        props: { title: 'State' },
        children: ['name', 'age', 'theme'],
      },
      name: { type: 'Text', props: { content: value } },
      age: {
        type: 'Label',
        props: { label: 'Age', value: { $state: '/user/age' } },
      },
      theme: {
        type: 'Label',
        props: { label: 'Theme', value: { $state: '/settings/theme' } },
      },
    },
  };
}

describe('owned state binding projection', () => {
  it('copies and freezes only the authored binding vocabulary', () => {
    const source = complete();
    const projected = validateCompleteSpec(source);
    expect(projected).toEqual(source);
    expect(Object.isFrozen(projected.elements.name.props.content)).toBe(true);
    expect(Object.isFrozen(projected.elements.root.children)).toBe(true);
    expect(Object.isFrozen(source.elements.name.props.content)).toBe(false);
    (source.elements.name.props.content as { $state: string }).$state =
      '/user/age';
    expect(projected.elements.name.props.content).toEqual({
      $state: '/user/name',
    });
  });

  it('accepts every real prefix of all three authored samples without freezing the parser', () => {
    expect(STATE_SAMPLES.map((sample) => sample.label)).toEqual([
      'User Profile',
      'Nested Paths',
      'Form Display',
    ]);
    for (const sample of STATE_SAMPLES) {
      const parser = createPartialJsonParser();
      let retained: ReturnType<typeof projectPartialSpec> = null;
      let retainedJson = '';
      for (const character of sample.json) {
        parser.push(character);
        const projected = projectPartialSpec(
          parser.root ? materialize(parser.root) : null
        );
        if (projected && !retained) {
          retained = projected;
          retainedJson = JSON.stringify(projected);
        }
        if (retained) expect(JSON.stringify(retained)).toBe(retainedJson);
        if (projected)
          for (const element of Object.values(projected.elements)) {
            for (const child of element.children ?? [])
              expect(Object.hasOwn(projected.elements, child)).toBe(true);
            for (const value of Object.values(element.props)) {
              if (value && typeof value === 'object')
                expect([
                  '/user/name',
                  '/user/age',
                  '/settings/theme',
                ]).toContain((value as { $state: string }).$state);
            }
          }
      }
      parser.finish();
      expect(parser.root?.status).toBe('complete');
      expect(validateCompleteSpec(materialize(parser.root!))).toEqual(
        JSON.parse(sample.json)
      );
      expect(retained).not.toBeNull();
    }
  });

  it('withholds a binding until its exact allowed path arrives', () => {
    for (const value of [
      {},
      { $state: undefined },
      { $state: '' },
      { $state: '/user/na' },
    ]) {
      const projected = projectPartialSpec(complete(value));
      expect(projected?.elements.name.props).toEqual({});
      expect(() => validateCompleteSpec(complete(value))).toThrow();
    }
    expect(projectPartialSpec(complete())?.elements.name.props.content).toEqual(
      { $state: '/user/name' }
    );
  });

  it('rejects unknown paths, executable expressions and bindings in literal-only props', () => {
    for (const value of [
      { $state: '/secrets' },
      { $state: '/user/name', fallback: 'x' },
      { $computed: 'x' },
      { $bindState: '/user/name' },
      [],
      null,
      Infinity,
    ])
      expect(() => validateCompleteSpec(complete(value))).toThrow();
    const source = complete();
    source.elements.root.props.title = {
      $state: '/user/name',
    } as unknown as string;
    expect(() => validateCompleteSpec(source)).toThrow();
    const executable = complete();
    Object.assign(executable.elements.name, { on: { click: 'mutate' } });
    expect(() => validateCompleteSpec(executable)).toThrow();
  });

  it('preserves literal text and finite numeric values without coercing opaque data', () => {
    for (const value of ['<script>literal</script>', '', 0, 42])
      expect(
        validateCompleteSpec(complete(value)).elements.name.props.content
      ).toBe(value);
    let reads = 0;
    const value = Object.defineProperty({}, '$state', {
      enumerable: true,
      get: () => {
        reads++;
        return '/user/name';
      },
    });
    expect(() => validateCompleteSpec(complete(value))).toThrow();
    expect(reads).toBe(0);
    expect(() =>
      validateCompleteSpec(complete(Object.create({ $state: '/user/name' })))
    ).toThrow();
  });

  it('rejects cycles, repeated children, missing final children and oversized sources', () => {
    for (const children of [['root'], ['name', 'name'], ['absent']]) {
      const source = complete();
      source.elements.root.children = children;
      expect(() => validateCompleteSpec(source)).toThrow();
    }
    expect(() =>
      validateCompleteSpec(complete('x'.repeat(16 * 1024 + 1)))
    ).toThrow();
    expect(projectPartialSpec(null)).toBeNull();
  });
});
