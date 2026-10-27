import { describe, expect, it } from 'vitest';
import { markdownUrl } from './markdown-url.js';

describe('markdownUrl', () => {
  for (const value of [
    'https://example.test/a?q=1#x',
    'HTTP://example.test',
    '/relative',
    './a:b',
    './a&b',
    './a&b:c',
    '/a&b:c',
    '?a&b:c',
    '#a&b:c',
    'folder/a&b:c',
    'folder?a&b:c',
    'folder#a&b:c',
    'HTTPS://example.test/a&b:c?q=a&b:c',
    'safe-relative',
    '../other',
    '#fragment',
    '//example.test/image',
  ]) {
    for (const kind of ['link', 'image'] as const)
      it(`preserves ${kind} ${JSON.stringify(value)}`, () => {
        expect(markdownUrl(value, kind)).toBe(value);
      });
  }
  for (const value of ['mailto:person@example.test', 'TEL:+12345'])
    it(`allows ${value} only for links`, () => {
      expect(markdownUrl(value, 'link')).toBe(value);
      expect(markdownUrl(value, 'image')).toBeUndefined();
    });
  for (const value of [
    '',
    ' \t\n',
    'javascript:alert(1)',
    '\u0000 JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    'data:image/png;base64,AA==',
    'file:///tmp/a',
    'ftp://example.test/a',
    'a:b',
    '  https://example.test/a  ',
    '\u0000https://example.test',
    'a&b',
    'a&b:c',
    'a&b/path',
    'a&b?query',
    'a&b#fragment',
    'https://[broken',
    'https://bad host/',
    'https://%zz/',
  ]) {
    for (const kind of ['link', 'image'] as const)
      it(`omits ${kind} ${JSON.stringify(value)}`, () => {
        expect(markdownUrl(value, kind)).toBeUndefined();
      });
  }
  it('rejects every ASCII control byte anywhere in an otherwise accepted URL', () => {
    for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
      for (const value of [
        `${String.fromCharCode(code)}https://example.test`,
        `https://example.test/a${String.fromCharCode(code)}b`,
        `https://example.test/${String.fromCharCode(code)}`,
      ]) {
        for (const kind of ['link', 'image'] as const)
          expect(markdownUrl(value, kind), JSON.stringify(value)).toBeUndefined();
      }
    }
  });
});
