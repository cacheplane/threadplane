/* eslint-disable @nx/enforce-module-boundaries -- Test-only drift coverage compares registry-owned descriptors with legacy leaf exports. */
import { langgraphStreamingPythonModule } from '../../../../cockpit/langgraph/streaming/python/src/index';
import { langgraphPersistencePythonModule } from '../../../../cockpit/langgraph/persistence/python/src/index';
import { langgraphInterruptsPythonModule } from '../../../../cockpit/langgraph/interrupts/python/src/index';
import { langgraphMemoryPythonModule } from '../../../../cockpit/langgraph/memory/python/src/index';
import { langgraphDurableExecutionPythonModule } from '../../../../cockpit/langgraph/durable-execution/python/src/index';
import { langgraphSubgraphsPythonModule } from '../../../../cockpit/langgraph/subgraphs/python/src/index';
import { langgraphTimeTravelPythonModule } from '../../../../cockpit/langgraph/time-travel/python/src/index';
import { langgraphDeploymentRuntimePythonModule } from '../../../../cockpit/langgraph/deployment-runtime/python/src/index';
import { langgraphClientToolsPythonModule } from '../../../../cockpit/langgraph/client-tools/python/src/index';
import { agUiInterruptsPythonModule } from '../../../../cockpit/ag-ui/interrupts/python/src/index';
import { agUiStreamingPythonModule } from '../../../../cockpit/ag-ui/streaming/python/src/index';
import { agUiToolViewsPythonModule } from '../../../../cockpit/ag-ui/tool-views/python/src/index';
import { agUiJsonRenderPythonModule } from '../../../../cockpit/ag-ui/json-render/python/src/index';
import { agUiClientToolsPythonModule } from '../../../../cockpit/ag-ui/client-tools/python/src/index';
import { agUiA2uiPythonModule } from '../../../../cockpit/ag-ui/a2ui/python/src/index';
import { agUiSubagentsPythonModule } from '../../../../cockpit/ag-ui/subagents/python/src/index';
import { deepAgentsMemoryPythonModule } from '../../../../cockpit/deep-agents/memory/python/src/index';
import { deepAgentsPlanningPythonModule } from '../../../../cockpit/deep-agents/planning/python/src/index';
import { deepAgentsFilesystemPythonModule } from '../../../../cockpit/deep-agents/filesystem/python/src/index';
import { deepAgentsSubagentsPythonModule } from '../../../../cockpit/deep-agents/subagents/python/src/index';
import { deepAgentsSkillsPythonModule } from '../../../../cockpit/deep-agents/skills/python/src/index';
import { renderSpecRenderingPythonModule } from '../../../../cockpit/render/spec-rendering/python/src/index';
import { renderElementRenderingPythonModule } from '../../../../cockpit/render/element-rendering/python/src/index';
import { renderStateManagementPythonModule } from '../../../../cockpit/render/state-management/python/src/index';
import { renderRegistryPythonModule } from '../../../../cockpit/render/registry/python/src/index';
import { renderRepeatLoopsPythonModule } from '../../../../cockpit/render/repeat-loops/python/src/index';
import { renderComputedFunctionsPythonModule } from '../../../../cockpit/render/computed-functions/python/src/index';
import { chatMessagesPythonModule } from '../../../../cockpit/chat/messages/python/src/index';
import { chatInputPythonModule } from '../../../../cockpit/chat/input/python/src/index';
import { chatInterruptsPythonModule } from '../../../../cockpit/chat/interrupts/python/src/index';
import { chatToolCallsPythonModule } from '../../../../cockpit/chat/tool-calls/python/src/index';
import { chatSubagentsPythonModule } from '../../../../cockpit/chat/subagents/python/src/index';
import { chatThreadsPythonModule } from '../../../../cockpit/chat/threads/python/src/index';
import { chatTimelinePythonModule } from '../../../../cockpit/chat/timeline/python/src/index';
import { chatGenerativeUiPythonModule } from '../../../../cockpit/chat/generative-ui/python/src/index';
import { chatDebugPythonModule } from '../../../../cockpit/chat/debug/python/src/index';
import { chatThemingPythonModule } from '../../../../cockpit/chat/theming/python/src/index';
import { chatA2uiPythonModule } from '../../../../cockpit/chat/a2ui/python/src/index';
import { runtimesMicrosoftAgentFrameworkPythonModule } from '../../../../cockpit/runtimes/microsoft-agent-framework/python/src/index';
import { runtimesAwsStrandsPythonModule } from '../../../../cockpit/runtimes/aws-strands/python/src/index';
import { runtimesMastraAngularModule } from '../../../../cockpit/runtimes/mastra/angular/src/index';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { capabilityModules, getFrontendCapabilityDescriptor } from './content-descriptors';
import { cockpitManifest } from './manifest';
it('keeps native Chat Subagents attached to the original backend descriptor assets', () => {
  const canonical=capabilityModules.find(entry=>entry.id==='chat-subagents-python');
  if (!canonical) throw new Error('Missing canonical Chat Subagents');
  const react=getFrontendCapabilityDescriptor(canonical.manifestIdentity as never,'react');
  expect(react?.backendAssetPaths).toEqual(chatSubagentsPythonModule.backendAssetPaths);
  expect(react?.promptAssetPaths).toEqual(chatSubagentsPythonModule.promptAssetPaths);
  expect(react?.manifestIdentity).toEqual(canonical.manifestIdentity);
  expect(Object.isFrozen(react)).toBe(true);
});
it('keeps native Chat Tool Calls attached to the original backend descriptor assets', () => {
  const canonical=capabilityModules.find(entry=>entry.id==='chat-tool-calls-python');
  if (!canonical) throw new Error('Missing canonical Chat Tool Calls');
  const react=getFrontendCapabilityDescriptor(canonical.manifestIdentity as never,'react');
  expect(react?.backendAssetPaths).toEqual(chatToolCallsPythonModule.backendAssetPaths);
  expect(react?.promptAssetPaths).toEqual(chatToolCallsPythonModule.promptAssetPaths);
  expect(react?.manifestIdentity).toEqual(canonical.manifestIdentity);
  expect(Object.isFrozen(react)).toBe(true);
});
it('keeps native Chat Interrupts attached to the original backend descriptor assets', () => {
  const canonical=capabilityModules.find(entry=>entry.id==='chat-interrupts-python');
  if (!canonical) throw new Error('Missing canonical Chat Interrupts');
  const react=getFrontendCapabilityDescriptor(canonical.manifestIdentity as never,'react');
  expect(react?.backendAssetPaths).toEqual(chatInterruptsPythonModule.backendAssetPaths);
  expect(react?.promptAssetPaths).toEqual(chatInterruptsPythonModule.promptAssetPaths);
  expect(react?.manifestIdentity).toEqual(canonical.manifestIdentity);
  expect(Object.isFrozen(react)).toBe(true);
});
it('keeps native Chat Input attached to the original backend descriptor assets', () => {
  const canonical=capabilityModules.find(entry=>entry.id==='chat-input-python');
  if (!canonical) throw new Error('Missing canonical Chat Input');
  const react=getFrontendCapabilityDescriptor(canonical.manifestIdentity as never,'react');
  expect(react?.backendAssetPaths).toEqual(chatInputPythonModule.backendAssetPaths);
  expect(react?.promptAssetPaths).toEqual(chatInputPythonModule.promptAssetPaths);
  expect(react?.manifestIdentity).toEqual(canonical.manifestIdentity);
  expect(Object.isFrozen(react)).toBe(true);
});
it('keeps native Chat Messages attached to the original backend descriptor assets', () => {
  const canonical=capabilityModules.find(entry=>entry.id==='chat-messages-python');
  if (!canonical) throw new Error('Missing canonical Chat Messages');
  const react=getFrontendCapabilityDescriptor(canonical.manifestIdentity as never,'react');
  expect(react?.backendAssetPaths).toEqual(chatMessagesPythonModule.backendAssetPaths);
  expect(react?.promptAssetPaths).toEqual(chatMessagesPythonModule.promptAssetPaths);
  expect(react?.manifestIdentity).toEqual(canonical.manifestIdentity);
  expect(Object.isFrozen(react)).toBe(true);
});

