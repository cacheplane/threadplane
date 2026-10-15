import { describe, expect, it } from 'vitest';
import {
  capabilityModules,
  getCapabilityDescriptor,
  getFrontendCapabilityDescriptor,
  type RegisteredCapabilityModule,
} from './content-descriptors';
import type { CockpitManifestIdentity } from './manifest.types';
import { capabilities, getCockpitFrontends } from './capability-registry';

it('registers bounded native MAF React with canonical Python backend and exact authored assets', () => {
  const identity = { product: 'runtimes', section: 'core-capabilities', topic: 'microsoft-agent-framework', page: 'overview', language: 'python' } as const;
  const canonical = getCapabilityDescriptor(identity);
  const react = getFrontendCapabilityDescriptor(identity, 'react');
  expect(canonical?.id).toBe('runtimes-microsoft-agent-framework-python');
  expect(capabilities.filter(entry => entry.id === 'rt-maf')).toHaveLength(1);
  expect(getCockpitFrontends().find(entry => entry.project === 'cockpit-runtimes-microsoft-agent-framework-react')).toMatchObject({ port: 4642, runtimePath: 'runtimes/microsoft-agent-framework/react', buildOutput: 'dist/cockpit/runtimes/microsoft-agent-framework/react' });
  expect(react).toMatchObject({ runtimeAdapter: 'ag-ui', runtimeUrl: 'runtimes/microsoft-agent-framework/react', devPort: 4642, backendAssetPaths: canonical?.backendAssetPaths, promptAssetPaths: canonical?.promptAssetPaths });
  expect(react?.codeAssetPaths).toEqual([
    ...['app.tsx', 'application.ts', 'approval-policy.ts', 'expense-projection.ts', 'connection.ts', 'main.tsx', 'styles.css'].map(file => `cockpit/runtimes/microsoft-agent-framework/react/src/${file}`),
    'cockpit/runtimes/microsoft-agent-framework/react/project.json',
    ...(canonical?.promptAssetPaths ?? []),
  ]);
  expect(react?.codeAssetPaths.join(' ')).not.toMatch(/fixture|\.spec\.|type-test|model|probe|helper/);
});

it('registers bounded native Strands React with canonical Python backend and exact authored assets', () => {
  const identity = { product: 'runtimes', section: 'core-capabilities', topic: 'aws-strands', page: 'overview', language: 'python' } as const;
  const canonical = getCapabilityDescriptor(identity);
  const react = getFrontendCapabilityDescriptor(identity, 'react');
  expect(canonical?.id).toBe('runtimes-aws-strands-python');
  expect(capabilities.filter(entry => entry.id === 'rt-strands')).toHaveLength(1);
  expect(getCockpitFrontends().find(entry => entry.project === 'cockpit-runtimes-aws-strands-react')).toMatchObject({ port: 4643, runtimePath: 'runtimes/aws-strands/react', buildOutput: 'dist/cockpit/runtimes/aws-strands/react' });
  expect(react).toMatchObject({ runtimeAdapter: 'ag-ui', runtimeUrl: 'runtimes/aws-strands/react', devPort: 4643, backendAssetPaths: canonical?.backendAssetPaths, promptAssetPaths: canonical?.promptAssetPaths });
  expect(react?.codeAssetPaths).toEqual([
    ...['app.tsx', 'application.ts', 'approval-policy.ts', 'schedule-projection.ts', 'connection.ts', 'main.tsx', 'styles.css'].map(file => `cockpit/runtimes/aws-strands/react/src/${file}`),
    'cockpit/runtimes/aws-strands/react/project.json',
    ...(canonical?.promptAssetPaths ?? []),
  ]);
  expect(canonical?.backendAssetPaths).toContain('cockpit/runtimes/aws-strands/python/src/subagent_emitter.py');
  expect(react?.codeAssetPaths.join(' ')).not.toMatch(/fixture|\.spec\.|type-test|model|probe|helper/);
});

