import { expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getWebsiteWorkspacePage } from './workspace-page';
import { createWebsitePlaywrightConfig } from '../../playwright.config';

it('isolates website Debug integration to two owned servers and records its Nx prerequisites', () => {
  const config = createWebsitePlaywrightConfig({ WEBSITE_E2E_REACT_TOPIC: 'chat-debug', WEBSITE_E2E_PORT: '3000', CI: 'true', PLAYWRIGHT_REUSE_EXISTING_SERVER: 'true' });
  expect(config.testMatch).toBe('**/react-debug-preview.spec.ts');
  expect(config.workers).toBe(1);
  expect(config.fullyParallel).toBe(false);
  expect(config.retries).toBe(0);
  expect(config.outputDir).toContain('output/playwright/chat-debug-website');
  const servers = config.webServer as { url: string; command: string; reuseExistingServer?: boolean; gracefulShutdown?: unknown }[];
  expect(servers.map(server => server.url)).toEqual(['http://127.0.0.1:3000', 'http://127.0.0.1:4645']);
  for (const server of servers) expect(server).toMatchObject({ reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } });
  expect(servers[1].command).toBe('node scripts/react-cockpit/serve.mjs chat-debug --no-parent');
  const project = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../project.json'), 'utf8'));
  expect(project.implicitDependencies).toContain('cockpit-chat-debug-react');
  expect(project.targets.e2e.dependsOn.find((dependency: { target: string }) => dependency.target === 'test').projects).toContain('cockpit-chat-debug-python');
  expect(project.targets.e2e.dependsOn.find((dependency: { target: string }) => dependency.target === 'build').projects).toContain('cockpit-chat-debug-react');
  expect(createWebsitePlaywrightConfig({ WEBSITE_E2E_REACT_TOPIC: 'chat-debug', BASE_URL: 'https://example.test' }).webServer).toBeUndefined();
});

it('resolves Debug React Docs Code and Run with only authored frontend and canonical Python sources', async () => {
  const page = await getWebsiteWorkspacePage({ docsPath: '/docs/chat/components/chat-debug', title: 'ChatDebugComponent' });
  expect(page.frontendVariants?.react?.resolution).toMatchObject({ kind: 'mapped' });
  const bundle = page.frontendVariants?.react?.contentBundle;
  expect(bundle?.runtimeUrl).toMatch(/\/chat\/debug\/react\/?$/);
  expect(page.frontendVariants?.react?.presentation).toMatchObject({ devPort: 4645, runtimeUrl: 'chat/debug/react' });
  const sources = bundle?.codeSources ?? {};
  for (const file of ['app.tsx', 'application.ts', 'authority.ts', 'checkpoint-page.ts', 'inspection-values.ts', 'connection.ts', 'main.tsx', 'styles.css'])
    expect(sources[`cockpit/chat/debug/react/src/${file}`]).toBeTruthy();
  expect(sources['cockpit/chat/debug/react/project.json']).toBeTruthy();
  expect(sources['cockpit/chat/debug/python/src/graph.py']).toContain('TAG_NOSTREAM');
  expect(bundle?.promptFiles['cockpit/chat/debug/python/prompts/debug.md']).toBeTruthy();
  expect(Object.keys(sources).join(' ')).not.toMatch(/fixture|\.spec\.|tests\/|wire\.py|credentials/);
});

it('documents the passive bounded first slice with reader-sized examples and explicit remaining parity', () => {
  const path = resolve(import.meta.dirname, '../components/docs/ReactChatDebugPreview.tsx');
  expect(existsSync(path)).toBe(true);
  if (!existsSync(path)) return;
  const guide = readFileSync(path, 'utf8');
  for (const claim of ['@threadplane/react/debug', '@threadplane/react/debug/styles.css', 'c-debug', '4645', 'getHistory', 'getState', '131072', '32768', '2000', 'TAG_NOSTREAM', 'T29', 'Replay', 'Fork', 'private', 'canonical Angular guide retains its own API']) expect(guide).toContain(claim);
  expect(guide).not.toContain('<ExampleCode file="cockpit/chat/debug/react/src/application.ts"');
});
