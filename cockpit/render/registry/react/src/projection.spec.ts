import { createPartialJsonParser, materialize } from '@cacheplane/partial-json';
import { describe, expect, it } from 'vitest';
import { projectPartialSpec, validateCompleteSpec } from './projection';
import { REGISTRY_SAMPLES } from './specs';

it('owns every actual prefix of all three authored registry samples', () => {
  expect(REGISTRY_SAMPLES.map((sample) => sample.label)).toEqual([
    'Basic Types',
    'Card Layout',
    'Mixed Components',
  ]);
  for (const sample of REGISTRY_SAMPLES) {
    const parser = createPartialJsonParser();
    let retained: ReturnType<typeof projectPartialSpec> = null,
      frozen = '';
    for (const character of sample.json) {
      parser.push(character);
      const projected = projectPartialSpec(
        parser.root ? materialize(parser.root) : null
      );
      if (projected && !retained) {
        retained = projected;
        frozen = JSON.stringify(projected);
      }
      if (retained) expect(JSON.stringify(retained)).toBe(frozen);
    }
    parser.finish();
    expect(parser.root?.status).toBe('complete');
    expect(validateCompleteSpec(materialize(parser.root!))).toEqual(
      JSON.parse(sample.json)
    );
    expect(retained).not.toBeNull();
  }
});

const complete = () => ({
  root: 'root',
  elements: {
    root: {
      type: 'Heading',
      props: { content: 'Literal <script>text</script>' },
      children: ['text'],
    },
    text: { type: 'Text', props: { content: 'Retained child' } },
  },
});

describe('owned local render projection', () => {
  it('copies and freezes known literal views without changing borrowed values', () => {
    const source = complete();
    const projected = validateCompleteSpec(source);
    expect(projected).toEqual(source);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.elements)).toBe(true);
    expect(Object.isFrozen(projected.elements.root.props)).toBe(true);
    expect(Object.isFrozen(projected.elements.root.children)).toBe(true);
    expect(Object.isFrozen(source.elements.root.props)).toBe(false);
    source.elements.root.props.content = 'Changed';
    source.elements.root.children.length = 0;
    expect(projected.elements.root.props.content).toBe(
      'Literal <script>text</script>'
    );
    expect(projected.elements.root.children).toEqual(['text']);
  });

  it('accepts every actual parser prefix while withholding incomplete types and references', () => {
    const parser = createPartialJsonParser();
    const source = JSON.stringify(complete());
    let captured: ReturnType<typeof projectPartialSpec> = null;
    for (const character of source) {
      parser.push(character);
      const input = parser.root ? materialize(parser.root) : null;
      const projected = projectPartialSpec(input);
      if (projected) {
        expect(['Heading', 'Text']).toContain(projected.elements.root.type);
        for (const element of Object.values(projected.elements))
          for (const child of element.children ?? [])
            expect(Object.hasOwn(projected.elements, child)).toBe(true);
        if (!captured && projected.elements.root.props.content)
          captured = projected;
      }
    }
    parser.finish();
    expect(parser.root?.status).toBe('complete');
    expect(validateCompleteSpec(materialize(parser.root!))).toEqual(complete());
    expect(captured).not.toBeNull();
    expect(captured!.elements.root.props.content).not.toBe(
      complete().elements.root.props.content
    );
  });

  it('withholds an absent root or an incomplete view type', () => {
    for (const input of [
      null,
      {},
      { root: 'root' },
      { root: 'root', elements: {} },
      { root: 'root', elements: { root: { type: 'Hea' } } },
    ])
      expect(projectPartialSpec(input)).toBeNull();
    expect(() =>
      validateCompleteSpec({
        root: 'root',
        elements: { root: { type: 'Hea' } },
      })
    ).toThrow();
  });

  it('keeps a known partial heading and waits for its missing child', () => {
    const projected = projectPartialSpec({
      root: 'root',
      elements: {
        root: {
          type: 'Heading',
          props: { content: 'Wel' },
          children: ['pending'],
        },
      },
    });
    expect(projected?.elements.root.props.content).toBe('Wel');
    expect(projected?.elements.root.children).toEqual([]);
    expect(() =>
      validateCompleteSpec({
        root: 'root',
        elements: { root: { type: 'Heading', children: ['pending'] } },
      })
    ).toThrow();
  });

  it('rejects executable fields, unsupported literal props, duplicate children and cycles', () => {
    for (const extra of [
      { on: {} },
      { watch: {} },
      { repeat: {} },
      { visible: true },
    ]) {
      const source = complete();
      Object.assign(source.elements.root, extra);
      expect(() => projectPartialSpec(source)).toThrow();
    }
    for (const content of [42, {}, [], Number.NaN]) {
      const source = complete();
      Object.assign(source.elements.root.props, { content });
      expect(() => projectPartialSpec(source)).toThrow();
    }
    const duplicate = complete();
    duplicate.elements.root.children = ['text', 'text'];
    expect(() => projectPartialSpec(duplicate)).toThrow();
    const cycle = complete();
    cycle.elements.root.children = ['root'];
    expect(() => projectPartialSpec(cycle)).toThrow();
  });

  it('rejects accessors without invoking them or accepting inherited maps', () => {
    let reads = 0;
    const source = complete();
    Object.defineProperty(source.elements.root.props, 'content', {
      enumerable: true,
      get() {
        reads++;
        return 'private';
      },
    });
    expect(() => projectPartialSpec(source)).toThrow();
    expect(reads).toBe(0);
    expect(() =>
      projectPartialSpec({
        root: 'root',
        elements: Object.create({ root: complete().elements.root }),
      })
    ).toThrow();
  });

  it('bounds node counts, child references and literal text', () => {
    const source = complete();
    source.elements.root.props.content = 'x'.repeat(16385);
    expect(() => projectPartialSpec(source)).toThrow();
    const many = {
      root: 'root',
      elements: { root: complete().elements.root } as Record<string, unknown>,
    };
    for (let index = 0; index < 33; index++)
      many.elements['node' + index] = { type: 'Text', props: { content: 'x' } };
    expect(() => projectPartialSpec(many)).toThrow();
    const children = complete();
    children.elements.root.children = Array.from(
      { length: 33 },
      (_, index) => 'node' + index
    );
    expect(() => projectPartialSpec(children)).toThrow();
  });
});
