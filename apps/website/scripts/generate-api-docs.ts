import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateApiReference } from './api-reference/generate';
export { generateApiReference } from './api-reference/generate';
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check'))
    throw new Error(
      'API reference generation accepts only --check; all entrypoints share one link registry.'
    );
  generateApiReference({
    root: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../..'
    ),
    check: args.includes('--check'),
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
