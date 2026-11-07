import { describe, expect, it } from 'vitest';
import { getDocsExamples } from './docs-examples';
import { getWebsiteDocumentResolution } from './workspace-page';
import { getWorkspacePresentation } from '@threadplane/cockpit-shell';

describe('docs example directory', () => {
  it('lists unique runnable destinations in both frameworks, never docs-only pages', () => {
    const examples = getDocsExamples();
    expect(examples.some((item) => item.framework === 'angular')).toBe(true);
    expect(examples.some((item) => item.framework === 'react')).toBe(true);
    expect(new Set(examples.map((item) => item.href)).size).toBe(
      examples.length
    );
    for (const example of examples) {
      const url = new URL(example.href, 'https://threadplane.ai');
      expect(url.searchParams.get('mode')).toBe('run');
      const resolution = getWebsiteDocumentResolution({
        docsPath: url.pathname,
        title: example.title,
      });
      const presentation = getWorkspacePresentation(
        resolution,
        example.framework
      );
      expect(presentation.kind).toBe('capability');
      expect(presentation.runnable).toBe(true);
    }
  });
});
