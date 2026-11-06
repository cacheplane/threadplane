import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cockpitManifest } from '@threadplane/cockpit-registry';
import {
  buildNavigationTree,
  getCapabilityPresentation,
  getWorkspacePresentation,
  resolveCockpitEntry,
} from './workspace-presentation';
import {
  capabilityModules,
  resolveDocsWorkspace,
} from '@threadplane/cockpit-registry';

describe('resolveCockpitEntry', () => {
  it('resolves exact entries from shared manifest metadata', () => {
    expect(
      resolveCockpitEntry({
        manifest: cockpitManifest,
        product: 'langgraph',
        section: 'core-capabilities',
        topic: 'streaming',
        page: 'overview',
        language: 'python',
      })
    ).toMatchObject({
      product: 'langgraph',
      topic: 'streaming',
      language: 'python',
    });
  });

  it('falls back to the product getting-started overview when the requested language has no equivalent', () => {
    expect(
      resolveCockpitEntry({
        manifest: cockpitManifest,
        product: 'langgraph',
        section: 'core-capabilities',
        topic: 'streaming',
        page: 'overview',
        language: 'typescript',
      })
    ).toMatchObject({
      product: 'langgraph',
      section: 'getting-started',
      topic: 'overview',
      language: 'python',
    });
  });
});

describe('buildNavigationTree', () => {
  it('groups manifest entries by product and section', () => {
    const tree = buildNavigationTree(cockpitManifest);

    expect(tree.map((product) => product.product)).toEqual([
      'deep-agents',
      'langgraph',
      'ag-ui',
      'render',
      'chat',
      'runtimes',
    ]);
  });

  it('lists every runtimes topic under core-capabilities', () => {
    const runtimes = buildNavigationTree(cockpitManifest).find(
      (product) => product.product === 'runtimes'
    );
    const coreCapabilities = runtimes?.sections.find(
      (section) => section.section === 'core-capabilities'
    );

    expect(coreCapabilities?.entries.map((entry) => entry.topic)).toEqual([
      'microsoft-agent-framework',
      'aws-strands',
      'mastra',
    ]);
  });
});

describe('runtimes capability presentation', () => {
  const resolveRuntime = (
    topic: string,
    language: 'python' | 'typescript' = 'python'
  ) =>
    resolveCockpitEntry({
      manifest: cockpitManifest,
      product: 'runtimes',
      section: 'core-capabilities',
      topic,
      page: 'overview',
      language,
    });

  it('resolves each runtime topic instead of throwing', () => {
    for (const topic of [
      'microsoft-agent-framework',
      'aws-strands',
      'mastra',
    ]) {
      expect(resolveRuntime(topic)).toMatchObject({
        product: 'runtimes',
        topic,
        entryKind: 'capability',
      });
    }
  });

  it('serves Python-lane runtimes from their registered module assets', () => {
    const presentation = getCapabilityPresentation(
      resolveRuntime('aws-strands')
    );

    expect(presentation.kind).toBe('capability');
    if (presentation.kind !== 'capability') return;
    expect(presentation.runtimeUrl).toBe('runtimes/aws-strands');
    expect(presentation.backendAssetPaths).toContain(
      'cockpit/runtimes/aws-strands/python/src/agent.py'
    );
  });

  it('falls back to the Angular-lane module for a runtime with no Python lane', () => {
    const presentation = getCapabilityPresentation(resolveRuntime('mastra'));

    expect(presentation.kind).toBe('capability');
    if (presentation.kind !== 'capability') return;
    // The manifest entry's language is 'python' (the canonical URL lane) but
    // Mastra's only descriptor is the Angular one — the lookup must still find
    // it rather than falling through to non-existent cockpit/runtimes/mastra/python paths.
    expect(presentation.codeAssetPaths).toContain(
      'cockpit/runtimes/mastra/angular/src/app/mastra.component.ts'
    );
    expect(presentation.promptAssetPaths).toEqual([
      'cockpit/runtimes/mastra/angular/prompts/mastra-backend.md',
      'cockpit/runtimes/mastra/angular/prompts/mastra.md',
    ]);
    // Backend assets deliberately point outside cockpit/: the topic's
    // backend is the Node hosting service, not a cockpit/ Python lane.
    expect(presentation.backendAssetPaths).toEqual([
      'deployments/ag-ui-mastra/agents.mjs',
      'deployments/ag-ui-mastra/server.mjs',
    ]);
    expect(presentation.runtimeUrl).toBe('runtimes/mastra');
    expect(presentation.devPort).toBe(4332);

    // Every declared asset must exist on disk — the content bundle renders
    // "File not found" instead of failing, so a typo here is silent in CI.
    // Same workspace-root discovery as content-bundle.ts: walk up from CWD
    // until nx.json (vitest may run from the app dir or the workspace root).
    let workspaceRoot = process.cwd();
    while (!existsSync(join(workspaceRoot, 'nx.json'))) {
      const parent = join(workspaceRoot, '..');
      if (parent === workspaceRoot) break;
      workspaceRoot = parent;
    }
    for (const path of [
      ...presentation.promptAssetPaths,
      ...presentation.codeAssetPaths,
      ...presentation.backendAssetPaths,
    ]) {
      expect(
        existsSync(join(workspaceRoot, path)),
        `missing asset: ${path}`
      ).toBe(true);
    }
  });
});

