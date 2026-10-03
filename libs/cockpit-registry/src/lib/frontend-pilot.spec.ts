import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import {
  getFrontendCapabilityDescriptor,
  capabilityModules,
} from './content-descriptors';
import { getCockpitFrontends } from './capability-registry';
import type { CockpitManifestIdentity } from './manifest.types';

const streaming: CockpitManifestIdentity = {
  product: 'langgraph',
  section: 'core-capabilities',
  topic: 'streaming',
  page: 'overview',
  language: 'python',
};

it('resolves local React State Management with host state sources and no Python assets', () => {
  const canonical = capabilityModules.find(entry => entry.id === 'render-state-management-python');
  if (!canonical) throw Error('Missing canonical State Management');
  const react = getFrontendCapabilityDescriptor(canonical.manifestIdentity as CockpitManifestIdentity, 'react');
  expect(react).toMatchObject({ runtimeAdapter: 'none', frontend: 'react', runtimeUrl: 'render/state-management/react', devPort: 4615, promptAssetPaths: [], backendAssetPaths: [] });
  expect(react?.codeAssetPaths).toEqual(['app.tsx','state.ts','playback.ts','projection.ts','specs.ts','views.tsx','main.tsx','styles.css'].map(file => `cockpit/render/state-management/react/src/${file}`));
  expect(getCockpitFrontends().find(entry => entry.project === 'cockpit-render-state-management-react')).toMatchObject({ port: 4615, runtimePath: 'render/state-management/react' });
  expect(getFrontendCapabilityDescriptor(canonical.manifestIdentity as CockpitManifestIdentity, 'angular')).toBe(canonical);
});

it('resolves local React Render Spec without inheriting Python or runtime assets', () => {
  const canonical = capabilityModules.find(entry => entry.id === 'render-spec-rendering-python');
  if (!canonical) throw Error('Missing canonical Render Spec');
  const react = getFrontendCapabilityDescriptor(canonical.manifestIdentity as CockpitManifestIdentity, 'react');
  expect(react).toMatchObject({ runtimeAdapter: 'none', frontend: 'react', runtimeUrl: 'render/spec-rendering/react', devPort: 4614, promptAssetPaths: [], backendAssetPaths: [] });
  expect(react?.codeAssetPaths).toEqual(['app.tsx','playback.ts','projection.ts','specs.ts','views.tsx','main.tsx','styles.css'].map(file => `cockpit/render/spec-rendering/react/src/${file}`));
  expect(getCockpitFrontends().find(entry => entry.project === 'cockpit-render-spec-rendering-react')).toMatchObject({ port: 4614, runtimePath: 'render/spec-rendering/react' });
  expect(getFrontendCapabilityDescriptor(canonical.manifestIdentity as CockpitManifestIdentity, 'angular')).toBe(canonical);
});

