import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  reviewEvidence,
  validateEvidence,
  type EvidenceManifest,
} from './whitepapers/evidence';

const source = '## Evidence\n\n[Protocol](https://example.org/spec)\n';
const fixture = (): EvidenceManifest => ({
  schemaVersion: 1,
  baselineRevision: 'a'.repeat(40),
  papers: Object.fromEntries(
    ['overview', 'angular', 'render', 'chat'].map((id) => [
      id,
      {
        reviewedAt: '2026-11-07',
        reviewDue: '2027-02-07',
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        sources: ['https://example.org/spec'],
        claimCategories: ['protocol contracts'],
      },
    ])
  ),
  packages: [
    { file: 'libs/react/package.json', pointer: ['private'], value: true },
  ],
});
const read = (file: string) =>
  file.endsWith('.md') ? source : JSON.stringify({ private: true });

describe('whitepaper evidence review', () => {
  it('accepts a reviewed baseline without changing its provenance', () => {
    const manifest = fixture();
    const before = JSON.stringify(manifest);
    expect(validateEvidence(manifest, read)).toEqual([]);
    expect(reviewEvidence(manifest, read, '2026-11-08')).toEqual([]);
    expect(JSON.stringify(manifest)).toBe(before);
  });
  it('identifies overdue papers only in an explicit dated review', () => {
    expect(validateEvidence(fixture(), read)).toEqual([]);
    const issues = reviewEvidence(fixture(), read, '2027-02-07');
    expect(issues.filter((issue) => issue.includes('review due'))).toHaveLength(
      4
    );
  });
  it('flags changed authored evidence and package publication status', () => {
    const changed = (file: string) =>
      file.endsWith('.md')
        ? `${source}\nNew claim.\n`
        : JSON.stringify({ private: false });
    const issues = reviewEvidence(fixture(), changed, '2026-11-08');
    expect(issues).toContain('overview: authored content changed since review');
    expect(
      issues.some((issue) =>
        issue.includes('libs/react/package.json/private changed')
      )
    ).toBe(true);
  });
  it('requires coverage of all papers and their cited external sources', () => {
    const manifest = fixture();
    delete manifest.papers.chat;
    manifest.papers.overview.sources = [];
    manifest.papers.render.claimCategories = [];
    const issues = validateEvidence(manifest, read);
    expect(issues).toContain('chat: missing evidence record');
    expect(issues).toContain(
      'overview: cited source missing from evidence: https://example.org/spec'
    );
    expect(issues).toContain('render: missing claim categories');
  });
  it('rejects impossible dates, invalid chronology and invalid revision evidence', () => {
    const manifest = fixture();
    manifest.baselineRevision = 'main';
    manifest.papers.overview.reviewedAt = '2026-02-30';
    manifest.papers.chat.reviewDue = '2026-01-01';
    const issues = validateEvidence(manifest, read);
    expect(issues.some((issue) => issue.includes('revision'))).toBe(true);
    expect(
      issues.some((issue) => issue.includes('overview: invalid review date'))
    ).toBe(true);
    expect(
      issues.some((issue) =>
        issue.includes('chat: review due must follow review date')
      )
    ).toBe(true);
  });
  it('rejects an invalid audit date rather than silently skipping overdue checks', () => {
    expect(() => reviewEvidence(fixture(), read, 'not-a-date')).toThrow(
      /date/i
    );
  });

  it.each([
    ['null manifest', null, 'Evidence manifest must be an object'],
    [
      'missing papers',
      { ...fixture(), papers: undefined },
      'papers must be an object',
    ],
    [
      'invalid categories',
      {
        ...fixture(),
        papers: {
          ...fixture().papers,
          overview: { ...fixture().papers.overview, claimCategories: 'models' },
        },
      },
      'overview: claim categories must be a string array',
    ],
    [
      'invalid source entries',
      {
        ...fixture(),
        papers: {
          ...fixture().papers,
          overview: { ...fixture().papers.overview, sources: [null] },
        },
      },
      'overview: sources must be a string array',
    ],
    [
      'invalid packages',
      { ...fixture(), packages: {} },
      'packages must be an array',
    ],
    [
      'missing package value',
      {
        ...fixture(),
        packages: [
          { file: 'libs/react/package.json', pointer: ['notARealProperty'] },
        ],
      },
      'packages[0]: value must be a string or boolean',
    ],
    [
      'invalid package pointer',
      {
        ...fixture(),
        packages: [
          { file: 'libs/react/package.json', pointer: [null], value: true },
        ],
      },
      'packages[0]: pointer must be a nonempty string array',
    ],
  ])(
    'reports %s as actionable validation issues',
    (_label, value, expected) => {
      const manifest = value as EvidenceManifest;
      expect(validateEvidence(manifest, read)).toContain(expected);
      expect(reviewEvidence(manifest, read, '2026-11-08')).toContain(expected);
    }
  );

  it('flags a missing package property as drift when its baseline is valid', () => {
    const manifest = fixture();
    manifest.packages[0].pointer = ['missing'];
    expect(reviewEvidence(manifest, read, '2026-11-08')).toContain(
      'libs/react/package.json/missing changed: true → undefined'
    );
  });
});

describe('committed whitepaper evidence', () => {
  it('covers the current papers and source links without a clock-dependent CI gate', () => {
    const root = resolve(__dirname, '../../..');
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, 'whitepapers/evidence.json'), 'utf8')
    ) as EvidenceManifest;
    expect(
      validateEvidence(manifest, (file) =>
        readFileSync(resolve(root, file), 'utf8')
      )
    ).toEqual([]);
  });
});
