import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reactCockpitConfiguration } from './configuration.mjs';
test('closed native Subagents selection', () => {
  const c = reactCockpitConfiguration('deep-agents-subagents');
  assert.equal(c.library, 'deep-agents');
  assert.equal(c.topic, 'subagents');
  assert.equal(c.port, 4630);
  assert.equal(c.base, '/deep-agents/subagents/react/');
  assert.equal(c.project, 'cockpit-deep-agents-subagents-react');
  assert.ok(Object.isFrozen(c));
  assert.throws(() => reactCockpitConfiguration('../subagents'));
});
import { readFileSync } from 'node:fs';
test('native fixture participates in awaited serve shutdown', () => {
  const source = readFileSync(new URL('./serve.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(deepAgentsSubagentsFixture \|\|/);
  assert.match(source, /await \(deepAgentsSubagentsFixture \?\?/);
});