it('registers native Mastra React with canonical backend ownership and authored Code assets', () => {
  const identity = { product: 'runtimes', section: 'core-capabilities', topic: 'mastra', page: 'overview', language: 'angular' } as const;
  const canonical = getCapabilityDescriptor(identity);
  const react = getFrontendCapabilityDescriptor(identity, 'react');
  expect(getCockpitFrontends().find(entry => entry.project === 'cockpit-runtimes-mastra-react')).toMatchObject({ port: 4641, runtimePath: 'runtimes/mastra/react', buildOutput: 'dist/cockpit/runtimes/mastra/react' });
  expect(react).toMatchObject({ runtimeAdapter: 'ag-ui', runtimeUrl: 'runtimes/mastra/react', devPort: 4641, backendAssetPaths: canonical?.backendAssetPaths, promptAssetPaths: canonical?.promptAssetPaths });
  expect(react?.codeAssetPaths).toContain('cockpit/runtimes/mastra/react/src/approval-policy.ts');
  expect(react?.codeAssetPaths.join(' ')).not.toMatch(/fixture|\.spec\.|type-test|model|probe/);
});

it('keeps Subagents as one canonical backend with Angular default and two exact frontend deployments', () => {
  const subagents = capabilities.filter(entry => entry.product === 'deep-agents' && entry.topic === 'subagents');
  expect(subagents).toHaveLength(1);
  expect(subagents[0]).toMatchObject({ angularProject: 'cockpit-deep-agents-subagents-angular', pythonDir: 'cockpit/deep-agents/subagents/python', graphName: 'subagents', pythonPort: 5312 });
  const frontends = getCockpitFrontends();
  expect(frontends.filter(entry => entry.frontend === 'angular').map(entry => entry.project)).toEqual(capabilities.map(entry => entry.angularProject));
  expect(frontends.filter(entry => entry.frontend === 'react').map(entry => entry.project)).toEqual(capabilities.flatMap(entry => entry.react ? [entry.react.project] : []));
  expect(frontends.filter(entry => entry.product === 'deep-agents' && entry.topic === 'subagents')).toEqual([
    { frontend: 'angular', project: 'cockpit-deep-agents-subagents-angular', port: 4312, product: 'deep-agents', topic: 'subagents', runtimePath: 'deep-agents/subagents', buildOutput: 'dist/cockpit/deep-agents/subagents/angular' },
    { frontend: 'react', project: 'cockpit-deep-agents-subagents-react', port: 4630, product: 'deep-agents', topic: 'subagents', runtimePath: 'deep-agents/subagents/react', buildOutput: 'dist/cockpit/deep-agents/subagents/react' },
  ]);
});

it('keeps Planning as one canonical backend with Angular default and two exact frontend deployments', () => {
  const planning = capabilities.filter(entry => entry.product === 'deep-agents' && entry.topic === 'planning');
  expect(planning).toHaveLength(1);
  expect(planning[0]).toMatchObject({ angularProject: 'cockpit-deep-agents-planning-angular', pythonDir: 'cockpit/deep-agents/planning/python', graphName: 'da-planning' });
  const frontends = getCockpitFrontends();
  expect(frontends.filter(entry => entry.frontend === 'angular').map(entry => entry.project)).toEqual(capabilities.map(entry => entry.angularProject));
  expect(frontends.filter(entry => entry.frontend === 'react').map(entry => entry.project)).toEqual(capabilities.flatMap(entry => entry.react ? [entry.react.project] : []));
  expect(frontends.filter(entry => entry.product === 'deep-agents' && entry.topic === 'planning')).toEqual([
    { frontend: 'angular', project: 'cockpit-deep-agents-planning-angular', port: 4310, product: 'deep-agents', topic: 'planning', runtimePath: 'deep-agents/planning', buildOutput: 'dist/cockpit/deep-agents/planning/angular' },
    { frontend: 'react', project: 'cockpit-deep-agents-planning-react', port: 4628, product: 'deep-agents', topic: 'planning', runtimePath: 'deep-agents/planning/react', buildOutput: 'dist/cockpit/deep-agents/planning/react' },
  ]);
});

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
    expect(getFrontendCapabilityDescriptor({ ...identity, topic: 'testing' }, 'react')).toBeUndefined();
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