describe('getCapabilityPresentation', () => {
  it('distinguishes docs-only entries from capability entries', () => {
    const docsEntry = resolveCockpitEntry({
      manifest: cockpitManifest,
      product: 'deep-agents',
      section: 'getting-started',
      topic: 'overview',
      page: 'overview',
      language: 'python',
    });
    const capabilityEntry = resolveCockpitEntry({
      manifest: cockpitManifest,
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'streaming',
      page: 'overview',
      language: 'python',
    });

    expect(getCapabilityPresentation(docsEntry)).toMatchObject({
      kind: 'docs-only',
      docsPath: '/docs/angular/deep-agents/getting-started/introduction',
    });
    expect(getCapabilityPresentation(capabilityEntry)).toMatchObject({
      kind: 'capability',
      docsPath: '/docs/angular/langgraph/guides/streaming',
      promptAssetPaths: [
        'cockpit/langgraph/streaming/python/prompts/streaming.md',
      ],
      codeAssetPaths: [
        'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts',
        'cockpit/langgraph/streaming/angular/src/app/app.config.ts',
      ],
    });
  });

  it('includes backendAssetPaths from the capability module', () => {
    const entry = resolveCockpitEntry({
      manifest: cockpitManifest,
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'streaming',
      page: 'overview',
      language: 'python',
    });
    const presentation = getCapabilityPresentation(entry);

    expect(presentation).toMatchObject({
      kind: 'capability',
      backendAssetPaths: ['cockpit/langgraph/streaming/python/src/graph.py'],
    });
  });

  it('includes runtimeUrl and devPort from the capability module', () => {
    const entry = resolveCockpitEntry({
      manifest: cockpitManifest,
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'streaming',
      page: 'overview',
      language: 'python',
    });
    const presentation = getCapabilityPresentation(entry);

    expect(presentation).toMatchObject({
      kind: 'capability',
      runtimeUrl: 'langgraph/streaming',
      devPort: 4300,
    });
  });

  it('resolves the durable execution docs path from the capability module', () => {
    const entry = resolveCockpitEntry({
      manifest: cockpitManifest,
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'durable-execution',
      page: 'overview',
      language: 'python',
    });
    const presentation = getCapabilityPresentation(entry);

    expect(presentation).toMatchObject({
      kind: 'capability',
      docsPath: '/docs/angular/langgraph/guides/durable-execution',
    });
  });

  it('presents render capabilities with module-backed metadata', () => {
    const entry = resolveCockpitEntry({
      manifest: cockpitManifest,
      product: 'render',
      section: 'core-capabilities',
      topic: 'spec-rendering',
      page: 'overview',
      language: 'python',
    });
    const presentation = getCapabilityPresentation(entry);

    expect(presentation).toMatchObject({
      kind: 'capability',
      docsPath: '/docs/angular/render/guides/specs',
    });
  });

  it('presents chat capabilities with module-backed metadata', () => {
    const entry = resolveCockpitEntry({
      manifest: cockpitManifest,
      product: 'chat',
      section: 'core-capabilities',
      topic: 'messages',
      page: 'overview',
      language: 'python',
    });
    const presentation = getCapabilityPresentation(entry);

    expect(presentation).toMatchObject({
      kind: 'capability',
      docsPath: '/docs/angular/chat/concepts/message-model',
    });
  });

  it('resolves module-backed metadata for every implemented capability topic', () => {
    const capabilityEntries = cockpitManifest.filter(
      (entry) => entry.entryKind === 'capability'
    );

    for (const entry of capabilityEntries) {
      const presentation = getCapabilityPresentation(entry);
      const descriptor =
        capabilityModules.find(
          (candidate) =>
            candidate.manifestIdentity.product === entry.product &&
            candidate.manifestIdentity.section === entry.section &&
            candidate.manifestIdentity.topic === entry.topic &&
            candidate.manifestIdentity.page === entry.page &&
            candidate.manifestIdentity.language === entry.language
        ) ??
        capabilityModules.find(
          (candidate) =>
            candidate.manifestIdentity.product === entry.product &&
            candidate.manifestIdentity.section === entry.section &&
            candidate.manifestIdentity.topic === entry.topic &&
            candidate.manifestIdentity.page === entry.page
        );

      expect(descriptor, entry.id).toBeDefined();
      expect(presentation).toMatchObject({
        kind: 'capability',
        docsPath: descriptor?.docsPath,
        promptAssetPaths: descriptor?.promptAssetPaths,
        codeAssetPaths: descriptor?.codeAssetPaths,
        backendAssetPaths: descriptor?.backendAssetPaths ?? [],
        runtimeUrl: descriptor?.runtimeUrl,
        devPort: descriptor?.devPort,
      });
    }
  });

  it('returns JSON-serializable mutable asset clones without exposing frozen registry arrays', () => {
    const entry = resolveCockpitEntry({
      manifest: cockpitManifest,
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'streaming',
      page: 'overview',
      language: 'python',
    });
    const descriptor = capabilityModules.find(
      (candidate) => candidate.manifestIdentity.topic === 'streaming'
    );
    const first = getCapabilityPresentation(entry);

    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.kind).toBe('capability');
    if (first.kind !== 'capability' || !descriptor) return;

    expect(first.codeAssetPaths).not.toBe(descriptor.codeAssetPaths);
    expect(Object.isFrozen(first.codeAssetPaths)).toBe(false);
    first.codeAssetPaths.push('consumer-local.ts');

    const second = getCapabilityPresentation(entry);
    expect(second.kind === 'capability' && second.codeAssetPaths).not.toContain(
      'consumer-local.ts'
    );
    expect(descriptor.codeAssetPaths).not.toContain('consumer-local.ts');
  });

  it('deep-clones equivalent page identities from the registry manifest', () => {
    const entry = cockpitManifest.find((candidate) =>
      Object.values(candidate.equivalentPages).some(Boolean)
    );
    expect(entry).toBeDefined();
    if (!entry) return;
    const equivalent = Object.entries(entry.equivalentPages).find(
      (candidate): candidate is [string, NonNullable<(typeof candidate)[1]>] =>
        Boolean(candidate[1])
    );
    expect(equivalent).toBeDefined();
    if (!equivalent) return;
    const [language, registryIdentity] = equivalent;
    const presentation = getCapabilityPresentation(entry);
    const presentationIdentity =
      presentation.entry.equivalentPages[
        language as keyof typeof presentation.entry.equivalentPages
      ];
    expect(presentationIdentity).toBeDefined();
    if (!presentationIdentity) return;

    presentationIdentity.topic = 'consumer-local-mutation';

    expect(registryIdentity.topic).not.toBe('consumer-local-mutation');
    expect(
      entry.equivalentPages[language as keyof typeof entry.equivalentPages]
        ?.topic
    ).toBe(registryIdentity.topic);
  });
});

