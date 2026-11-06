import { describe, expect, it } from 'vitest';
import type { Citation } from '@threadplane/core';
import {
  deriveDomain,
  deriveSourceType,
  deriveMonogram,
  monogramHue,
  formatPublished,
  monogramColor,
  citationTypeMeta,
  citationTypeLabel,
  citationSourceVisual,
} from './index.js';

const citation = (fields: Partial<Citation> = {}): Citation => ({
  id: 'source',
  index: 1,
  ...fields,
});

describe('public citation display helpers', () => {
  it.each([
    [undefined, null],
    ['', null],
    [' ', null],
    ['/relative', null],
    ['invalid', null],
    ['https://www.example.com/path', 'example.com'],
    ['https://EXAMPLE.com', 'example.com'],
    ['ftp://www.blocked.invalid/path', 'blocked.invalid'],
    ['javascript:alert(1)', ''],
    ['mailto:someone@example.com', ''],
  ])('extracts hostname %s without approving navigation', (url, expected) => {
    expect(deriveDomain(url)).toBe(expected);
  });

  it.each([
    [{}, 'unknown'],
    [{ sourceType: '' }, 'unknown'],
    [{ sourceType: '  ' }, 'unknown'],
    [{ sourceType: ' CuStOm ' }, 'CuStOm'],
    [{ url: '/relative' }, 'web'],
    [{ url: ' ' }, 'web'],
    [{ url: 'javascript:alert(1)' }, 'web'],
    [{ sourceType: ' file ', url: 'https://example.com' }, 'file'],
  ])('derives source type from %j', (fields, expected) => {
    expect(deriveSourceType(citation(fields))).toBe(expected);
  });

  it.each([
    [{}, '?', 'hsl(63 60% 45%)'],
    [{ title: '' }, '?', 'hsl(0 60% 45%)'],
    [{ title: ' Alpha' }, 'A', 'hsl(278 60% 45%)'],
    [{ title: 'Title', url: 'javascript:alert(1)' }, '?', 'hsl(0 60% 45%)'],
    [{ title: 'Title', url: '/relative' }, 'T', 'hsl(184 60% 45%)'],
    [
      { title: 'Ignored', url: 'https://www.example.com' },
      'E',
      'hsl(333 60% 45%)',
    ],
  ])('uses nullish domain/title seeds %j', (fields, monogram, color) => {
    expect(deriveMonogram(citation(fields))).toBe(monogram);
    expect(monogramColor(citation(fields))).toBe(color);
  });

  it.each([
    ['', 0],
    ['a', 97],
    ['abc', 234],
    ['😀', 259],
    ['𝌆', 242],
  ])('hashes UTF-16 seed %s', (seed, hue) => {
    expect(monogramHue(seed)).toBe(hue);
    expect(monogramHue(seed)).toBeGreaterThanOrEqual(0);
    expect(monogramHue(seed)).toBeLessThan(360);
  });

  it.each([undefined, 'invalid date', '', new Date(NaN)])(
    'omits invalid or missing publication %s',
    (value) => {
      expect(formatPublished(value)).toBeNull();
    }
  );
  it.each([0, '2024-04-15T12:00:00Z', new Date('2026-11-06T12:00:00Z')])(
    'formats publication in the host locale %s',
    (value) => {
      const date = value instanceof Date ? value : new Date(value);
      expect(formatPublished(value)).toBe(
        date.toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
      );
    }
  );

  it.each(['web', 'file', 'app', 'memory', 'generic'] as const)(
    'canonicalizes known %s metadata',
    (type) => {
      const label = type[0].toUpperCase() + type.slice(1);
      const c = citation({ sourceType: ` ${type.toUpperCase()} ` });
      expect(citationTypeMeta(c)).toEqual({
        type,
        label,
        icon: type,
        tone: type,
        isKnown: true,
      });
      expect(citationTypeLabel(c)).toBe(label);
    }
  );
  it.each([
    ['unknown', null],
    ['UNKNOWN', 'UNKNOWN'],
    ['my_Custom-TYPE', 'My Custom TYPE'],
    ['__proto__', 'Proto'],
    ['constructor', 'Constructor'],
    ['toString', 'ToString'],
    ['---___', null],
  ])('labels custom types safely: %s', (type, label) => {
    const c = citation({ sourceType: type });
    expect(citationTypeMeta(c)).toEqual({
      type,
      label,
      icon: 'generic',
      tone: 'generic',
      isKnown: false,
    });
    expect(citationTypeLabel(c)).toBe(label);
  });

  it('selects fresh image, type-icon and monogram descriptors without mutation', () => {
    const c = Object.freeze(
      citation({ sourceType: 'file', iconUrl: ' javascript:literal() ' })
    );
    expect(citationSourceVisual(c)).toEqual({
      kind: 'image',
      iconUrl: 'javascript:literal()',
    });
    expect(citationSourceVisual(c)).not.toBe(citationSourceVisual(c));
    expect(c.iconUrl).toBe(' javascript:literal() ');
    for (const sourceType of [
      'file',
      'app',
      'memory',
      'generic',
      'custom',
      'unknown',
    ]) {
      const meta = citationTypeMeta(citation({ sourceType }));
      expect(
        citationSourceVisual(citation({ sourceType, iconUrl: '  ' }))
      ).toEqual({
        kind: 'type-icon',
        icon: meta.icon,
        tone: meta.tone,
        label: meta.label,
      });
    }
    expect(citationSourceVisual(citation())).toEqual({
      kind: 'type-icon',
      icon: 'generic',
      tone: 'generic',
      label: null,
    });
    expect(
      citationSourceVisual(citation({ url: 'https://example.com' }))
    ).toEqual({ kind: 'monogram', monogram: 'E', color: 'hsl(333 60% 45%)' });
    expect(citationTypeMeta(c)).not.toBe(citationTypeMeta(c));
  });
});
