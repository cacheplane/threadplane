/** Bundles the session runtime from source for Node, as the Strands fixture spec does. */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { here, root } from './configuration.mjs';

/** Returns the runtime's exports and how to remove the bundle. */
export async function loadSession() {
  const directory = await mkdtemp(join(tmpdir(), 'ag-ui-live-session-'));
  const outfile = join(directory, 'session.mjs');
  await build({
    entryPoints: [join(here, 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    tsconfig: join(root, 'tsconfig.base.json'),
    outfile,
    logLevel: 'silent',
  });
  const runtime = await import(pathToFileURL(outfile).href);
  return {
    runtime,
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}
