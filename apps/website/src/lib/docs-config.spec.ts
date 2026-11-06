import { describe, expect, it } from 'vitest';
import { getFrameworkDocsConfig, libraryIntroPath } from './docs-config';
import { getFrameworkDocuments } from './docs-catalog';

describe('framework navigation configuration', () => {
  it('offers only actual framework variants and shared narratives in catalog order', () => {
    for (const framework of ['angular', 'react'] as const) {
      const expected = getFrameworkDocuments(framework).filter(doc => doc.library !== null);
      const pages = getFrameworkDocsConfig(framework).flatMap(lib => lib.sections.filter(section => section.id !== 'api').flatMap(section => section.pages));
      expect(pages.map(page => page.href)).toEqual(expected.map(doc => doc.href));
      expect(new Set(pages.map(page => page.href)).size).toBe(pages.length);
    }
  });

  it('uses the first available actual guide when a React library has no introduction', () => {
    expect(libraryIntroPath('langgraph', 'react')).toBe('/docs/react/langgraph/guides/streaming');
    expect(libraryIntroPath('middleware', 'react')).toBe('/docs/shared/middleware/getting-started/introduction');
    expect(libraryIntroPath('langgraph')).toBe('/docs/angular/langgraph/getting-started/introduction');
  });
});
