// libs/angular/chat/src/lib/markdown/cacheplane-markdown-views.spec.ts
import { describe, it, expect } from 'vitest';
import { cacheplaneMarkdownViews } from './cacheplane-markdown-views';
import { MarkdownMathComponent } from './views/markdown-math.component';

describe('cacheplaneMarkdownViews', () => {
  it('registers all 26 markdown node types (v0.4 adds math + html nodes)', () => {
    expect(Object.keys(cacheplaneMarkdownViews).sort()).toEqual([
      'autolink',
      'blockquote',
      'citation-reference',
      'code-block',
      'document',
      'emphasis',
      'hard-break',
      'heading',
      'html-block',
      'html-inline',
      'image',
      'inline-code',
      'link',
      'list',
      'list-item',
      'math-display',
      'math-inline',
      'paragraph',
      'soft-break',
      'strikethrough',
      'strong',
      'table',
      'table-cell',
      'table-row',
      'text',
      'thematic-break',
    ]);
  });

  it('registers a view for both math node types', () => {
    expect(cacheplaneMarkdownViews['math-inline']).toBe(MarkdownMathComponent);
    expect(cacheplaneMarkdownViews['math-display']).toBe(MarkdownMathComponent);
  });

  it('is a frozen registry (immutable at runtime)', () => {
    expect(Object.isFrozen(cacheplaneMarkdownViews)).toBe(true);
  });
});