const EXPECTED_DESCRIPTOR_IDS = [
  'langgraph-streaming-python',
  'langgraph-persistence-python',
  'langgraph-interrupts-python',
  'langgraph-memory-python',
  'langgraph-durable-execution-python',
  'langgraph-subgraphs-python',
  'langgraph-time-travel-python',
  'langgraph-deployment-runtime-python',
  'langgraph-client-tools-python',
  'ag-ui-interrupts-python',
  'ag-ui-streaming-python',
  'ag-ui-tool-views-python',
  'ag-ui-json-render-python',
  'ag-ui-client-tools-python',
  'ag-ui-a2ui-python',
  'ag-ui-subagents-python',
  'deep-agents-memory-python',
  'deep-agents-planning-python',
  'deep-agents-filesystem-python',
  'deep-agents-subagents-python',
  'deep-agents-skills-python',
  'render-spec-rendering-python',
  'render-element-rendering-python',
  'render-state-management-python',
  'render-registry-python',
  'render-repeat-loops-python',
  'render-computed-functions-python',
  'chat-messages-python',
  'chat-input-python',
  'chat-interrupts-python',
  'chat-tool-calls-python',
  'chat-subagents-python',
  'chat-threads-python',
  'chat-timeline-python',
  'chat-generative-ui-python',
  'chat-debug-python',
  'chat-theming-python',
  'chat-a2ui-python',
  'runtimes-microsoft-agent-framework-python',
  'runtimes-aws-strands-python',
  'runtimes-mastra-angular',
] as const;

