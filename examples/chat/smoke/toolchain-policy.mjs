import { execFileSync } from 'node:child_process';

export const SMOKE_NPM_VERSION = '11.6.0';

// Pin the resolver used for the external consumer, independently of root npm ci.
export function requireSmokeNpm() {
  let version;
  try {
    version = execFileSync('npm', ['--version'], {
      encoding: 'utf8',
      timeout: 10000,
    }).trim();
  } catch {
    version = 'unavailable';
  }
  if (version !== SMOKE_NPM_VERSION) {
    throw new Error(
      `Smoke installation requires npm ${SMOKE_NPM_VERSION}; found ${version}. ` +
      `From the workspace root, rerun with: npm exec --yes --package=npm@${SMOKE_NPM_VERSION} -- node examples/chat/smoke/cli.mjs ` +
      '<your original arguments>. Use --no-install to generate without installing.'
    );
  }
}
