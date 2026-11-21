// @vitest-environment node
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * The React twin of `libs/angular/scripts/verify-devtools-bundle.mjs`: bundle the
 * render and debug entries as an application build would, and prove that a
 * production build keeps nothing of the DevTools reporting while a
 * development build of the same entry keeps all of it.
 */
const entries = ['../render/index.ts', '../debug/index.ts'].map((path) =>
  decodeURIComponent(new URL(path, import.meta.url).pathname)
);
const markers = [
  'threadplane:devtools',
  '__THREADPLANE_DEVTOOLS_DISABLED__',
  'kind:"render"',
  'run:start',
  // The render tracker ranks states in `{ …, unresolved: 1, … }`.
  'unresolved:1',
];

async function bundle(nodeEnv: string): Promise<string> {
  const result = await build({
    entryPoints: entries,
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    minify: true,
    outdir: 'out',
    define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
    // Keep the bundle to this package's own source.
    plugins: [
      {
        name: 'externals',
        setup(builder) {
          builder.onResolve({ filter: /^[@a-z]/ }, (args) => ({
            path: args.path,
            external: true,
          }));
        },
      },
    ],
    logLevel: 'silent',
  });
  return result.outputFiles.map((file) => file.text).join('\n');
}

describe('DevTools reporting in bundles', () => {
  it('is stripped from production builds and kept in development builds', async () => {
    const development = await bundle('development');
    const production = await bundle('production');
    for (const marker of markers) {
      expect(development, `development keeps ${marker}`).toContain(marker);
      expect(production, `production strips ${marker}`).not.toContain(marker);
    }
    expect(production.length).toBeLessThan(development.length);
  }, 30_000);
});