describe('library boundary', () => {
  it('contains no production imports from Website or Cockpit applications', () => {
    const libDirectory = new URL('./', import.meta.url);
    const productionSources = readdirSync(libDirectory)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .map((file) => new URL(file, libDirectory));
    productionSources.push(new URL('../index.ts', import.meta.url));

    for (const sourceFile of productionSources) {
      expect(readFileSync(sourceFile, 'utf8'), sourceFile.pathname).not.toMatch(
        /(?:from\s+|import\()['"][^'"]*(?:apps\/(?:website|cockpit)|@website|@cockpit|@\/)/
      );
    }
  });
});

describe('getWorkspacePresentation', () => {
  it('shapes an unmapped Docs resolution as serializable, non-runnable content', () => {
    const resolution = resolveDocsWorkspace(
      '/docs/angular/langgraph/api/inject-agent',
      'Inject an agent into Angular'
    );

    const presentation = getWorkspacePresentation(resolution);

    expect(presentation).toEqual({
      kind: 'docs-only',
      docsPath: '/docs/angular/langgraph/api/inject-agent',
      title: 'Inject an agent into Angular',
      runnable: false,
    });
    expect(JSON.parse(JSON.stringify(presentation))).toEqual(presentation);
  });

  it('shapes a mapped workspace identity with registry-owned descriptor assets', () => {
    const resolution = resolveDocsWorkspace(
      '/docs/angular/langgraph/guides/streaming',
      'Streaming'
    );
    expect(resolution).not.toBeNull();
    if (!resolution) return;

    const presentation = getWorkspacePresentation(resolution);
    const descriptor = capabilityModules.find(
      (candidate) => candidate.manifestIdentity.topic === 'streaming'
    );

    expect(presentation).toMatchObject({
      kind: 'capability',
      identity: resolution.kind === 'mapped' ? resolution.identity : undefined,
      promptAssetPaths: descriptor?.promptAssetPaths,
      codeAssetPaths: descriptor?.codeAssetPaths,
      backendAssetPaths: descriptor?.backendAssetPaths,
      runtimeUrl: descriptor?.runtimeUrl,
      devPort: descriptor?.devPort,
      runnable: true,
    });
    expect(JSON.parse(JSON.stringify(presentation))).toEqual(presentation);
  });
});
