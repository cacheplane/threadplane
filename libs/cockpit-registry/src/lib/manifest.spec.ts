import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cockpitManifest } from './manifest';
import { getCockpitDocsPath, NO_COCKPIT_DOCS_LINK } from './docs-links';
import type { CockpitManifestEntry } from './manifest.types';

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const expectedTopics = {
  'deep-agents': [
    ['getting-started', 'overview'],
    ['core-capabilities', 'planning'],
    ['core-capabilities', 'filesystem'],
    ['core-capabilities', 'subagents'],
    ['core-capabilities', 'memory'],
    ['core-capabilities', 'skills'],
  ],
  langgraph: [
    ['getting-started', 'overview'],
    ['core-capabilities', 'persistence'],
    ['core-capabilities', 'durable-execution'],
    ['core-capabilities', 'streaming'],
    ['core-capabilities', 'interrupts'],
    ['core-capabilities', 'memory'],
    ['core-capabilities', 'subgraphs'],
    ['core-capabilities', 'time-travel'],
    ['core-capabilities', 'deployment-runtime'],
  ],
  'ag-ui': [
    ['getting-started', 'overview'],
    ['core-capabilities', 'streaming'],
    ['core-capabilities', 'interrupts'],
    ['core-capabilities', 'tool-views'],
    ['core-capabilities', 'json-render'],
    ['core-capabilities', 'a2ui'],
  ],
  render: [
    ['getting-started', 'overview'],
    ['core-capabilities', 'spec-rendering'],
    ['core-capabilities', 'element-rendering'],
    ['core-capabilities', 'state-management'],
    ['core-capabilities', 'registry'],
    ['core-capabilities', 'repeat-loops'],
    ['core-capabilities', 'computed-functions'],
  ],
  chat: [
    ['getting-started', 'overview'],
    ['core-capabilities', 'messages'],
    ['core-capabilities', 'input'],
    ['core-capabilities', 'interrupts'],
    ['core-capabilities', 'tool-calls'],
    ['core-capabilities', 'subagents'],
    ['core-capabilities', 'threads'],
    ['core-capabilities', 'timeline'],
    ['core-capabilities', 'generative-ui'],
    ['core-capabilities', 'debug'],
    ['core-capabilities', 'theming'],
    ['core-capabilities', 'a2ui'],
  ],
} as const;

describe('cockpitManifest', () => {
  it('uses the canonical registry identity and metadata contract', () => {
    const entry: CockpitManifestEntry = cockpitManifest[0];

    expect(entry).toMatchObject({
      product: 'deep-agents',
      section: 'getting-started',
      topic: 'overview',
      page: 'overview',
      language: 'python',
      entryKind: 'docs-only',
      runtimeClass: 'docs-only',
      canonicalLanguage: 'python',
    });
  });

  it('contains the approved initial inventory as python overview entries', () => {
    const identities = cockpitManifest.map(
      ({ product, section, topic, page, language }) =>
        `${product}/${section}/${topic}/${page}/${language}`
    );

    for (const [product, topics] of Object.entries(expectedTopics)) {
      for (const [section, topic] of topics) {
        expect(identities).toContain(`${product}/${section}/${topic}/overview/python`);
      }
    }
  });

  it('marks only getting-started overview entries as docs-only in the initial inventory', () => {
    const docsOnlyEntries = cockpitManifest
      .filter((entry) => entry.entryKind === 'docs-only')
      .map(({ product, section, topic }) => `${product}/${section}/${topic}`);

    expect(docsOnlyEntries).toEqual([
      'deep-agents/getting-started/overview',
      'langgraph/getting-started/overview',
      'ag-ui/getting-started/overview',
      'render/getting-started/overview',
      'chat/getting-started/overview',
      'runtimes/getting-started/overview',
    ]);
  });

  it('tracks implemented python assets for every approved capability topic', () => {
    const capabilityEntries = cockpitManifest.filter(
      (entry) => entry.entryKind === 'capability'
    );

    expect(capabilityEntries).toHaveLength(41);

    for (const entry of capabilityEntries) {
      expect(entry.supportedLanguages).toEqual(['python']);
      // The docs link is a table lookup (see ./docs-links.ts), not a formula
      // derived from the identity. Assert the shape the website actually
      // serves — /docs/<library>/<section>/<slug> — or the "no page yet"
      // sentinel. The exact targets are checked against the website's content
      // tree in apps/cockpit/src/lib/docs-links.spec.ts.
      expect(entry.docsPath).toBe(
        getCockpitDocsPath(entry.product, entry.section, entry.topic)
      );
      if (entry.docsPath !== NO_COCKPIT_DOCS_LINK) {
        expect(entry.docsPath).toMatch(/^\/docs\/angular\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/);
      }
      expect(entry.implementationStatus).toBe('implemented');
      expect(entry.docsStatus).toBe('docs-authored');
      expect(entry.testStatus).toBe('smoke-tested');
      expect(entry.promptAssetPaths.length).toBeGreaterThan(0);
      expect(entry.codeAssetPaths.length).toBeGreaterThan(0);

      for (const assetPath of [...entry.promptAssetPaths, ...entry.codeAssetPaths]) {
        expect(fs.existsSync(resolve(workspaceRoot, assetPath))).toBe(true);
      }
    }
  });

  it('includes AG-UI after langgraph with streaming + interrupts topics', () => {
    const products = cockpitManifest.map((e) => e.product);
    expect(products).toContain('ag-ui');
    expect(products.indexOf('ag-ui')).toBeGreaterThan(products.indexOf('langgraph'));
    const aguiTopics = cockpitManifest.filter((e) => e.product === 'ag-ui').map((e) => e.topic);
    expect(aguiTopics).toEqual(expect.arrayContaining(['streaming', 'interrupts']));
  });

  it('does not advertise placeholder integration coverage for deployment runtime', () => {
    const deploymentRuntimeEntry = cockpitManifest.find(
      (entry) =>
        entry.product === 'langgraph' &&
        entry.section === 'core-capabilities' &&
        entry.topic === 'deployment-runtime'
    );

    expect(deploymentRuntimeEntry).toMatchObject({
      runtimeClass: 'deployed-service',
      testingContract: {
        smokeTarget: 'cockpit-langgraph-deployment-runtime-python:smoke',
        integrationTarget: null,
        integrationMode: 'none',
        deploySmokePath:
          '/langgraph/core-capabilities/deployment-runtime/overview/python',
      },
    });
  });
});
