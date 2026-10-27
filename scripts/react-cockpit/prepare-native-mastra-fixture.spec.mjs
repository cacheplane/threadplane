import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareNativeMastraFixture,
  serviceProject,
} from './prepare-native-mastra-fixture.mjs';
test('preparation uses frozen independent service dependencies', () => {
  let invocation;
  prepareNativeMastraFixture({
    run: (...args) => {
      invocation = args;
    },
  });
  assert.equal(invocation[0], 'npm');
  assert.deepEqual(invocation[1], [
    'ci',
    '--prefix',
    serviceProject,
    '--no-audit',
    '--no-fund',
  ]);
  assert.equal(invocation[2].timeout, 180000);
});
test('failed preparation releases install serialization lock', () => {
  assert.throws(
    () =>
      prepareNativeMastraFixture({
        run: () => {
          throw new Error('install failed');
        },
      }),
    /install failed/
  );
  prepareNativeMastraFixture({ run: () => undefined });
});
