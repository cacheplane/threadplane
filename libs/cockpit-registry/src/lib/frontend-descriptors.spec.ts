import { describe, expect, it } from 'vitest';
import {
  capabilityModules,
  getCapabilityDescriptor,
  getFrontendCapabilityDescriptor,
  type RegisteredCapabilityModule,
} from './content-descriptors';
import type { CockpitManifestIdentity } from './manifest.types';

const identity: CockpitManifestIdentity = {
  product: 'langgraph',
  section: 'core-capabilities',
  topic: 'streaming',
  page: 'overview',
  language: 'python',
};
const angular = getCapabilityDescriptor(identity);
if (!angular) throw new Error('Streaming Angular descriptor is missing');
const react: RegisteredCapabilityModule = Object.freeze({
  ...angular,
  id: 'react-streaming-fixture',
  frontend: 'react',
  codeAssetPaths: Object.freeze(['fixture/streaming.tsx']),
  runtimeUrl: 'fixture/streaming/react',
});
const descriptors = Object.freeze([angular, react]);

describe('frontend capability resolution', () => {
  it('preserves every legacy Angular descriptor and default lookup', () => {
    for (const descriptor of capabilityModules) {
      const scope = descriptor.manifestIdentity as CockpitManifestIdentity;
      expect(getFrontendCapabilityDescriptor(scope, 'angular')).toBe(
        getCapabilityDescriptor(scope)
      );
      expect(descriptor.frontend).toBeUndefined();
    }
  });

  it('selects React code and runtime together without changing language', () => {
    expect(
      getFrontendCapabilityDescriptor(identity, 'react', descriptors)
    ).toBe(react);
    expect(
      getFrontendCapabilityDescriptor(identity, 'angular', descriptors)
    ).toBe(angular);
    expect(identity.language).toBe('python');
  });

  it('never falls back to Angular for an unsupported React capability', () => {
    expect(getFrontendCapabilityDescriptor({ ...identity, topic: 'durable-execution' }, 'react')).toBeUndefined();
    expect(
      getFrontendCapabilityDescriptor(identity, 'react', [angular])
    ).toBeUndefined();
  });

  it('prefers exact language within the selected frontend', () => {
    const typescript: RegisteredCapabilityModule = {
      ...react,
      id: 'react-typescript-fixture',
      manifestIdentity: { ...react.manifestIdentity, language: 'typescript' },
    };
    expect(
      getFrontendCapabilityDescriptor(
        { ...identity, language: 'typescript' },
        'react',
        [react, angular, typescript]
      )
    ).toBe(typescript);
  });

  it('uses language fallback only within the selected frontend', () => {
    const exactAngular: RegisteredCapabilityModule = {
      ...angular,
      manifestIdentity: { ...angular.manifestIdentity, language: 'typescript' },
    };
    expect(
      getFrontendCapabilityDescriptor(
        { ...identity, language: 'typescript' },
        'react',
        [exactAngular, react]
      )
    ).toBe(react);
  });

  it.each([
    { product: 'chat' as const },
    { section: 'getting-started' as const },
    { topic: 'durable-execution' },
    { page: 'code' as const },
  ])(
    'does not borrow a React descriptor from another capability: %j',
    (other) => {
      expect(
        getFrontendCapabilityDescriptor(
          { ...identity, ...other },
          'react',
          descriptors
        )
      ).toBeUndefined();
    }
  );

  it('returns the original immutable descriptor without altering inputs', () => {
    const before = JSON.stringify(descriptors);
    expect(
      getFrontendCapabilityDescriptor(identity, 'react', descriptors)
    ).toBe(react);
    expect(JSON.stringify(descriptors)).toBe(before);
    expect(Object.isFrozen(react.codeAssetPaths)).toBe(true);
  });
});
