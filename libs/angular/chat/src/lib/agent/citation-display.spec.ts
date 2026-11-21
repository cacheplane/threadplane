import { describe, expect, it } from 'vitest';
import {
  deriveDomain, deriveSourceType, deriveMonogram, monogramHue, formatPublished,
  monogramColor, citationTypeLabel, citationTypeMeta, citationSourceVisual,
} from './citation-display';
import type { CitationTypeIcon } from './citation-display';
import type { Citation } from '@threadplane/core';

const c = (over: Partial<Citation>): Citation => ({ id: 'x', index: 1, ...over });

describe('deriveDomain', () => {
  it('strips protocol and leading www.', () => {
    expect(deriveDomain('https://www.rxjs.dev/guide')).toBe('rxjs.dev');
  });
  it('returns null for missing or malformed url', () => {
    expect(deriveDomain(undefined)).toBeNull();
    expect(deriveDomain('not a url')).toBeNull();
  });
});

describe('deriveSourceType', () => {
  it('prefers an explicit sourceType', () => {
    expect(deriveSourceType(c({ sourceType: 'file', url: 'https://a.com' }))).toBe('file');
  });
  it('preserves provider casing for custom source types', () => {
    expect(deriveSourceType(c({ sourceType: 'S3Bucket', url: 'https://a.com' }))).toBe('S3Bucket');
  });
  it('infers web from an http(s) url', () => {
    expect(deriveSourceType(c({ url: 'https://a.com' }))).toBe('web');
  });
  it('is unknown when neither is present', () => {
    expect(deriveSourceType(c({}))).toBe('unknown');
  });
});

describe('deriveMonogram', () => {
  it('uses the first letter of the domain, uppercased', () => {
    expect(deriveMonogram(c({ url: 'https://angular.dev' }))).toBe('A');
  });
  it('falls back to the title when there is no url', () => {
    expect(deriveMonogram(c({ title: 'zone.js' }))).toBe('Z');
  });
  it('falls back to "?" when nothing usable exists', () => {
    expect(deriveMonogram(c({}))).toBe('?');
  });
});

