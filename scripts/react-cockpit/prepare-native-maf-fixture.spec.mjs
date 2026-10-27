import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import {
  prepareNativeMafFixture,
  preparationLock,
  environment,
  project,
} from './prepare-native-maf-fixture.mjs';
test('fixture-owned modules never import the scripts project', () => {
  for (const file of ['server.mjs', 'server.spec.mjs']) {
    const source = readFileSync(new URL(`../../fixtures/react-parity/native-maf-react/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"][^'"]*scripts\//);
  }
});
test('preparation uses isolated exact frozen Python 3.12 environment and bounded acquisition', () => {
  let invocation;
  prepareNativeMafFixture({
    run: (...args) => {
      invocation = args;
    },
  });
  assert.deepEqual(invocation[1], [
    'sync',
    '--frozen',
    '--python',
    '3.12',
    '--project',
    project,
  ]);
  assert.equal(invocation[2].timeout, 180000);
  assert.equal(invocation[2].env.UV_PROJECT_ENVIRONMENT, environment);
  assert.equal(invocation[2].env.UV_PYTHON, '3.12');
  assert.equal(
    invocation[2].env.THREADPLANE_AG_UI_FIXTURE_ENVIRONMENT,
    undefined
  );
  assert.equal(existsSync(preparationLock), false);
});
test('preparation serializes and releases its lock on failure without deleting another owner', () => {
  mkdirSync(preparationLock);
  try {
    assert.throws(() => prepareNativeMafFixture(), /EEXIST/);
    assert.ok(existsSync(preparationLock));
  } finally {
    rmSync(preparationLock, { recursive: true });
  }
  assert.throws(
    () =>
      prepareNativeMafFixture({
        run: () => {
          throw Error('intentional');
        },
      }),
    /intentional/
  );
  assert.equal(existsSync(preparationLock), false);
});
