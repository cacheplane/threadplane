/** Explicit frozen preparation. Run serialized before other Mastra dependency users. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const serviceProject = resolve(root, 'deployments/ag-ui-mastra');
const lock = join(
  tmpdir(),
  'threadplane-mastra-install-' +
    createHash('sha256').update(serviceProject).digest('hex').slice(0, 16)
);
export function prepareNativeMastraFixture({ run = execFileSync } = {}) {
  mkdirSync(lock);
  try {
    run('npm', ['ci', '--prefix', serviceProject, '--no-audit', '--no-fund'], {
      cwd: root,
      stdio: 'inherit',
      timeout: 180000,
    });
  } finally {
    rmSync(lock, { recursive: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  prepareNativeMastraFixture();
