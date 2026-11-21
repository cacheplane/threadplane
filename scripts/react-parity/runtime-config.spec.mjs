import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadConfigFromFile } from 'vite';

// The backend packages have one test target. It runs every spec of the package
// in plain Node: no Angular test bed, no jsdom, no workspace path plugin.
for (const project of ['langgraph', 'ag-ui']) {
  test(`${project} tests load an isolated Node config without Angular setup or plugins`, async () => {
    const config = JSON.parse(await readFile(`libs/${project}/project.json`, 'utf8'));
    const target = config.targets.test;
    assert.equal(target.executor, '@nx/vitest:test');
    assert.equal(target.options.configFile, `libs/${project}/vite.runtime.config.mts`);
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, target.options.configFile);
    assert.ok(loaded, 'test config must load');
    assert.equal(loaded.config.test.environment, 'node');
    assert.deepEqual(loaded.config.test.include, ['src/runtime/**/*.spec.ts']);
    assert.deepEqual(loaded.config.test.setupFiles ?? [], []);
    assert.deepEqual(loaded.config.plugins ?? [], []);
    assert.equal(loaded.config.test.passWithNoTests, false);
    assert.ok(!loaded.dependencies.some((path) => /(?:test-setup\.[cm]?[jt]s|vite\.config\.mts)$/.test(path)), 'must not inherit an Angular config or test setup');
  });

  test(`${project} keeps the runtime target names as aliases of its only test and type-test targets`, async () => {
    const { targets } = JSON.parse(await readFile(`libs/${project}/project.json`, 'utf8'));
    assert.deepEqual(targets['runtime-quality'], { executor: 'nx:noop', dependsOn: ['test'] });
    assert.deepEqual(targets['runtime-type-tests'], { executor: 'nx:noop', dependsOn: ['type-tests'] });
    assert.match(targets['type-tests'].options.command, new RegExp(`tsc --project libs/${project}/tsconfig\\.runtime-tests\\.json`));
  });

  test(`${project} is built as a neutral library, with no Angular packaging or test setup left`, async () => {
    const { targets } = JSON.parse(await readFile(`libs/${project}/project.json`, 'utf8'));
    assert.equal(targets.build.executor, '@nx/js:tsc');
    assert.equal(targets.build.options.main, `libs/${project}/src/public-api.ts`);
    for (const retired of ['ng-package.json', 'vite.config.mts', 'tsconfig.lib.prod.json', 'src/test-setup.ts', 'src/lib'])
      assert.equal(existsSync(`libs/${project}/${retired}`), false, retired);
  });
}
