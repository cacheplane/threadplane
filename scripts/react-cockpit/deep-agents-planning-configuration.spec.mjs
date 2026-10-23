import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { reactCockpitConfiguration } from './configuration.mjs';
test('Planning has a closed native React selection and fixture dispatch precedes generic fallback', () => {
  assert.deepEqual(reactCockpitConfiguration('deep-agents-planning'), {
    topic: 'planning',
    library: 'deep-agents',
    adapter: 'langgraph',
    appPath: 'cockpit/deep-agents/planning/react',
    base: '/deep-agents/planning/react/',
    port: 4628,
    project: 'cockpit-deep-agents-planning-react',
  });
  assert.throws(() => reactCockpitConfiguration('deep-agents/../../foreign'));
  const serve = readFileSync(new URL('./serve.mjs', import.meta.url), 'utf8');
  assert.ok(
    serve.indexOf('await deepAgentsPlanningFixture(request') <
      serve.indexOf("if (pathname === '/__reset')")
  );
});
