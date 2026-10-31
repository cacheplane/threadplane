import { defineConfig } from '@playwright/test';
import { getCockpitFrontends } from '@threadplane/cockpit-registry';
import { createWebsitePlaywrightConfig } from './playwright.config';
import { poolAngularServers } from './angular-startup';
import { poolAgentServers } from './agents-startup';
import {
  deployedSurfaceSpecs,
  previewSpec,
  suiteFrontends,
  type WebsiteSuite,
} from './e2e-suites';

type Environment = Readonly<Record<string, string | undefined>>;

function assertFullSuiteMode(environment: Environment) {
  for (const key of [
    'WEBSITE_E2E_MODE',
    'PRODUCTION_SMOKE',
    'CUSTOM_RUNTIME_BFCACHE',
    'WEBSITE_E2E_REACT_TOPIC',
  ]) {
    if (environment[key])
      throw new Error(`Website suite mode does not support ${key}`);
  }
}

/** Deployed checks keep browser coverage without building local runtimes. */
export function createDeployedWebsitePlaywrightConfig(
  environment: Environment = process.env
) {
  assertFullSuiteMode(environment);
  const value = environment['BASE_URL'];
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error('deployed-e2e requires an HTTPS BASE_URL origin');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('deployed-e2e requires an HTTPS BASE_URL origin');
  }
  return createWebsitePlaywrightConfig(environment);
}

/** Retain server commands and policies while selecting only owned runtimes. */
export function createWebsiteSuitePlaywrightConfig(
  suite: WebsiteSuite,
  environment: Environment = process.env
) {
  assertFullSuiteMode(environment);
  if (environment['BASE_URL'])
    throw new Error('local Website suites do not support BASE_URL');
  const config = createWebsitePlaywrightConfig(environment);
  const frontends = suiteFrontends(suite);
  const ports = new Set(frontends.map((f) => String(f.port)));
  const angular = getCockpitFrontends().filter((f) => f.frontend === 'angular');
  for (const frontend of frontends) {
    const counterpart = angular.find(
      (f) => f.product === frontend.product && f.topic === frontend.topic
    );
    if (counterpart) ports.add(String(counterpart.port));
  }
  // Cross-product journeys exercise the original Angular examples and custom
  // fixture too. Preview groups keep only their existing Angular counterparts.
  if (suite === 'control-plane') {
    for (const port of [
      4300, 4321, 4320, 4322, 4323, 4326, 4325, 4506, 4406, 4399,
    ])
      ports.add(String(port));
  }
  const servers = Array.isArray(config.webServer) ? config.webServer : [];
  const selected = servers.filter(
    (server, index) => index === 0 || ports.has(new URL(server.url ?? '').port)
  );
  const startup = suite === 'control-plane' && environment['WEBSITE_ANGULAR_STARTUP'];
  if (startup && (startup !== '2' || !environment['CI'])) {
    throw new Error('Website Angular startup requires CI and concurrency 2');
  }
  const agentsStartup = suite === 'agents' && environment['WEBSITE_AGENTS_STARTUP'];
  if (agentsStartup && (agentsStartup !== '2' || !environment['CI'])) {
    throw new Error('Website Agents startup requires CI and concurrency 2');
  }
  return defineConfig({
    ...config,
    testMatch:
      suite === 'control-plane'
        ? undefined
        : frontends.map((f) => `**/${previewSpec(f)}`),
    testIgnore: [
      ...(Array.isArray(config.testIgnore) ? config.testIgnore : []),
      ...(suite === 'control-plane' ? ['**/react-*-preview.spec.ts'] : []),
      ...(suite === 'control-plane' && environment['WEBSITE_E2E_DEPLOYED_OWNER'] === 'true'
        ? deployedSurfaceSpecs.map(file => `**/${file}`)
        : []),
    ],
    webServer: startup ? poolAngularServers(selected) : agentsStartup ? poolAgentServers(selected) : selected,
  });
}
