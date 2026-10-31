const { execFileSync } = require('node:child_process');

/**
 * Resolve identity once while Next builds, never from a later request.
 * Native CommonJS also works in Next's config loader before TS hooks exist.
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @param {() => string} [checkoutRevision]
 * @returns {string}
 */
function resolveDocsBuildRevision(
  environment,
  checkoutRevision = () =>
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
) {
  const revision =
    environment['THREADPLANE_DOCS_BUILD_REVISION'] ?? checkoutRevision();
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error(
      'Documentation build requires a full lowercase Git revision'
    );
  }
  return revision;
}

module.exports = { resolveDocsBuildRevision };
