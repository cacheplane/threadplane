import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { reactCockpitConfiguration } from './configuration.mjs';
test('selects only the explicit native Microsoft Agent Framework React entry', () => {
  const entry = reactCockpitConfiguration('runtimes-microsoft-agent-framework');
  assert.deepEqual(entry, {
    topic: 'microsoft-agent-framework',
    library: 'runtimes',
    adapter: 'ag-ui',
    appPath: 'cockpit/runtimes/microsoft-agent-framework/react',
    base: '/runtimes/microsoft-agent-framework/react/',
    port: 4642,
    project: 'cockpit-runtimes-microsoft-agent-framework-react',
  });
  assert.ok(Object.isFrozen(entry));
  assert.equal(
    reactCockpitConfiguration().appPath,
    'cockpit/langgraph/streaming/react'
  );
  assert.equal(reactCockpitConfiguration('runtimes-mastra').port, 4641);
  for (const key of [
    'microsoft-agent-framework',
    'maf',
    '../runtimes-microsoft-agent-framework',
    'runtimes-microsoft-agent-framework/../other',
    'runtimes-microsoft-agent-framework-extra',
  ])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported/);
});
test('uses the installed native build with explicit uncached preparation and browser targets', () => {
  const project = JSON.parse(
    readFileSync(
      new URL(
        '../../cockpit/runtimes/microsoft-agent-framework/react/project.json',
        import.meta.url
      )
    )
  );
  assert.equal(
    project.targets.build.options.command,
    'node scripts/react-cockpit/build.mjs runtimes-microsoft-agent-framework'
  );
  assert.deepEqual(project.targets.build.dependsOn.filter(edge => edge.target === 'build'), [
    { target: 'build', projects: ['core', 'content', 'react'] },
  ]);
  assert.deepEqual(project.targets.build.outputs, [
    '{workspaceRoot}/dist/cockpit/runtimes/microsoft-agent-framework/react',
  ]);
  assert.equal(project.targets.e2e.executor, '@nx/playwright:playwright');
  assert.equal(project.targets.e2e.cache, false);
  assert.deepEqual(project.targets.e2e.dependsOn, ['prepare-fixture', 'build']);
  assert.equal(project.targets.e2e.options.config, 'cockpit/runtimes/microsoft-agent-framework/react/e2e/playwright.config.ts');
  assert.equal(project.targets['prepare-fixture'].cache, false);
  assert.equal(project.targets['prepare-fixture'].options.command, 'node scripts/react-cockpit/prepare-native-maf-fixture.mjs');
});
