// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as docs from './docs';

const contentRoot = fs.existsSync(path.join(process.cwd(), 'content/docs'))
  ? path.join(process.cwd(), 'content/docs')
  : path.join(process.cwd(), 'apps/website/content/docs');

describe('neutral documentation source', () => {
  it('reads the adapter article from the existing MDX source for HTML and Markdown', () => {
    const source = fs.readFileSync(
      path.join(contentRoot, 'choosing-an-adapter/index.mdx'),
      'utf8'
    );
    const doc = docs.getSpecialDocByPath('/docs/choosing-an-adapter');
    expect(doc?.content).toBe(source);
    expect(doc?.body).toBe(docs.stripFrontmatter(source));
  });

  it('does not resolve unregistered neutral paths', () => {
    expect(docs.getSpecialDocByPath('/docs/../../package')).toBeNull();
  });
});
