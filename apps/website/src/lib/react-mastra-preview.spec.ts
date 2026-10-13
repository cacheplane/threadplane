import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getWebsiteWorkspacePage } from './workspace-page';

it('resolves native Mastra Docs Code and Run while preserving canonical Angular', async () => {
  const page = await getWebsiteWorkspacePage({ docsPath: '/docs/runtimes/mastra/overview', title: 'Mastra' });
  expect(page.frontendVariants?.react?.resolution).toMatchObject({ kind: 'mapped' });
  expect(page.frontendVariants?.react?.contentBundle.codeSources['cockpit/runtimes/mastra/react/src/approval-policy.ts']).toContain('reserve_campsite');
  expect(Object.keys(page.frontendVariants?.react?.contentBundle.codeSources ?? {}).join(' ')).not.toMatch(/fixture|\.spec\.|model|probe/);
  const route = readFileSync(resolve(import.meta.dirname, '../app/docs/[library]/[section]/[slug]/page.tsx'), 'utf8');
  expect(route).toContain('ReactMastraPreview');
});
