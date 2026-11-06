import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { getNarrativeDocuments, resolveNarrativeDocument } from './docs-catalog';
import { apiPagePaths, readApiIndex } from './api-reference';
import { resolveWebsiteDir } from './website-dir';
import { specialDocsPages } from './docs-config';

it('keeps authored internal document links on existing canonical pages', () => {
  const special = new Set(['/docs', ...specialDocsPages.map(page => page.path)]);
  const api = new Set(apiPagePaths(readApiIndex()));
  const sources = [...getNarrativeDocuments().map(doc => doc.source), ...specialDocsPages.map(page => page.contentPath)];
  const failures: string[] = [];
  for (const source of sources) {
    const body = fs.readFileSync(path.join(resolveWebsiteDir(), 'content/docs', source), 'utf8');
    for (const match of body.matchAll(/(?:\]\(|href=["'])(?:https:\/\/threadplane\.ai)?(\/docs(?:\/[^\s)"'#?]+)?)(?:[#?][^\s)"']*)?/g)) {
      const href = match[1];
      if (!special.has(href) && !api.has(href) && !resolveNarrativeDocument(href)) failures.push(`${source}: ${href}`);
    }
  }
  expect(failures).toEqual([]);
});
