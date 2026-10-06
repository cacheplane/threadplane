import { describe, expect, it, vi } from 'vitest';
import { decodeTitle } from './titles';
describe('optional literal conversation titles', () => {
  it('accepts a matching own string title and trims only surrounding whitespace', () => {
    expect(
      decodeTitle(
        { thread_id: 'a', metadata: { title: '  <b>Literal</b>  ' } },
        'a'
      )
    ).toBe('<b>Literal</b>');
  });
  it('bounds Unicode code points without splitting a surrogate pair', () => {
    expect(
      decodeTitle({ thread_id: 'a', metadata: { title: '😀'.repeat(81) } }, 'a')
    ).toBe('😀'.repeat(80));
  });
  it.each([
    undefined,
    null,
    {},
    { thread_id: 'b', metadata: { title: 'foreign' } },
    { thread_id: 'a' },
    { thread_id: 'a', metadata: null },
    { thread_id: 'a', metadata: { title: '' } },
    { thread_id: 'a', metadata: { title: '   ' } },
    { thread_id: 'a', metadata: { title: 42 } },
    { thread_id: 'a', metadata: { title: { text: 'bad' } } },
  ])('ignores missing, wrong-thread or malformed metadata %#', (raw) => {
    expect(decodeTitle(raw, 'a')).toBeUndefined();
  });
  it('never invokes getters or string coercion', () => {
    const getter = vi.fn(() => 'secret'),
      coerce = vi.fn(() => 'secret');
    expect(
      decodeTitle(
        {
          thread_id: 'a',
          metadata: Object.defineProperty({}, 'title', { get: getter }),
        },
        'a'
      )
    ).toBeUndefined();
    expect(
      decodeTitle(
        { thread_id: 'a', metadata: { title: { toString: coerce } } },
        'a'
      )
    ).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    expect(coerce).not.toHaveBeenCalled();
  });
  it('rejects inherited title or thread fields', () => {
    expect(
      decodeTitle(
        { thread_id: 'a', metadata: Object.create({ title: 'Inherited' }) },
        'a'
      )
    ).toBeUndefined();
    expect(
      decodeTitle(
        Object.assign(Object.create({ thread_id: 'a' }), {
          metadata: { title: 'Inherited' },
        }),
        'a'
      )
    ).toBeUndefined();
  });
});
