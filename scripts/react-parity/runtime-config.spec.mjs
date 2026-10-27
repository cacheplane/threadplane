import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadConfigFromFile } from 'vite';

test('runtime-quality loads an isolated Node config without Angular setup or plugins', async () => {
  const project = JSON.parse(await readFile('libs/langgraph/project.json', 'utf8'));
  const target = project.targets['runtime-quality'];
  assert.equal(target.executor, '@nx/vitest:test');
  assert.equal(target.options.configFile, 'libs/langgraph/vite.runtime.config.mts');
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, target.options.configFile);
  assert.ok(loaded, 'runtime config must load');
  assert.equal(loaded.config.test.environment, 'node');
  assert.deepEqual(loaded.config.test.include, ['src/runtime/**/*.spec.ts']);
  assert.deepEqual(loaded.config.test.setupFiles ?? [], []);
  assert.deepEqual(loaded.config.plugins ?? [], []);
  assert.equal(loaded.config.test.passWithNoTests, false);
  assert.ok(!loaded.dependencies.some((path) => /(?:test-setup\.[cm]?[jt]s|vite\.config\.mts)$/.test(path)), 'must not inherit the Angular config or test setup');
});
