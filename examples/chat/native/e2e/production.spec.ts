import { test } from './fixtures';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

test('one selected production artifact and separate actual view lifecycle entry', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const { readVerification } = await import('../tooling/verify.mjs');
  const { preparationEnvironment, selectedFramework } = await import(
    '../tooling/commands.mjs'
  );
  const framework = selectedFramework(testInfo.project.metadata.framework);
  const root = resolve(__dirname, '../../../../');
  const requested = testInfo.outputPath('retained');
  mkdirSync(dirname(requested), { recursive: true });
  const directory = join(realpathSync(dirname(requested)), 'retained');
  // The actual CLI owns the build, installed owner tests, browser proofs and
  // sealed evidence. CI must not repeat it after this E2E target.
  execFileSync(process.execPath, [
    join(root, 'examples/chat/native/tooling/verify.mjs'),
    `--framework=${framework}`,
    '--retain',
    directory,
  ], {
    cwd: root,
    env: preparationEnvironment(),
    stdio: 'inherit',
    // Synchronous children cannot be interrupted by Playwright's timer.
    timeout: testInfo.timeout - 10_000,
  });
  const verified = readVerification(directory);
  assert.equal(verified.framework, framework);
  writeFileSync(
    testInfo.outputPath('browser-results.json'),
    JSON.stringify(verified.results.browser, null, 2) + '\n'
  );
});
