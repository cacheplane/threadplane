/** Fixture ownership shared by frozen preparation and active runtimes. */
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..'
);
export const project = resolve(root, 'deployments/ag-ui-dev/deps/aws_strands');
export const environment = join(
  tmpdir(),
  'threadplane-native-strands-react-' +
    createHash('sha256').update(root).digest('hex').slice(0, 16)
);
export const preparationLock = environment + '.owner';
export function fixtureEnvironment() {
  return Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'SSL_CERT_FILE', 'UV_CACHE_DIR']
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]])
  );
}
