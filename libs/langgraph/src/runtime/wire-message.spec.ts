import { describe, expect, it } from 'vitest';
import { textContent } from './wire-message';

describe('visible wire text', () => {
  describe.each(['text', 'output_text', undefined])(
    'accepted type %j',
    (type) => {
      it('captures a string once without coercing a later object value', () => {
        let reads = 0;
        let coercions = 0;
        const later = {
          toString() {
            coercions++;
            return 'Coerced';
          },
        };
        const block = {
          type,
          get text() {
            return ++reads === 1 ? 'Captured' : later;
          },
        };
        expect(textContent([block])).toBe('Captured');
        expect(reads).toBe(1);
        expect(coercions).toBe(0);
      });

      it('does not revisit a getter that throws on the second read', () => {
        let reads = 0;
        const block = {
          type,
          get text() {
            if (++reads > 1) throw new Error('second text read');
            return 'Captured';
          },
        };
        expect(textContent([block])).toBe('Captured');
        expect(reads).toBe(1);
      });
    }
  );

  it.each([
    'reasoning',
    'thinking',
    'image',
    'image_url',
    'tool_use',
    'tool_result',
    'unknown',
    null,
  ])('never reads text for excluded type %j', (type) => {
    expect(
      textContent([
        {
          type,
          get text() {
            throw new Error('excluded text read');
          },
        },
      ])
    ).toBe('');
  });

  it.each(['', ' \n ', 'Answer'])(
    'preserves top-level string %j verbatim',
    (text) => {
      expect(textContent(text)).toBe(text);
    }
  );

  it.each([
    ['string entries', ['Saved ', 'answer']],
    ['output text', [{ type: 'output_text', text: 'Saved answer' }]],
    ['untyped text', [{ text: 'Saved answer' }]],
  ])('projects %s', (_name, content) => {
    expect(textContent(content)).toBe('Saved answer');
  });

  it('joins supported pieces in order without separators or coercion', () => {
    const stringify = () => {
      throw new Error('must not coerce');
    };
    expect(
      textContent([
        'Saved',
        null,
        42,
        ['nested'],
        stringify,
        { type: 'text', text: ' ' },
        { type: 'output_text', text: 'final' },
        { text: '' },
        { type: undefined, text: ' answer' },
        ...[
          'reasoning',
          'thinking',
          'image',
          'image_url',
          'tool_use',
          'tool_result',
          'unknown',
          null,
        ].map((type) => ({ type, text: 'hidden' })),
        { text: 1 },
        { type: 'text', text: { toString: stringify } },
      ])
    ).toBe('Saved final answer');
  });

  it.each([undefined, null, 1, true, { text: 'not an array' }, () => 'no'])(
    'ignores unsupported top-level value %j',
    (value) => {
      expect(textContent(value)).toBe('');
    }
  );

  it('reads frozen and mutable inputs without mutating or freezing either', () => {
    const block = { type: 'output_text', text: 'Answer' };
    const input = [block];
    expect(textContent(input)).toBe('Answer');
    expect(input).toEqual([{ type: 'output_text', text: 'Answer' }]);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(block)).toBe(false);
    expect(
      textContent(Object.freeze([Object.freeze({ text: 'Answer' })]))
    ).toBe('Answer');
    block.text = 'Changed';
    expect(textContent(input)).toBe('Changed');
  });
});
