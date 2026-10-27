import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { renderThreadTitle } from './thread-title';

afterEach(cleanup);
it.each([
  ['Alpha notes', '', null],
  ['Alpha notes', '   ', null],
  ['Alpha notes', ' ALPHA ', 'Alpha'],
  ['Alpha Alpha', 'alpha', 'Alpha'],
  ['a.*b', '.*', '.*'],
  ['<script>text</script>', '<script>', '<script>'],
  ['😀Alpha😀', 'alpha', 'Alpha'],
  ['İstanbul', 'i', 'İ'],
  ['İstanbul', '\u0307', 'İ'],
  ['ΟΣ', 'ος', 'ΟΣ'],
  ['ΟΣ', 'οσ', null],
  ['e\u0301clair', '\u0301', '\u0301'],
  ['Alpha', 'beta', null],
])('preserves %s with literal query %s', (title, query, marked) => {
  const view = render(<span>{renderThreadTitle(title, query)}</span>);
  expect(view.container.textContent).toBe(title);
  const marks = view.container.querySelectorAll('mark');
  expect(marks.length).toBe(marked === null ? 0 : 1);
  if (marked !== null) expect(marks[0].textContent).toBe(marked);
  expect(view.container.querySelector('script')).toBeNull();
});
