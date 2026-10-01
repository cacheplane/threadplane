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

describe('registered React streaming pilot', () => {
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
    expect(frontends).toHaveLength(42);
    expect(new Set(frontends.map((entry) => entry.runtimePath)).size).toBe(42);
    expect(new Set(frontends.map((entry) => entry.project)).size).toBe(42);
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
