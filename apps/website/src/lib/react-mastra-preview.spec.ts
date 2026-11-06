import { expect, it } from 'vitest';
import { getWebsiteWorkspacePage } from './workspace-page';

it('resolves native Mastra Docs Code and Run while preserving canonical Angular', async () => {
  const page = await getWebsiteWorkspacePage({ docsPath: '/docs/react/runtimes/mastra/overview', title: 'Mastra' });
  expect(page.resolution).toMatchObject({ kind: 'mapped' });
  expect(page.contentBundle.codeSources['cockpit/runtimes/mastra/react/src/approval-policy.ts']).toContain('reserve_campsite');
  expect(Object.keys(page.contentBundle.codeSources ?? {}).join(' ')).not.toMatch(/fixture|\.spec\.|model|probe/);
});
