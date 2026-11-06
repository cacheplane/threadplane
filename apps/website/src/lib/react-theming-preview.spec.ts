import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getWebsiteWorkspacePage } from './workspace-page';

it('resolves Theming Docs Code and Run with authored sources and canonical Python assets', async () => {
  const page = await getWebsiteWorkspacePage({
    docsPath: '/docs/react/chat/guides/theming',
    title: 'Theming',
  });
  expect(page.resolution).toMatchObject({
    kind: 'mapped',
  });
  const sources = page.contentBundle.codeSources ?? {};
  for (const file of [
    'app.tsx',
    'application.ts',
    'connection.ts',
    'themes.ts',
    'main.tsx',
    'styles.css',
  ])
    expect(sources[`cockpit/chat/theming/react/src/${file}`]).toBeTruthy();
  expect(sources['cockpit/chat/theming/react/project.json']).toBeTruthy();
  expect(sources['cockpit/chat/theming/python/src/graph.py']).toContain(
    'TAG_NOSTREAM'
  );
  expect(
    page.contentBundle.promptFiles[
      'cockpit/chat/theming/python/prompts/theming.md'
    ]
  ).toBeTruthy();
  expect(Object.keys(sources).join(' ')).not.toMatch(
    /fixture|\.spec\.|tests\/|wire\.py/
  );
  const guide = readFileSync(
    resolve(
      import.meta.dirname,
      '../../content/docs/react/chat/guides/theming.mdx'
    ),
    'utf8'
  );
  for (const token of [
    'text',
    'muted',
    'border',
    'surface',
    'accent',
    'on-accent',
    'danger',
    'gap',
  ])
    expect(guide).toContain('--tp-chat-' + token);
  for (const claim of [
    'MessageList',
    'Markdown',
    'ChatInput',
    'TAG_NOSTREAM',
    'saved-history confirmation',
    'demo-local bridge',
    'private source-build',
    'Angular remains the default',
  ])
    expect(guide).toContain(claim);
});
