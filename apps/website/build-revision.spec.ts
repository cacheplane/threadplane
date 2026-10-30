// @vitest-environment node
import { expect, test } from 'vitest';
import { resolveDocsBuildRevision } from './build-revision';

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