const legacyCapabilityModules = [
  langgraphStreamingPythonModule,
  langgraphPersistencePythonModule,
  langgraphInterruptsPythonModule,
  langgraphMemoryPythonModule,
  langgraphDurableExecutionPythonModule,
  langgraphSubgraphsPythonModule,
  langgraphTimeTravelPythonModule,
  langgraphDeploymentRuntimePythonModule,
  langgraphClientToolsPythonModule,
  agUiInterruptsPythonModule,
  agUiStreamingPythonModule,
  agUiToolViewsPythonModule,
  agUiJsonRenderPythonModule,
  agUiClientToolsPythonModule,
  agUiA2uiPythonModule,
  agUiSubagentsPythonModule,
  deepAgentsMemoryPythonModule,
  deepAgentsPlanningPythonModule,
  deepAgentsFilesystemPythonModule,
  deepAgentsSubagentsPythonModule,
  deepAgentsSkillsPythonModule,
  renderSpecRenderingPythonModule,
  renderElementRenderingPythonModule,
  renderStateManagementPythonModule,
  renderRegistryPythonModule,
  renderRepeatLoopsPythonModule,
  renderComputedFunctionsPythonModule,
  chatMessagesPythonModule,
  chatInputPythonModule,
  chatInterruptsPythonModule,
  chatToolCallsPythonModule,
  chatSubagentsPythonModule,
  chatThreadsPythonModule,
  chatTimelinePythonModule,
  chatGenerativeUiPythonModule,
  chatDebugPythonModule,
  chatThemingPythonModule,
  chatA2uiPythonModule,
  runtimesMicrosoftAgentFrameworkPythonModule,
  runtimesAwsStrandsPythonModule,
  runtimesMastraAngularModule,
];

