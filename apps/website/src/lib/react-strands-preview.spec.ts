import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getWebsiteWorkspacePage } from './workspace-page';

it('resolves bounded Strands React Docs Code and Run with the unchanged canonical backend', async () => {
  const page = await getWebsiteWorkspacePage({ docsPath: '/docs/react/runtimes/aws-strands/overview', title: 'AWS Strands' });
  expect(page.resolution).toMatchObject({ kind: 'mapped' });
  const sources = page.contentBundle.codeSources ?? {};
  expect(sources['cockpit/runtimes/aws-strands/react/src/approval-policy.ts']).toContain('book_meeting');
  for (const file of ['agent.py', 'server.py', 'subagent_emitter.py']) expect(sources[`cockpit/runtimes/aws-strands/python/src/${file}`]).toBeTruthy();
  expect(Object.keys(sources).join(' ')).not.toMatch(/fixture|\.spec\.|type-test|model|probe|helper/);
  const overview = readFileSync(resolve(import.meta.dirname, '../../content/docs/angular/runtimes/aws-strands/overview.mdx'), 'utf8');
  expect(overview).toContain('the next Send creates a fresh thread');
  const guide = readFileSync(resolve(import.meta.dirname, '../../content/docs/react/runtimes/aws-strands/overview.mdx'), 'utf8');
  for (const claim of ['generic interrupt', 'metadata.reason', 'opaque pause', 'canonical tool result', 'process-global', 'cleanup fails', 'private source-build', 'snapshot', 'navigation preserves the mounted iframe']) expect(guide).toContain(claim);
});
