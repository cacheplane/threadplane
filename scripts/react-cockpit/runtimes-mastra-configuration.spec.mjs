import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { reactCockpitConfiguration } from './configuration.mjs';
test('explicit native Mastra entry preserves other authored defaults and rejects path selection', () => {
  const entry = reactCockpitConfiguration('runtimes-mastra');
  assert.deepEqual(entry, {
    topic: 'mastra',
    library: 'runtimes',
    adapter: 'ag-ui',
    appPath: 'cockpit/runtimes/mastra/react',
    base: '/runtimes/mastra/react/',
    port: 4641,
    project: 'cockpit-runtimes-mastra-react',
  });
  assert.ok(Object.isFrozen(entry));
  assert.equal(
    reactCockpitConfiguration().appPath,
    'cockpit/langgraph/streaming/react'
  );
  assert.equal(
    reactCockpitConfiguration('ag-ui-interrupts').base,
    '/ag-ui/interrupts/react/'
  );
  for (const key of [
    'mastra',
    'runtimes-mastra/../other',
    'runtimes-mastra-extra',
  ])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported/);
});
test('Nx uses the isolated installed native build with required package dependencies', () => {
  const project = JSON.parse(
    readFileSync(
      new URL(
        '../../cockpit/runtimes/mastra/react/project.json',
        import.meta.url
      )
    )
  );
  assert.equal(
    project.targets.build.options.command,
    'node scripts/react-cockpit/build.mjs runtimes-mastra'
  );
  assert.deepEqual(project.targets.build.dependsOn.filter(edge => edge.target === 'build'), [
    { target: 'build', projects: ['core', 'content', 'react'] },
  ]);
  assert.deepEqual(project.targets.build.outputs, [
    '{workspaceRoot}/dist/cockpit/runtimes/mastra/react',
  ]);
});
