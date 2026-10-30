import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCockpitFrontends } from '@threadplane/cockpit-registry';
import { websiteSuites, suiteFrontends, previewSpec } from '../e2e-suites';
import {
  createDeployedWebsitePlaywrightConfig,
  createWebsiteSuitePlaywrightConfig,
} from '../suite.playwright.config';
import { createWebsitePlaywrightConfig } from '../playwright.config';

const root = resolve(import.meta.dirname, '..');
const project = JSON.parse(readFileSync(resolve(root, 'project.json'), 'utf8'));

it('assigns every React preview spec and registered frontend to exactly one group', () => {
  const frontends = websiteSuites
    .filter((s) => s !== 'control-plane')
    .flatMap(suiteFrontends);
  expect(frontends.map((f) => f.project).sort()).toEqual(
    getCockpitFrontends()
      .filter((f) => f.frontend === 'react')
      .map((f) => f.project)
      .sort()
  );
  expect(frontends.map(previewSpec).sort()).toEqual(
    readdirSync(resolve(root, 'e2e'))
      .filter((f) => /^react-.*-preview\.spec\.ts$/.test(f))
      .sort()
  );
});

it('preserves all prerequisite proofs across the grouped targets', () => {
  const pairs = (dependencies: { target: string; projects: string[] }[]) =>
    dependencies.flatMap((d) => d.projects.map((p) => `${p}:${d.target}`));
  const grouped = new Set(
    websiteSuites.flatMap((s) => pairs(project.targets[`e2e-${s}`].dependsOn))
  );
  for (const proof of pairs(project.targets.e2e.dependsOn))
    expect(grouped.has(proof), proof).toBe(true);
  for (const suite of websiteSuites) {
    const target = project.targets[`e2e-${suite}`];
    expect(target).toMatchObject({
      cache: false,
      options: { skipInstall: true },
    });
    expect(
      target.dependsOn
        .find((d: { target: string }) => d.target === 'build')
        .projects.sort()
    ).toEqual(
      suiteFrontends(suite)
        .map((f) => f.project)
        .sort()
    );
  }
});

it('starts only each group’s runtimes while retaining the original server contracts', () => {
  const original = createWebsitePlaywrightConfig({});
  const all = Array.isArray(original.webServer) ? original.webServer : [];
  const selectedUrls = new Set<string>();
  for (const suite of websiteSuites) {
    const config = createWebsiteSuitePlaywrightConfig(suite, {});
    const servers = Array.isArray(config.webServer) ? config.webServer : [];
    expect(servers.length).toBeLessThan(all.length);
    expect(servers[0]).toEqual(all[0]);
    for (const server of servers) {
      expect(all).toContainEqual(server);
      selectedUrls.add(server.url ?? '');
    }
    for (const frontend of suiteFrontends(suite))
      expect(
        servers.some(
          (s) => new URL(s.url ?? '').port === String(frontend.port)
        ),
        frontend.project
      ).toBe(true);
    expect(config.projects).toEqual(original.projects);
    expect(config.retries).toEqual(original.retries);
    expect(config.testMatch).toEqual(
      suite === 'control-plane'
        ? undefined
        : suiteFrontends(suite).map((f) => `**/${previewSpec(f)}`)
    );
    expect(config.testIgnore).toEqual([
      ...(original.testIgnore as string[]),
      ...(suite === 'control-plane' ? ['**/react-*-preview.spec.ts'] : []),
    ]);
  }
  expect([...selectedUrls].sort()).toEqual(all.map((s) => s.url ?? '').sort());
});

describe('public surface ownership', () => {
  it('omits duplicate local executions only with an explicit deployed owner', () => {
    const full = createWebsiteSuitePlaywrightConfig('control-plane', {});
    const owned = createWebsiteSuitePlaywrightConfig('control-plane', {
      WEBSITE_E2E_DEPLOYED_OWNER: 'true',
    });
    expect(owned.testIgnore).toContain('**/website.spec.ts');
    for (const file of [
      'custom-runtime-targets', 'workspace-shell', 'workspace-mode-history',
      'workspace-run-announcement', 'home-stage', 'docs-deep-link', 'docs-shell',
      'render-spec-docs-hydration',
    ]) expect(owned.testIgnore).not.toContain(`**/${file}.spec.ts`);
    expect(owned.webServer).toEqual(full.webServer);
    expect(owned.projects).toEqual(full.projects);
    expect(owned.retries).toEqual(full.retries);
    expect(owned.testMatch).toEqual(full.testMatch);
    for (const value of [undefined, '', 'false', 'true ']) {
      expect(createWebsiteSuitePlaywrightConfig('control-plane', {
        WEBSITE_E2E_DEPLOYED_OWNER: value,
      })).toEqual(full);
    }
  });

  it('keeps the other local groups and the deployed suite complete', () => {
    for (const suite of websiteSuites.filter(s => s !== 'control-plane')) {
      expect(createWebsiteSuitePlaywrightConfig(suite, {
        WEBSITE_E2E_DEPLOYED_OWNER: 'true',
      })).toEqual(createWebsiteSuitePlaywrightConfig(suite, {}));
    }
    const env = { BASE_URL: 'https://preview.example.test' };
    expect(createDeployedWebsitePlaywrightConfig({
      ...env, WEBSITE_E2E_DEPLOYED_OWNER: 'true',
    })).toEqual(createDeployedWebsitePlaywrightConfig(env));
  });
});

describe('deployed suite', () => {
  it('keeps the existing deployed selection, bypass setup and browser settings without local prerequisites', () => {
    const env = {
      BASE_URL: 'https://preview.example.test',
      RUNTIME_BYPASS_ORIGIN: 'https://runtime.example.test',
      VERCEL_EXAMPLES_AUTOMATION_BYPASS_SECRET: 'test-secret',
      VERCEL_AUTOMATION_BYPASS_SECRET: 'test-secret',
      CI: 'true',
    };
    expect(createDeployedWebsitePlaywrightConfig(env)).toEqual(
      createWebsitePlaywrightConfig(env)
    );
    expect(project.targets['deployed-e2e']).toMatchObject({
      cache: false,
      dependsOn: [],
      options: { skipInstall: true },
    });
  });
  it.each([
    undefined,
    '',
    'http://localhost:4308',
    'https://user:password@example.test',
    'https://example.test/path',
    'https://example.test?query=1',
  ])('rejects an absent or non-origin deployment URL: %s', (BASE_URL) => {
    expect(() => createDeployedWebsitePlaywrightConfig({ BASE_URL })).toThrow(
      /BASE_URL/
    );
  });
  it('rejects modes that silently narrow the suite', () => {
    for (const key of [
      'WEBSITE_E2E_MODE',
      'PRODUCTION_SMOKE',
      'CUSTOM_RUNTIME_BFCACHE',
      'WEBSITE_E2E_REACT_TOPIC',
    ]) {
      expect(() =>
        createDeployedWebsitePlaywrightConfig({
          BASE_URL: 'https://example.test',
          [key]: 'true',
        })
      ).toThrow(/mode/);
      expect(() =>
        createWebsiteSuitePlaywrightConfig('agents', { [key]: 'true' })
      ).toThrow(/mode/);
    }
    expect(() =>
      createWebsiteSuitePlaywrightConfig('agents', {
        BASE_URL: 'https://example.test',
      })
    ).toThrow(/BASE_URL/);
  });
});