describe('monogramHue', () => {
  it('is deterministic and within [0,360)', () => {
    const h = monogramHue('rxjs.dev');
    expect(h).toBe(monogramHue('rxjs.dev'));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
  it('differs for different seeds', () => {
    expect(monogramHue('angular.dev')).not.toBe(monogramHue('rxjs.dev'));
  });
});

describe('formatPublished', () => {
  it('formats a parseable date to "Mon YYYY"', () => {
    expect(formatPublished('2024-04-10')).toMatch(/2024/);
  });
  it('returns null for missing or unparseable values', () => {
    expect(formatPublished(undefined)).toBeNull();
    expect(formatPublished('banana')).toBeNull();
  });
});

describe('monogramColor', () => {
  it('is deterministic and an hsl() string', () => {
    const a = monogramColor(c({ url: 'https://rxjs.dev' }));
    expect(a).toMatch(/^hsl\(/);
    expect(a).toBe(monogramColor(c({ url: 'https://rxjs.dev' })));
  });
});

describe('citationTypeLabel', () => {
  it('returns "Web" for a web source', () => {
    expect(citationTypeLabel(c({ url: 'https://a.com' }))).toBe('Web');
  });
  it('capitalizes a custom sourceType', () => {
    expect(citationTypeLabel(c({ sourceType: 'file', url: 'https://a.com' }))).toBe('File');
  });
  it('returns null when type is unknown', () => {
    expect(citationTypeLabel(c({}))).toBeNull();
  });
});

describe('citationTypeMeta', () => {
  it('maps canonical file/app/memory/web types to labels, icons, tones, and known=true', () => {
    const fileIcon: CitationTypeIcon = 'file';

    expect(citationTypeMeta(c({ sourceType: 'file' }))).toMatchObject({
      type: 'file', label: 'File', icon: fileIcon, tone: 'file', isKnown: true,
    });
    expect(citationTypeMeta(c({ sourceType: ' File ' }))).toMatchObject({
      type: 'file', label: 'File', icon: 'file', tone: 'file', isKnown: true,
    });
    expect(citationTypeMeta(c({ sourceType: 'app' }))).toMatchObject({
      type: 'app', label: 'App', icon: 'app', tone: 'app', isKnown: true,
    });
    expect(citationTypeMeta(c({ sourceType: 'memory' }))).toMatchObject({
      type: 'memory', label: 'Memory', icon: 'memory', tone: 'memory', isKnown: true,
    });
    expect(citationTypeMeta(c({ url: 'https://angular.dev' }))).toMatchObject({
      type: 'web', label: 'Web', icon: 'web', tone: 'web', isKnown: true,
    });
  });

  it('treats literal generic as a known generic visual type with a label', () => {
    expect(citationTypeMeta(c({ sourceType: 'generic' }))).toMatchObject({
      type: 'generic', label: 'Generic', icon: 'generic', tone: 'generic', isKnown: true,
    });
  });

  it('uses generic visuals and readable labels for custom source types', () => {
    expect(citationTypeMeta(c({ sourceType: 'company-knowledge' }))).toMatchObject({
      type: 'company-knowledge',
      label: 'Company knowledge',
      icon: 'generic',
      tone: 'generic',
      isKnown: false,
    });
    expect(citationTypeMeta(c({ sourceType: 'S3Bucket' }))).toMatchObject({
      type: 'S3Bucket',
      label: 'S3Bucket',
      icon: 'generic',
      tone: 'generic',
      isKnown: false,
    });
    expect(citationTypeMeta(c({ sourceType: 'company_knowledge' }))).toMatchObject({
      type: 'company_knowledge',
      label: 'Company knowledge',
      icon: 'generic',
      tone: 'generic',
      isKnown: false,
    });
  });

  it('treats object prototype names as custom source types', () => {
    expect(citationTypeMeta(c({ sourceType: 'constructor' }))).toMatchObject({
      type: 'constructor',
      label: 'Constructor',
      icon: 'generic',
      tone: 'generic',
      isKnown: false,
    });
  });

  it('has no label for separator-only custom source types', () => {
    expect(citationTypeMeta(c({ sourceType: '---' }))).toMatchObject({
      type: '---', label: null, icon: 'generic', tone: 'generic', isKnown: false,
    });
    expect(citationTypeLabel(c({ sourceType: '___' }))).toBeNull();
  });

  it('has no label for unknown missing source type without url', () => {
    expect(citationTypeMeta(c({}))).toMatchObject({
      type: 'unknown', label: null, icon: 'generic', tone: 'generic', isKnown: false,
    });
  });
});

describe('citationSourceVisual', () => {
  it('prefers provider iconUrl over all fallbacks', () => {
    expect(citationSourceVisual(c({
      sourceType: 'file',
      iconUrl: 'data:image/png;base64,AAA',
    }))).toMatchObject({ kind: 'image', iconUrl: 'data:image/png;base64,AAA' });
  });

  it('uses type icons for known non-web and generic/custom types', () => {
    expect(citationSourceVisual(c({ sourceType: 'file' }))).toMatchObject({
      kind: 'type-icon',
      icon: 'file',
      tone: 'file',
    });
    expect(citationSourceVisual(c({ sourceType: 'generic' }))).toMatchObject({
      kind: 'type-icon',
      icon: 'generic',
      tone: 'generic',
      label: 'Generic',
    });
    expect(citationSourceVisual(c({ sourceType: 'company-knowledge' }))).toMatchObject({
      kind: 'type-icon',
      icon: 'generic',
      tone: 'generic',
    });
    expect(citationSourceVisual(c({}))).toMatchObject({
      kind: 'type-icon',
      icon: 'generic',
      tone: 'generic',
      label: null,
    });
  });

  it('keeps web sources on monogram fallback when no iconUrl is supplied', () => {
    expect(citationSourceVisual(c({ url: 'https://angular.dev' }))).toMatchObject({
      kind: 'monogram',
      monogram: 'A',
    });
  });
});
