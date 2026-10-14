import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getWebsiteWorkspacePage } from './workspace-page';

it('resolves bounded MAF React Docs Code and Run with the unchanged canonical backend', async () => {
  const page = await getWebsiteWorkspacePage({ docsPath: '/docs/runtimes/microsoft-agent-framework/overview', title: 'Microsoft Agent Framework' });
  expect(page.frontendVariants?.react?.resolution).toMatchObject({ kind: 'mapped' });
  const sources = page.frontendVariants?.react?.contentBundle.codeSources ?? {};
  expect(sources['cockpit/runtimes/microsoft-agent-framework/react/src/approval-policy.ts']).toContain('submit_expense');
  for (const file of ['agent.py', 'server.py', 'snapshot_compat.py']) expect(sources[`cockpit/runtimes/microsoft-agent-framework/python/src/${file}`]).toBeTruthy();
  expect(Object.keys(sources).join(' ')).not.toMatch(/fixture|\.spec\.|type-test|model|probe|helper/);
  const route = readFileSync(resolve(import.meta.dirname, '../app/docs/[library]/[section]/[slug]/page.tsx'), 'utf8');
  expect(route).toContain('ReactMafPreview');
  const guide = readFileSync(resolve(import.meta.dirname, '../components/docs/ReactMafPreview.tsx'), 'utf8');
  expect(guide).toContain('A normal terminal may omit its outcome field.');
  expect(guide).toContain('without a **TOOL_CALL_RESULT** event');
});
