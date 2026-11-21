//
// Consumer-side guarantee: with the partial-markdown version chat depends on, a
// streaming table header renders as a `table` immediately — before the delimiter
// row and while it is buffered awaiting the delimiter — instead of blanking out.
// Guards against a dependency downgrade reintroducing the table blank/flash.
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser, materialize } from '@cacheplane/partial-markdown';

function topType(p: ReturnType<typeof createPartialMarkdownParser>): string | null {
  const doc = materialize(p.root) as { children?: Array<{ type: string }> } | null;
  return doc?.children?.[0]?.type ?? null;
}

describe('the chat UI consumes streaming table headers', () => {
  it('shows a table header immediately, before and during the delimiter wait', () => {
    const p = createPartialMarkdownParser();
    p.push('| Name | Age |'); // first row, still on the open line (no newline)
    expect(topType(p)).toBe('table'); // pre-0.5.2: null (header buffered/blank)
    p.push('\n'); // header committed; delimiter not yet streamed
    expect(topType(p)).toBe('table'); // pre-0.5.2: null (the blank gap)
    p.push('| --- | --- |\n| Ada | 36 |\n'); // delimiter + body commit
    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].type).toBe('table');
    expect(doc.children[0].children.length).toBeGreaterThanOrEqual(2); // header + body
  });
});