describe('registered React public previews', () => {
  it('resolves native trip specialists on the canonical subagents guide with an unchanged Angular default', () => {
    const identity = {
      ...streaming,
      product: 'ag-ui' as const,
      topic: 'subagents',
    };
    const react = getFrontendCapabilityDescriptor(identity, 'react');
    expect(react?.docsPath).toBe('/docs/ag-ui/guides/subagents');
    expect(react?.runtimeAdapter).toBe('ag-ui');
    expect(react?.runtimeUrl).toBe('ag-ui/subagents/react');
    expect(react?.devPort).toBe(4613);
    expect(react?.codeAssetPaths).toEqual(
      [
        'app.tsx',
        'application.ts',
        'children.ts',
        'policy.ts',
        'connection.ts',
        'main.tsx',
      ].map((file) => `cockpit/ag-ui/subagents/react/src/${file}`)
    );
    expect(react?.backendAssetPaths).toEqual(
      [
        'graph.py',
        'server.py',
        'streaming/subagent_emitting_agent.py',
        'streaming/subagent_stream_handler.py',
      ].map((file) => `cockpit/ag-ui/subagents/python/src/${file}`)
    );
    expect(
      getFrontendCapabilityDescriptor(identity, 'angular')?.runtimeUrl
    ).toBe('ag-ui/subagents');
    expect(
      getFrontendCapabilityDescriptor(
        { ...identity, topic: 'testing' },
        'react'
      )
    ).toBeUndefined();
    for (const asset of [
      ...(react?.codeAssetPaths ?? []),
      ...(react?.backendAssetPaths ?? []),
    ])
      expect(existsSync(new URL('../../../../' + asset, import.meta.url))).toBe(
        true
      );
  });
  it('resolves native JSON Render with the authored dashboard catalog and unchanged Angular default', () => {
    const identity={...streaming,product:'ag-ui' as const,topic:'json-render'};
    const react=getFrontendCapabilityDescriptor(identity,'react');
    expect(react?.docsPath).toBe('/docs/ag-ui/guides/json-render');
    expect(react?.runtimeAdapter).toBe('ag-ui');
    expect(react?.runtimeUrl).toBe('ag-ui/json-render/react');
    expect(react?.devPort).toBe(4612);
    expect(react?.codeAssetPaths).toEqual(['app.tsx','application.ts','dashboard-policy.ts','dashboard-data.ts','dashboard-spec.ts','dashboard-views.tsx','connection.ts','main.tsx'].map(file=>`cockpit/ag-ui/json-render/react/src/${file}`));
    expect(react?.backendAssetPaths).toEqual(['graph.py','dashboard_tools.py','server.py'].map(file=>`cockpit/ag-ui/json-render/python/src/${file}`));
    expect(getFrontendCapabilityDescriptor(identity,'angular')?.runtimeUrl).toBe('ag-ui/json-render');
    expect(getFrontendCapabilityDescriptor({...identity,topic:'testing'},'react')).toBeUndefined();
    expect(getCockpitFrontends().filter(frontend=>frontend.frontend==='react')).toHaveLength(16);
    expect(getCockpitFrontends()).toHaveLength(57);
    for(const asset of [...(react?.codeAssetPaths??[]),...(react?.backendAssetPaths??[])])expect(existsSync(new URL('../../../../'+asset,import.meta.url))).toBe(true);
  });
  it('resolves AG-UI Tool Views with authored weather policy and unchanged server-tool endpoint', () => {
    const identity = { ...streaming, product: 'ag-ui' as const, topic: 'tool-views' };
    const react = getFrontendCapabilityDescriptor(identity, 'react');
    expect(react?.docsPath).toBe('/docs/ag-ui/guides/tool-views');
    expect(react?.runtimeAdapter).toBe('ag-ui');
    expect(react?.runtimeUrl).toBe('ag-ui/tool-views/react');
    expect(react?.devPort).toBe(4611);
    expect(react?.codeAssetPaths).toEqual(['app.tsx','application.ts','tool-view-policy.ts','weather-card.tsx','connection.ts','main.tsx'].map(file => `cockpit/ag-ui/tool-views/react/src/${file}`));
    expect(react?.backendAssetPaths).toEqual(['graph.py','server.py'].map(file => `cockpit/ag-ui/tool-views/python/src/${file}`));
    expect(getFrontendCapabilityDescriptor(identity,'angular')?.runtimeUrl).toBe('ag-ui/tool-views');
    expect(getFrontendCapabilityDescriptor({...identity,topic:'testing'},'react')).toBeUndefined();
    for (const asset of [...(react?.codeAssetPaths ?? []),...(react?.backendAssetPaths ?? [])])
      expect(existsSync(new URL('../../../../'+asset,import.meta.url))).toBe(true);
  });
  it('resolves native AG-UI Interrupts on its canonical guide with exact React and native backend sources', () => {
    const identity = { ...streaming, product: 'ag-ui' as const, topic: 'interrupts' };
    const react = getFrontendCapabilityDescriptor(identity, 'react');
    expect(react?.docsPath).toBe('/docs/ag-ui/guides/interrupts');
    expect(react?.runtimeAdapter).toBe('ag-ui');
    expect(react?.runtimeUrl).toBe('ag-ui/interrupts/react');
    expect(react?.devPort).toBe(4610);
    expect(react?.codeAssetPaths).toEqual(['app.tsx', 'application.ts', 'approval-policy.ts', 'connection.ts', 'main.tsx'].map(file => `cockpit/ag-ui/interrupts/react/src/${file}`));
    expect(react?.backendAssetPaths).toEqual(['graph.py', 'native_agent.py', 'server.py'].map(file => `cockpit/ag-ui/interrupts/python/src/${file}`));
    expect(getFrontendCapabilityDescriptor(identity, 'angular')?.runtimeUrl).toBe('ag-ui/interrupts');
    expect(getFrontendCapabilityDescriptor({ ...identity, product: 'langgraph' }, 'react')?.runtimeUrl).toBe('langgraph/interrupts/react');
    const frontends = getCockpitFrontends();
    expect(frontends.filter(frontend => frontend.frontend === 'react')).toHaveLength(16);
    expect(frontends).toHaveLength(57);
    expect(new Set(frontends.map(frontend => frontend.project)).size).toBe(57);
    for (const asset of [...(react?.codeAssetPaths ?? []), ...(react?.backendAssetPaths ?? [])])
      expect(existsSync(new URL('../../../../' + asset, import.meta.url))).toBe(true);
  });
  it('resolves AG-UI Streaming on its existing Event Mapping reference without borrowing LangGraph', () => {
    const identity = { ...streaming, product: 'ag-ui' as const };
    const react = getFrontendCapabilityDescriptor(identity, 'react');
    expect(react?.docsPath).toBe('/docs/ag-ui/reference/event-mapping');
    expect(react?.runtimeAdapter).toBe('ag-ui');
    expect(react?.runtimeUrl).toBe('ag-ui/streaming/react');
    expect(react?.devPort).toBe(4609);
    expect(react?.codeAssetPaths).toEqual(['app.tsx','application.ts','canonical-transcript.ts','connection.ts','main.tsx'].map(file=>`cockpit/ag-ui/streaming/react/src/${file}`));
    expect(react?.backendAssetPaths).toContain('cockpit/ag-ui/streaming/python/src/server.py');
    expect(getFrontendCapabilityDescriptor(identity,'angular')?.runtimeUrl).toBe('ag-ui/streaming');
    expect(getFrontendCapabilityDescriptor(streaming,'react')?.runtimeUrl).toBe('langgraph/streaming/react');
    expect(getCockpitFrontends().filter(x=>x.frontend==='react')).toHaveLength(16);
    expect(getCockpitFrontends()).toHaveLength(57);
  });
  it('maps the canonical Deployment guide to the exact Deployment Runtime React sources', () => {
    const identity = { ...streaming, topic: 'deployment-runtime' };
    const react = getFrontendCapabilityDescriptor(identity, 'react');
    expect(react?.docsPath).toBe('/docs/langgraph/guides/deployment');
    expect(react?.runtimeUrl).toBe('langgraph/deployment-runtime/react');
    expect(react?.devPort).toBe(4608);
    expect(react?.codeAssetPaths).toEqual(
      [
        'app.tsx',
        'application.ts',
        'canonical-history.ts',
        'connection.ts',
        'main.tsx',
      ].map((file) => `cockpit/langgraph/deployment-runtime/react/src/${file}`)
    );
    expect(react?.backendAssetPaths).toContain(
      'cockpit/langgraph/deployment-runtime/python/src/graph.py'
    );
    expect(
      react?.codeAssetPaths.some((path) => path.includes('/angular/'))
    ).toBe(false);
    expect(
      getFrontendCapabilityDescriptor(identity, 'angular')?.runtimeUrl
    ).toBe('langgraph/deployment-runtime');
    expect(
      getCockpitFrontends().filter((frontend) => frontend.frontend === 'react')
    ).toHaveLength(16);
    expect(getCockpitFrontends()).toHaveLength(57);
  });
  it('resolves Time Travel with exact owner, checkpoint eligibility and canonical identity sources', () => {
    const identity = { ...streaming, topic: 'time-travel' };
    const react = getFrontendCapabilityDescriptor(identity, 'react');
    expect(react?.docsPath).toBe('/docs/langgraph/guides/time-travel');
    expect(react?.runtimeUrl).toBe('langgraph/time-travel/react');
    expect(react?.codeAssetPaths).toEqual(
      expect.arrayContaining([
        'cockpit/langgraph/time-travel/react/src/app.tsx',
        'cockpit/langgraph/time-travel/react/src/application.ts',
        'cockpit/langgraph/time-travel/react/src/checkpoint-history.ts',
        'cockpit/langgraph/time-travel/react/src/canonical-history.ts',
        'cockpit/langgraph/time-travel/react/src/connection.ts',
      ])
    );
    expect(react?.backendAssetPaths).toContain(
      'cockpit/langgraph/time-travel/python/src/graph.py'
    );
    expect(
      react?.codeAssetPaths.some((path) => path.includes('/angular/'))
    ).toBe(false);
    expect(
      getFrontendCapabilityDescriptor(identity, 'angular')?.runtimeUrl
    ).toBe('langgraph/time-travel');
  });

  it('resolves subgraphs with the parent owner and actual child graph sources', () => {
    const identity = { ...streaming, topic: 'subgraphs' };
    const react = getFrontendCapabilityDescriptor(identity, 'react');
    expect(react?.docsPath).toBe('/docs/langgraph/guides/subgraphs');
    expect(react?.runtimeUrl).toBe('langgraph/subgraphs/react');
    expect(react?.devPort).toBe(4606);
    expect(react?.codeAssetPaths).toEqual(
      ['app.tsx', 'application.ts', 'connection.ts', 'main.tsx'].map(
        (file) => `cockpit/langgraph/subgraphs/react/src/${file}`
      )
    );
    expect(react?.backendAssetPaths).toEqual([
      'cockpit/langgraph/subgraphs/python/src/graph.py',
    ]);
    expect(react?.promptAssetPaths).toEqual([
      'cockpit/langgraph/subgraphs/python/prompts/subgraphs.md',
    ]);
    for (const asset of [
      ...(react?.codeAssetPaths ?? []),
      ...(react?.backendAssetPaths ?? []),
      ...(react?.promptAssetPaths ?? []),
    ])
      expect(existsSync(new URL('../../../../' + asset, import.meta.url))).toBe(
        true
      );
    expect(
      getFrontendCapabilityDescriptor(identity, 'angular')?.runtimeUrl
    ).toBe('langgraph/subgraphs');
  });
  it('resolves durable execution with explicit checkpoint and final-answer sources', () => {
    const react = getFrontendCapabilityDescriptor(
      { ...streaming, topic: 'durable-execution' },
      'react'
    );
    expect(react?.docsPath).toBe('/docs/langgraph/guides/durable-execution');
    expect(react?.runtimeUrl).toBe('langgraph/durable-execution/react');
    expect(react?.devPort).toBe(4605);
    expect(react?.codeAssetPaths).toEqual(
      ['app.tsx', 'application.ts', 'connection.ts', 'main.tsx'].map(
        (file) => `cockpit/langgraph/durable-execution/react/src/${file}`
      )
    );
    expect(react?.backendAssetPaths).toContain(
      'cockpit/langgraph/durable-execution/python/src/graph.py'
    );
    for (const asset of [
      ...(react?.codeAssetPaths ?? []),
      ...(react?.backendAssetPaths ?? []),
      ...(react?.promptAssetPaths ?? []),
    ])
      expect(existsSync(new URL('../../../../' + asset, import.meta.url))).toBe(
        true
      );
    expect(
      getFrontendCapabilityDescriptor(
        { ...streaming, topic: 'durable-execution' },
        'angular'
      )?.runtimeUrl
    ).toBe('langgraph/durable-execution');
  });
  it('resolves persistence with the page-local picker and shared checkpoint backend', () => {
    const react = getFrontendCapabilityDescriptor(
      { ...streaming, topic: 'persistence' },
      'react'
    );
    expect(react?.docsPath).toBe('/docs/langgraph/guides/persistence');
    expect(react?.runtimeUrl).toBe('langgraph/persistence/react');
    expect(react?.devPort).toBe(4604);
    expect(react?.codeAssetPaths).toEqual(
      ['app.tsx', 'application.ts', 'connection.ts', 'main.tsx'].map(
        (file) => `cockpit/langgraph/persistence/react/src/${file}`
      )
    );
    expect(react?.backendAssetPaths).toContain(
      'cockpit/langgraph/persistence/python/src/graph.py'
    );
    for (const asset of [
      ...(react?.codeAssetPaths ?? []),
      ...(react?.backendAssetPaths ?? []),
      ...(react?.promptAssetPaths ?? []),
    ])
      expect(existsSync(new URL('../../../../' + asset, import.meta.url))).toBe(
        true
      );
    expect(
      getFrontendCapabilityDescriptor(
        { ...streaming, topic: 'persistence' },
        'angular'
      )?.runtimeUrl
    ).toBe('langgraph/persistence');
  });
  it('resolves client tools from the canonical Chat guide with all authored source contracts', () => {
    const react = getFrontendCapabilityDescriptor(
      { ...streaming, topic: 'client-tools' },
      'react'
    );
    expect(react?.docsPath).toBe('/docs/chat/guides/client-tools');
    expect(react?.runtimeUrl).toBe('langgraph/client-tools/react');
    expect(react?.devPort).toBe(4603);
    expect(react?.codeAssetPaths).toEqual(
      [
        'app.tsx',
        'application.ts',
        'tools.ts',
        'connection.ts',
        'main.tsx',
      ].map((file) => `cockpit/langgraph/client-tools/react/src/${file}`)
    );
    expect(react?.backendAssetPaths).toContain(
      'cockpit/langgraph/client-tools/python/src/graph.py'
    );
    for (const asset of [
      ...(react?.codeAssetPaths ?? []),
      ...(react?.backendAssetPaths ?? []),
      ...(react?.promptAssetPaths ?? []),
    ])
      expect(existsSync(new URL('../../../../' + asset, import.meta.url))).toBe(
        true
      );
    expect(
      getFrontendCapabilityDescriptor(
        { ...streaming, topic: 'client-tools' },
        'angular'
      )?.runtimeUrl
    ).toBe('langgraph/client-tools');
  });
  it('resolves memory with literal React sources and the existing Python graph and prompt', () => {
    const react = getFrontendCapabilityDescriptor(
      { ...streaming, topic: 'memory' },
      'react'
    );
    expect(react?.runtimeUrl).toBe('langgraph/memory/react');
    expect(react?.devPort).toBe(4602);
    expect(react?.manifestIdentity).toEqual({ ...streaming, topic: 'memory' });
    expect(react?.codeAssetPaths).toEqual(
      ['app.tsx', 'application.ts', 'connection.ts', 'main.tsx'].map(
        (file) => `cockpit/langgraph/memory/react/src/${file}`
      )
    );
    expect(react?.backendAssetPaths).toEqual([
      'cockpit/langgraph/memory/python/src/graph.py',
    ]);
    expect(react?.promptAssetPaths).toEqual([
      'cockpit/langgraph/memory/python/prompts/memory.md',
    ]);
    for (const asset of [
      ...(react?.codeAssetPaths ?? []),
      ...(react?.backendAssetPaths ?? []),
      ...(react?.promptAssetPaths ?? []),
    ])
      expect(existsSync(new URL('../../../../' + asset, import.meta.url))).toBe(
        true
      );
    expect(
      getFrontendCapabilityDescriptor(
        { ...streaming, topic: 'memory' },
        'angular'
      )?.runtimeUrl
    ).toBe('langgraph/memory');
  });
  it('resolves the interrupts preview with its actual sources and shared Python backend', () => {
    const react = getFrontendCapabilityDescriptor(
      { ...streaming, topic: 'interrupts' },
      'react'
    );
    expect(react?.runtimeUrl).toBe('langgraph/interrupts/react');
    expect(react?.devPort).toBe(4601);
    expect(react?.manifestIdentity).toEqual({
      ...streaming,
      topic: 'interrupts',
    });
    expect(react?.codeAssetPaths).toEqual([
      'cockpit/langgraph/interrupts/react/src/app.tsx',
      'cockpit/langgraph/interrupts/react/src/application.ts',
      'cockpit/langgraph/interrupts/react/src/connection.ts',
      'cockpit/langgraph/interrupts/react/src/main.tsx',
    ]);
    expect(react?.backendAssetPaths).toContain(
      'cockpit/langgraph/interrupts/python/src/graph.py'
    );
    for (const asset of [
      ...(react?.codeAssetPaths ?? []),
      ...(react?.backendAssetPaths ?? []),
    ])
      expect(existsSync(new URL('../../../../' + asset, import.meta.url))).toBe(
        true
      );
    expect(
      react?.codeAssetPaths.some((path) => path.includes('/angular/'))
    ).toBe(false);
    expect(
      getFrontendCapabilityDescriptor(
        { ...streaming, topic: 'interrupts' },
        'angular'
      )?.runtimeUrl
    ).toBe('langgraph/interrupts');
  });
  it('resolves actual React source and runtime without changing the backend language', () => {
    const react = getFrontendCapabilityDescriptor(streaming, 'react');
    expect(react?.runtimeUrl).toBe('langgraph/streaming/react');
    expect(react?.devPort).toBe(4600);
    expect(react?.manifestIdentity.language).toBe('python');
    expect(react?.codeAssetPaths).toContain(
      'cockpit/langgraph/streaming/react/src/app.tsx'
    );
    for (const asset of [
      ...(react?.codeAssetPaths ?? []),
      ...(react?.backendAssetPaths ?? []),
    ]) {
      expect(existsSync(new URL('../../../../' + asset, import.meta.url))).toBe(
        true
      );
    }
    expect(
      react?.codeAssetPaths.some((path) => path.includes('/angular/'))
    ).toBe(false);
  });

  it('keeps legacy Angular descriptors and unsupported React topics honest', () => {
    expect(capabilityModules).toHaveLength(41);
    expect(
      getFrontendCapabilityDescriptor(streaming, 'angular')?.runtimeUrl
    ).toBe('langgraph/streaming');
    expect(
      getFrontendCapabilityDescriptor(
        { ...streaming, topic: 'testing' },
        'react'
      )
    ).toBeUndefined();
  });

  it('enumerates deployable frontend identities with distinct paths and projects', () => {
    const frontends = getCockpitFrontends();
    expect(frontends).toHaveLength(57);
    expect(new Set(frontends.map((entry) => entry.runtimePath)).size).toBe(57);
    expect(new Set(frontends.map((entry) => entry.project)).size).toBe(57);
    expect(new Set(frontends.map((entry) => entry.port)).size).toBe(57);
    expect(new Set(frontends.map((entry) => entry.buildOutput)).size).toBe(57);
    expect(
      frontends.find(
        (entry) => entry.project === 'cockpit-langgraph-memory-react'
      )
    ).toMatchObject({
      frontend: 'react',
      port: 4602,
      runtimePath: 'langgraph/memory/react',
      buildOutput: 'dist/cockpit/langgraph/memory/react',
    });
    expect(
      frontends.find(
        (entry) => entry.project === 'cockpit-langgraph-interrupts-react'
      )
    ).toMatchObject({
      frontend: 'react',
      port: 4601,
      runtimePath: 'langgraph/interrupts/react',
      buildOutput: 'dist/cockpit/langgraph/interrupts/react',
    });
    expect(frontends.find((entry) => entry.frontend === 'react')).toMatchObject(
      {
        project: 'cockpit-langgraph-streaming-react',
        port: 4600,
        runtimePath: 'langgraph/streaming/react',
        buildOutput: 'dist/cockpit/langgraph/streaming/react',
      }
    );
  });
});
