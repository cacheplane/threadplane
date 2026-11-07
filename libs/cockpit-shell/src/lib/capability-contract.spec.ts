import { describe, expect, it } from 'vitest';
import {
  COCKPIT_SHELL_ENTRY_KINDS,
  COCKPIT_SHELL_RUNTIME_CLASSES,
  isCockpitShellCapabilityEntry,
  type CockpitShellCapabilityEntry,
  type CockpitShellDocsOnlyEntry,
} from './capability-contract';

describe('cockpit shell capability contract', () => {
  it('keeps docs-only entries on the shared identity and metadata contract without runtime hooks', () => {
    const entry: CockpitShellDocsOnlyEntry = {
      capabilityId: 'overview',
      product: 'deep-agents',
      section: 'getting-started',
      topic: 'overview',
      page: 'overview',
      language: 'python',
      title: 'Deep Agents Overview',
      summary: 'Entry point for the Deep Agents docs-only surface.',
      officialDocsId: 'deep-agents/getting-started/overview',
      docsPath: '/docs/angular/deep-agents/overview',
      entryKind: COCKPIT_SHELL_ENTRY_KINDS.docsOnly,
    };

    expect(entry).toMatchObject({
      capabilityId: 'overview',
      product: 'deep-agents',
      section: 'getting-started',
      topic: 'overview',
      page: 'overview',
      language: 'python',
      title: 'Deep Agents Overview',
      summary: 'Entry point for the Deep Agents docs-only surface.',
      officialDocsId: 'deep-agents/getting-started/overview',
      docsPath: '/docs/angular/deep-agents/overview',
    });
    expect('runtimeMetadata' in entry).toBe(false);
    expect('mount' in entry).toBe(false);
  });

  it('requires runtime metadata and hooks for capability entries', () => {
    const entry: CockpitShellCapabilityEntry = {
      capabilityId: 'planning',
      product: 'deep-agents',
      section: 'core-capabilities',
      topic: 'planning',
      page: 'overview',
      language: 'python',
      title: 'Planning',
      summary: 'Entry point for the planning capability.',
      officialDocsId: 'deep-agents/core-capabilities/planning',
      docsPath: '/docs/angular/deep-agents/planning',
      entryKind: COCKPIT_SHELL_ENTRY_KINDS.capability,
      runtimeMetadata: {
        runtimeClass: COCKPIT_SHELL_RUNTIME_CLASSES.localService,
        mountPath: '/cockpit/deep-agents/planning',
        codeAssetPaths: ['libs/deep-agents/planning/src/index.ts'],
        promptAssetPaths: ['libs/deep-agents/planning/prompts/system.md'],
      },
      mount: () => undefined,
      smokeTest: () => undefined,
      integrationTest: () => undefined,
    };

    expect(entry.runtimeMetadata).toMatchObject({
      runtimeClass: COCKPIT_SHELL_RUNTIME_CLASSES.localService,
      mountPath: '/cockpit/deep-agents/planning',
      codeAssetPaths: ['libs/deep-agents/planning/src/index.ts'],
      promptAssetPaths: ['libs/deep-agents/planning/prompts/system.md'],
    });
    expect(isCockpitShellCapabilityEntry(entry)).toBe(true);
  });

  it('discriminates docs-only entries from capability entries by kind', () => {
    const docsOnlyEntry: CockpitShellDocsOnlyEntry = {
      capabilityId: 'overview',
      product: 'langgraph',
      section: 'getting-started',
      topic: 'overview',
      page: 'overview',
      language: 'python',
      title: 'LangGraph Overview',
      summary: 'Entry point for the LangGraph docs-only surface.',
      officialDocsId: 'langgraph/getting-started/overview',
      docsPath: '/docs/angular/langgraph/overview',
      entryKind: COCKPIT_SHELL_ENTRY_KINDS.docsOnly,
    };

    const capabilityEntry: CockpitShellCapabilityEntry = {
      capabilityId: 'streaming',
      product: 'langgraph',
      section: 'core-capabilities',
      topic: 'streaming',
      page: 'overview',
      language: 'python',
      title: 'Streaming',
      summary: 'Entry point for the streaming capability.',
      officialDocsId: 'langgraph/core-capabilities/streaming',
      docsPath: '/docs/angular/langgraph/streaming',
      entryKind: COCKPIT_SHELL_ENTRY_KINDS.capability,
      runtimeMetadata: {
        runtimeClass: COCKPIT_SHELL_RUNTIME_CLASSES.browser,
        mountPath: '/cockpit/langgraph/streaming',
        codeAssetPaths: [],
        promptAssetPaths: [],
      },
      mount: () => undefined,
      smokeTest: () => undefined,
      integrationTest: () => undefined,
    };

    expect(isCockpitShellCapabilityEntry(docsOnlyEntry)).toBe(false);
    expect(isCockpitShellCapabilityEntry(capabilityEntry)).toBe(true);
  });
});
