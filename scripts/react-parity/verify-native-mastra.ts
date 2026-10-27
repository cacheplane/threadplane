import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runNativeMastra } from './native-mastra-runner.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Test-only service setup remains outside the owner.
import { startScriptedService } from '../../deployments/ag-ui-mastra/test/scripted-service.mjs';

const version = (path: URL | string) =>
  (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;
const ownerRequire = createRequire(
  new URL('../../libs/ag-ui/src/runtime/create-session.ts', import.meta.url)
);
void runNativeMastra({
  startService: () => startScriptedService(),
  versions: {
    provider: version(
      new URL(
        '../../deployments/ag-ui-mastra/node_modules/@ag-ui/mastra/package.json',
        import.meta.url
      )
    ),
    mastraCore: version(
      new URL(
        '../../deployments/ag-ui-mastra/node_modules/@mastra/core/package.json',
        import.meta.url
      )
    ),
    libsql: version(
      new URL(
        '../../deployments/ag-ui-mastra/node_modules/@mastra/libsql/package.json',
        import.meta.url
      )
    ),
    serviceClient: version(
      new URL(
        '../../deployments/ag-ui-mastra/node_modules/@ag-ui/client/package.json',
        import.meta.url
      )
    ),
    ownerClient: version(ownerRequire.resolve('@ag-ui/client/package.json')),
  },
  serviceLockSha256: createHash('sha256')
    .update(
      readFileSync(
        new URL(
          '../../deployments/ag-ui-mastra/package-lock.json',
          import.meta.url
        )
      )
    )
    .digest('hex'),
})
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
