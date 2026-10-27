/** Local test dependency owner; no deployment or backend source is modified. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  root,
  project,
  environment,
  preparationLock,
  fixtureEnvironment,
} from '../../fixtures/react-parity/native-strands-react/configuration.mjs';
export {
  root,
  project,
  environment,
  preparationLock,
  fixtureEnvironment,
} from '../../fixtures/react-parity/native-strands-react/configuration.mjs';
export function prepareNativeStrandsFixture({ run = execFileSync } = {}) {
  mkdirSync(preparationLock);
  try {
    run('uv', ['sync', '--frozen', '--python', '3.12', '--project', project], {
      cwd: root,
      stdio: 'inherit',
      timeout: 180000,
      env: {
        ...fixtureEnvironment(),
        UV_PYTHON: '3.12',
        UV_PROJECT_ENVIRONMENT: environment,
      },
    });
  } finally {
    rmSync(preparationLock, { recursive: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  prepareNativeStrandsFixture();
