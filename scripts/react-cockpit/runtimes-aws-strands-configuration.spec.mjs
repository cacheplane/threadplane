import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { reactCockpitConfiguration } from './configuration.mjs';
test('selects only the explicit native AWS Strands React entry', () => {
  const entry = reactCockpitConfiguration('runtimes-aws-strands');
  assert.deepEqual(entry, {
    topic: 'aws-strands',
    library: 'runtimes',
    adapter: 'ag-ui',
    appPath: 'cockpit/runtimes/aws-strands/react',
    base: '/runtimes/aws-strands/react/',
    port: 4643,
    project: 'cockpit-runtimes-aws-strands-react',
  });
  assert.ok(Object.isFrozen(entry));
  assert.equal(
    reactCockpitConfiguration().appPath,
    'cockpit/langgraph/streaming/react'
  );
  assert.equal(reactCockpitConfiguration('runtimes-mastra').port, 4641);
  for (const key of [
    'aws-strands',
    'strands',
    '../runtimes-aws-strands',
    'runtimes-aws-strands/../other',
    'runtimes-aws-strands-extra',
  ])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported/);
});
test('uses the installed native build with explicit uncached preparation and browser targets', () => {
  const project = JSON.parse(
    readFileSync(
      new URL(
        '../../cockpit/runtimes/aws-strands/react/project.json',
        import.meta.url
      )
    )
  );
  assert.equal(
    project.targets.build.options.command,
    'node scripts/react-cockpit/build.mjs runtimes-aws-strands'
  );
  assert.deepEqual(project.targets.build.dependsOn.filter(edge => edge.target === 'build'), [
    { target: 'build', projects: ['core', 'content', 'react'] },
  ]);
  assert.deepEqual(project.targets.build.outputs, [
    '{workspaceRoot}/dist/cockpit/runtimes/aws-strands/react',
  ]);
  assert.equal(project.targets.e2e.executor, '@nx/playwright:playwright');
  assert.equal(project.targets.e2e.cache, false);
  assert.deepEqual(project.targets.e2e.dependsOn, ['prepare-fixture', 'build']);
  assert.equal(
    project.targets.e2e.options.config,
    'cockpit/runtimes/aws-strands/react/e2e/playwright.config.ts'
  );
  assert.equal(project.targets['prepare-fixture'].cache, false);
  assert.equal(
    project.targets['prepare-fixture'].options.command,
    'node scripts/react-cockpit/prepare-native-strands-fixture.mjs'
  );
});
