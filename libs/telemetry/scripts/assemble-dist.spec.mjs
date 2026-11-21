import { describe, expect, it } from 'vitest';

import { createCanonicalPackageJson } from './assemble-dist.mjs';

describe('assemble-dist', () => {
  it('preserves publishConfig and removes install hooks from the canonical manifest', () => {
    const manifest = createCanonicalPackageJson({
      name: '@threadplane/telemetry',
      version: '0.0.30',
      license: 'MIT',
      publishConfig: { access: 'public' },
      bin: { 'threadplane-telemetry-postinstall': './node/postinstall.js' },
      scripts: { postinstall: 'node ./node/postinstall.js' },
      exports: { './node/postinstall': './node/postinstall.js' },
    });

    expect(manifest.publishConfig).toEqual({ access: 'public' });
    expect(manifest.bin).toBeUndefined();
    expect(manifest.scripts).toBeUndefined();
    expect(manifest.exports).not.toHaveProperty('./node/postinstall');
  });

  it('publishes the development runtime as an entry point without the PostHog service', () => {
    const manifest = createCanonicalPackageJson({ name: '@threadplane/telemetry', version: '0.0.30' });
    expect(manifest.exports['./browser/development']).toEqual({
      types: './browser/development/index.d.ts',
      default: './browser/fesm2022/threadplane-telemetry-browser-development.mjs',
    });
  });
});
