import { execFileSync } from 'node:child_process';

/** Resolve the source identity once while Next builds, never from a later request. */
export function resolveDocsBuildRevision(
  environment: Readonly<Record<string, string | undefined>>,
  checkoutRevision = () =>
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
): string {
  const revision =
    environment['THREADPLANE_DOCS_BUILD_REVISION'] ?? checkoutRevision();
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error(
      'Documentation build requires a full lowercase Git revision'
    );
  }
  return revision;
}
