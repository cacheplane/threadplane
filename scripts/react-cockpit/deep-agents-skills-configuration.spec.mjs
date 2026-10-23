import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reactCockpitConfiguration } from './configuration.mjs';

test('Skills has a closed native React selection', () => {
  const configuration = reactCockpitConfiguration('deep-agents-skills');
  assert.deepEqual(configuration, {
    topic: 'skills',
    library: 'deep-agents',
    adapter: 'langgraph',
    appPath: 'cockpit/deep-agents/skills/react',
    base: '/deep-agents/skills/react/',
    port: 4631,
    project: 'cockpit-deep-agents-skills-react',
  });
  assert.ok(Object.isFrozen(configuration));
  assert.throws(() => reactCockpitConfiguration('deep-agents/../../foreign'));
  assert.throws(() =>
    reactCockpitConfiguration('deep-agents-skills/../../foreign')
  );
});

import { readFileSync } from 'node:fs';
test('Skills fixture uses only closed authored selection and awaited shutdown', () => {
  const source = readFileSync(new URL('./serve.mjs', import.meta.url), 'utf8');
  assert.match(
    source,
    /configuration.library === 'deep-agents' && configuration.topic === 'skills' \? createDeepAgentsSkillsFixture\(\)/
  );
  assert.match(
    source,
    /if \((?:\w+Fixture \|\| )*deepAgentsSkillsFixture(?: \|\| \w+Fixture)*\)/
  );
  assert.match(
    source,
    /await \((?:\w+Fixture \?\? )*deepAgentsSkillsFixture(?: \?\? \w+Fixture)*\)\.close\(\)/
  );
});
