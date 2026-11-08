import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIELD_REPORT } from './field-report';

// Anchored to the workspace root the way the other file-reading specs here
// are, rather than to a bare relative path: both `nx test website` and
// `vitest --root apps/website` run with the repo root as the working
// directory, and jsdom makes `import.meta.url` an http: URL, so neither a
// cwd-relative path nor a module-relative one resolves the file.
const findWorkspaceRoot = (): string => {
  let directory = process.cwd();
  while (directory !== resolve(directory, '..')) {
    if (existsSync(join(directory, 'nx.json'))) return directory;
    directory = resolve(directory, '..');
  }
  throw new Error('workspace root (nx.json) not found');
};

const PDF = join(findWorkspaceRoot(), 'apps/website/public/whitepaper.pdf');

describe('FIELD_REPORT', () => {
  it('declares the page count the PDF actually has', () => {
    // The homepage advertised "18 pages" for a 17-page document, in exchange
    // for an email address. Counting the page objects in the file itself is
    // dependency-free and means regenerating the PDF at a different length
    // fails here instead of silently making the page lie.
    const pdf = readFileSync(PDF, 'latin1');
    const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pages).toBeGreaterThan(0);
    expect(FIELD_REPORT.pages).toBe(pages);
  });

  it('lists the chapters in the authored publication', () => {
    const source = readFileSync(
      join(findWorkspaceRoot(), 'apps/website/content/whitepapers/overview.md'),
      'utf8'
    );
    expect(FIELD_REPORT.chapters).toEqual(
      [...source.matchAll(/^## (.+)$/gm)].map((match) => match[1])
    );
  });

  it('carries the cover strings the document prints', () => {
    expect(FIELD_REPORT.title).toBe('From Prototype to Production');
    expect(FIELD_REPORT.kicker).toBe(
      'Threadplane · Open source · Angular + React'
    );
    expect(FIELD_REPORT.subtitle).toBeTruthy();
    expect(FIELD_REPORT.year).toBe('2026');
  });
});
