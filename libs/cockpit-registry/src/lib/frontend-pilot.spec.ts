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

describe('registered React public previews', () => {
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
        { ...streaming, topic: 'persistence' },
        'react'
      )
    ).toBeUndefined();
  });

  it('enumerates deployable frontend identities with distinct paths and projects', () => {
    const frontends = getCockpitFrontends();
    expect(frontends).toHaveLength(44);
    expect(new Set(frontends.map((entry) => entry.runtimePath)).size).toBe(44);
    expect(new Set(frontends.map((entry) => entry.project)).size).toBe(44);
    expect(new Set(frontends.map((entry) => entry.port)).size).toBe(44);
    expect(new Set(frontends.map((entry) => entry.buildOutput)).size).toBe(44);
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
