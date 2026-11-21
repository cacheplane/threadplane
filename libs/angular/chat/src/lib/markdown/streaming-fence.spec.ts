//
// Consumer-side guarantee: with the partial-markdown version chat depends on,
// a triple-backtick fence whose opener is split across streamed chunks still
// materializes as a code block — never as a paragraph with inline code.
// Fixed upstream in 0.5.6 (opener-marker tracking); this spec guards against
// a dependency downgrade reintroducing it. The e2e harnesses' large default
// chunkSize is a determinism choice, not a workaround for this — see
// libs/e2e-harness/src/aimock-runner.ts.
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser, materialize } from '@cacheplane/partial-markdown';

function finalTypes(chunks: string[]): string[] {
  const p = createPartialMarkdownParser();
  for (const chunk of chunks) p.push(chunk);
  p.finish();
  const doc = materialize(p.root) as { children?: Array<{ type: string }> } | null;
  return (doc?.children ?? []).map((c) => c.type);
}

describe('the chat UI consumes streamed code fences', () => {
  it('recovers an opener split one backtick at a time', () => {
    expect(finalTypes(['`', '`', '`ts\n', 'const x = 1;\n', '```\n']))
      .toEqual(['code-block']);
  });

  it('recovers a closer split one backtick at a time', () => {
    expect(finalTypes(['```ts\nconst x = 1;\n', '`', '`', '`\n']))
      .toEqual(['code-block']);
  });

  it('survives arbitrary small chunkings of fenced content after prose', () => {
    const text = 'Here is the snippet:\n\n```typescript\nconst answer = 42;\n```\n\nDone.\n';
    for (let chunkSize = 1; chunkSize <= 7; chunkSize++) {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize));
      const types = finalTypes(chunks);
      expect(types, `chunkSize ${chunkSize}`).toEqual(['paragraph', 'code-block', 'paragraph']);
    }
  });

  it('keeps genuine inline code inline', () => {
    expect(finalTypes(['Use `npm', ' i` first.\n'])).toEqual(['paragraph']);
  });
});
