import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
test('frozen preparation isolates Python 3.12, credentials, sources and shared ownership', async () => {
  const module = await import('./prepare-native-strands-fixture.mjs').catch(
    () => null
  );
  assert.ok(module, 'Native Strands preparation must exist');
  const { prepareNativeStrandsFixture, preparationLock, environment, project } =
    module;
  const source = readFileSync(project + '/uv.lock');
  process.env.OPENAI_API_KEY = 'must-not-inherit';
  process.env.AWS_SECRET_ACCESS_KEY = 'must-not-inherit';
  let args;
  prepareNativeStrandsFixture({
    run: (...value) => {
      args = value;
      assert.ok(existsSync(preparationLock));
    },
  });
  assert.deepEqual(args[1], [
    'sync',
    '--frozen',
    '--python',
    '3.12',
    '--project',
    project,
  ]);
  assert.equal(args[2].env.UV_PROJECT_ENVIRONMENT, environment);
  assert.equal(args[2].env.UV_PYTHON, '3.12');
  assert.equal(args[2].env.OPENAI_API_KEY, undefined);
  assert.equal(args[2].env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(args[2].timeout, 180000);
  assert.equal(existsSync(preparationLock), false);
  assert.deepEqual(readFileSync(project + '/uv.lock'), source);
  mkdirSync(preparationLock);
  try {
    assert.throws(() => prepareNativeStrandsFixture(), /EEXIST/);
    assert.ok(existsSync(preparationLock));
  } finally {
    rmSync(preparationLock, { recursive: true });
  }
  assert.throws(
    () =>
      prepareNativeStrandsFixture({
        run: () => {
          throw Error('intentional');
        },
      }),
    /intentional/
  );
  assert.equal(existsSync(preparationLock), false);
});