describe('registry content descriptors', () => {
  it('has no production imports from Cockpit applications or leaf projects', () => {
    const source = readFileSync(
      new URL('./content-descriptors.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toMatch(
      /(?:import|export)[\s\S]*?from\s+['"][^'"]*(?:cockpit|apps)\//
    );
  });

  it('owns exactly the serializable capability descriptors consumed by Cockpit', () => {
    expect(capabilityModules.map((descriptor) => descriptor.id)).toEqual(
      EXPECTED_DESCRIPTOR_IDS
    );
    expect(JSON.parse(JSON.stringify(capabilityModules))).toEqual(
      capabilityModules
    );
  });

  it('retains the legacy leaf descriptor fields exactly', () => {
    const withoutRuntimeAdapter = capabilityModules.map((descriptor) =>
      Object.fromEntries(
        Object.entries(descriptor).filter(
          ([field]) => field !== 'runtimeAdapter'
        )
      )
    );

    expect(withoutRuntimeAdapter).toEqual(legacyCapabilityModules);
  });

  it('exposes deeply frozen descriptors that cannot mutate registry state', () => {
    expect(Object.isFrozen(capabilityModules)).toBe(true);

    for (const descriptor of capabilityModules) {
      expect(Object.isFrozen(descriptor), descriptor.id).toBe(true);
      expect(Object.isFrozen(descriptor.manifestIdentity), descriptor.id).toBe(
        true
      );
      for (const assetPaths of [
        descriptor.promptAssetPaths,
        descriptor.codeAssetPaths,
        descriptor.backendAssetPaths,
      ]) {
        if (assetPaths) {
          expect(Object.isFrozen(assetPaths), descriptor.id).toBe(true);
        }
      }
    }

    const first = capabilityModules[0];
    expect(() => {
      (capabilityModules as unknown as (typeof first)[]).push(first);
    }).toThrow(TypeError);
    expect(() => {
      (first as unknown as { title: string }).title = 'Mutated';
    }).toThrow(TypeError);
    expect(() => {
      (first.manifestIdentity as unknown as { topic: string }).topic =
        'mutated';
    }).toThrow(TypeError);
    expect(() => {
      (first.promptAssetPaths as unknown as string[]).push('mutated');
    }).toThrow(TypeError);
  });

  it('references only workspace assets that exist', () => {
    const workspaceRoot = new URL('../../../../', import.meta.url);

    for (const descriptor of capabilityModules) {
      for (const assetPath of [
        ...descriptor.promptAssetPaths,
        ...descriptor.codeAssetPaths,
        ...(descriptor.backendAssetPaths ?? []),
      ]) {
        expect(
          existsSync(new URL(assetPath, workspaceRoot)),
          `${descriptor.id}: missing ${assetPath}`
        ).toBe(true);
      }
    }
  });

  it('classifies overview entries as having no runtime adapter', () => {
    const overviews = cockpitManifest.filter(
      (entry) => entry.section === 'getting-started'
    );

    expect(overviews).not.toHaveLength(0);
    expect(overviews.every((entry) => entry.runtimeAdapter === 'none')).toBe(
      true
    );
  });

  it('classifies all 41 application descriptors explicitly without product heuristics', () => {
    const adapters = capabilityModules.map(
      (descriptor) => descriptor.runtimeAdapter
    );
    const manifestSource = readFileSync(
      new URL('./manifest.ts', import.meta.url),
      'utf8'
    );

    expect(adapters).toHaveLength(41);
    expect(adapters.filter((adapter) => adapter === 'langgraph')).toHaveLength(
      25
    );
    expect(adapters.filter((adapter) => adapter === 'ag-ui')).toHaveLength(10);
    expect(adapters.filter((adapter) => adapter === 'none')).toHaveLength(6);
    expect(adapters).not.toContain(undefined);
    expect(manifestSource).not.toContain('getRuntimeAdapter');
  });

  it('keeps the six Render applications static and runnable', () => {
    const renderDescriptors = capabilityModules.filter(
      (descriptor) => descriptor.manifestIdentity.product === 'render'
    );
    const renderEntries = cockpitManifest.filter(
      (entry) => entry.product === 'render' && entry.entryKind === 'capability'
    );

    expect(renderDescriptors).toHaveLength(6);
    expect(
      renderDescriptors.every(
        (descriptor) => descriptor.runtimeAdapter === 'none'
      )
    ).toBe(true);
    expect(renderEntries).toHaveLength(6);
    expect(
      renderEntries.every(
        (entry) =>
          entry.runtimeAdapter === 'none' &&
          entry.availableModes.includes('Run')
      )
    ).toBe(true);
  });

  it('derives available modes from canonical and descriptor-backed content', () => {
    for (const entry of cockpitManifest) {
      const descriptor = capabilityModules.find(
        (candidate) =>
          candidate.manifestIdentity.product === entry.product &&
          candidate.manifestIdentity.section === entry.section &&
          candidate.manifestIdentity.topic === entry.topic &&
          candidate.manifestIdentity.page === entry.page
      );
      const apiAssets = [
        ...(descriptor?.codeAssetPaths ?? []),
        ...(descriptor?.backendAssetPaths ?? []),
      ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|py)$/.test(path));

      expect(entry.availableModes.includes('Run')).toBe(
        Boolean(descriptor?.runtimeUrl || descriptor?.devPort)
      );
      expect(entry.availableModes.includes('Code')).toBe(
        Boolean(
          descriptor &&
            (descriptor.codeAssetPaths.length > 0 ||
              (descriptor.backendAssetPaths?.length ?? 0) > 0)
        )
      );
      expect(entry.availableModes.includes('API')).toBe(apiAssets.length > 0);
      expect(entry.availableModes.includes('Docs')).toBe(
        entry.docsPath.length > 0
      );
    }
  });
});
