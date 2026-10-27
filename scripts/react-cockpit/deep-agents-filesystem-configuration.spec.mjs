import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { reactCockpitConfiguration } from './configuration.mjs';
test('Filesystem has a closed native React selection and fixture dispatch precedes generic fallback', () => {
  assert.deepEqual(reactCockpitConfiguration('deep-agents-filesystem'), {
    topic: 'filesystem',
    library: 'deep-agents',
    adapter: 'langgraph',
    appPath: 'cockpit/deep-agents/filesystem/react',
    base: '/deep-agents/filesystem/react/',
    port: 4629,
    project: 'cockpit-deep-agents-filesystem-react',
  });
  assert.throws(() => reactCockpitConfiguration('deep-agents/../../foreign'));
  const serve = readFileSync(new URL('./serve.mjs', import.meta.url), 'utf8');
  assert.ok(
    serve.indexOf('await deepAgentsFilesystemFixture(request') <
      serve.indexOf("if (pathname === '/__reset')")
  );
});
