// @vitest-environment node
import { expect, test } from 'vitest';
import { resolveDocsBuildRevision } from './build-revision.cjs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('the real Next config loader resolves build identity without a TypeScript test loader', () => {
  const revision = 'c'.repeat(40);
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    require('next/dist/server/config').default('phase-development-server', require('node:path').resolve('apps/website'))
      .then(config => process.stdout.write(config.env.THREADPLANE_DOCS_BUILD_REVISION))
      .catch(error => { console.error(error); process.exitCode = 1; });
  `,
    ],
    {
      cwd: resolve(import.meta.dirname, '../..'),
      env: {
        ...process.env,
        THREADPLANE_DOCS_BUILD_REVISION: revision,
        __NEXT_NODE_NATIVE_TS_LOADER_ENABLED: 'false',
        NX_DAEMON: 'false',
        NX_ISOLATE_PLUGINS: 'false',
      },
      encoding: 'utf8',
      timeout: 20000,
    }
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe(revision);
}, 25000);

test('build identity uses an explicit full revision, or the checked-out source locally', () => {
  const revision = 'b'.repeat(40);
  expect(
    resolveDocsBuildRevision(
      { THREADPLANE_DOCS_BUILD_REVISION: revision },
      () => 'a'.repeat(40)
    )
  ).toBe(revision);
  expect(resolveDocsBuildRevision({}, () => revision)).toBe(revision);
  expect(() =>
    resolveDocsBuildRevision(
      { THREADPLANE_DOCS_BUILD_REVISION: 'short' },
      () => revision
    )
  ).toThrow(/full/);
  expect(() => resolveDocsBuildRevision({}, () => '')).toThrow(/full/);
});
