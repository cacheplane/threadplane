#!/usr/bin/env node
/**
 * Assembles the publishable @threadplane/telemetry package after `nx run telemetry:build`.
 *
 * The build produces two disjoint outputs:
 *  - @nx/js:tsc        → dist/libs/telemetry/src/{index,shared,node}/*
 *  - @nx/angular:package → dist/libs/telemetry/browser/{fesm2022,types}/*
 *
 * Neither shape matches what the exports map needs. This script:
 *  1. Flattens dist/libs/telemetry/src/* → dist/libs/telemetry/*
 *  2. Removes the conflicting browser/package.json from ng-packagr.
 *  3. Re-emits a canonical package.json with the corrected exports map.
 *  4. Adds browser/index.d.ts and browser/development/index.d.ts, which
 *     re-export from the fesm2022 types.
 *
 * Idempotent — re-running on an assembled dist is a no-op.
 */
import { readFile, writeFile, rm, rename, mkdir, access, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = join(HERE, '..');
const DIST = join(LIB_ROOT, '..', '..', 'dist', 'libs', 'telemetry');

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

/**
 * Recursively moves entries from src into dest, overwriting existing files.
 * Avoids `rename` cross-device issues by copying via read+write when possible,
 * but for same-filesystem moves a simple loop of renames is fastest.
 */
async function moveDirContentsUp(src, dest) {
  if (!(await exists(src))) return;
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      await moveDirContentsUp(from, to);
      await rm(from, { recursive: true, force: true });
    } else {
      await rename(from, to);
    }
  }
}

async function flattenSrc() {
  const srcDir = join(DIST, 'src');
  if (!(await exists(srcDir))) {
    console.log('[assemble-dist] dist/libs/telemetry/src not present — already assembled or build skipped');
    return;
  }
  console.log('[assemble-dist] flattening dist/libs/telemetry/src/* → dist/libs/telemetry/*');
  await moveDirContentsUp(srcDir, DIST);
  await rm(srcDir, { recursive: true, force: true });
}

async function removeNgPackagrManifest() {
  const ngPkg = join(DIST, 'browser', 'package.json');
  if (await exists(ngPkg)) {
    console.log('[assemble-dist] removing ng-packagr browser/package.json (replaced by canonical root manifest)');
    await rm(ngPkg);
  }
  const ngIgnore = join(DIST, 'browser', '.npmignore');
  if (await exists(ngIgnore)) await rm(ngIgnore);
  // ng-packagr writes a resolution stub for each secondary entry point; the
  // canonical exports map replaces them.
  const secondaries = join(DIST, 'browser', 'browser');
  if (await exists(secondaries)) await rm(secondaries, { recursive: true, force: true });
}

async function writeBrowserIndexReexport(
  // Make `./browser` resolve a clean type entry path. Nx's buildable-library
  // builds resolve `@threadplane/telemetry/browser[/development]` to these
  // directories, so each needs its own index.
  typesFile = 'threadplane-telemetry.d.ts',
  directory = 'browser'
) {
  const fesmTypes = join(DIST, 'browser', 'types', typesFile);
  const indexDts = join(DIST, directory, 'index.d.ts');
  if (!(await exists(fesmTypes))) {
    console.warn(`[assemble-dist] no browser/types/${typesFile} — skipping ${directory}/index.d.ts`);
    return;
  }
  if (await exists(indexDts)) return;  // idempotent
  await mkdir(dirname(indexDts), { recursive: true });
  const rel = relative(dirname(indexDts), fesmTypes).replace(/\\/g, '/').replace(/\.d\.ts$/, '');
  const content = `export * from '${rel.startsWith('.') ? rel : './' + rel}';\n`;
  await writeFile(indexDts, content, 'utf8');
  console.log(`[assemble-dist] wrote ${directory}/index.d.ts re-exporting from fesm2022 types`);
}

export function createCanonicalPackageJson(srcPkg) {
  const out = {
    name: srcPkg.name,
    version: srcPkg.version,
    // The npm page's subtitle. This manifest is an allowlist, so a field left
    // out here is a field that never ships, however carefully it is authored
    // in libs/telemetry/package.json.
    description: srcPkg.description,
    license: srcPkg.license,
    publishConfig: srcPkg.publishConfig,
    repository: srcPkg.repository,
    homepage: srcPkg.homepage,
    bugs: srcPkg.bugs,
    sideEffects: false,
    type: 'module',
    exports: {
      '.': {
        types: './index.d.ts',
        default: './index.js',
      },
      './shared': {
        types: './shared/public-api.d.ts',
        default: './shared/public-api.js',
      },
      './node': {
        types: './node/index.d.ts',
        default: './node/index.js',
      },
      './browser': {
        types: './browser/index.d.ts',
        default: './browser/fesm2022/threadplane-telemetry.mjs',
      },
      // The development runtime without the opt-in PostHog service.
      './browser/development': {
        types: './browser/development/index.d.ts',
        default: './browser/fesm2022/threadplane-telemetry-browser-development.mjs',
      },
      './README.md': './README.md',
    },
    peerDependencies: srcPkg.peerDependencies,
    peerDependenciesMeta: srcPkg.peerDependenciesMeta,
    dependencies: srcPkg.dependencies,
  };
  // Strip undefined.
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

async function writeCanonicalPackageJson() {
  const srcPkg = JSON.parse(await readFile(join(LIB_ROOT, 'package.json'), 'utf8'));
  // Strip dev fields, lock to a clean publishable shape.
  const out = createCanonicalPackageJson(srcPkg);
  await writeFile(join(DIST, 'package.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('[assemble-dist] wrote canonical dist/libs/telemetry/package.json with corrected exports map');
}

async function verifyExports() {
  const pkg = JSON.parse(await readFile(join(DIST, 'package.json'), 'utf8'));
  const missing = [];
  for (const [key, value] of Object.entries(pkg.exports ?? {})) {
    const paths = typeof value === 'string' ? [value] : Object.values(value);
    for (const p of paths) {
      const abs = join(DIST, p);
      if (!(await exists(abs))) missing.push(`${key} → ${p}`);
    }
  }
  if (missing.length > 0) {
    console.error('[assemble-dist] FAIL: exports map references missing files:');
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log(`[assemble-dist] OK: all ${Object.keys(pkg.exports).length} exports map paths resolve`);
}

async function main() {
  if (!(await exists(DIST))) {
    console.error(`[assemble-dist] ${DIST} does not exist — run \`nx run telemetry:build\` first`);
    process.exit(1);
  }
  await flattenSrc();
  await removeNgPackagrManifest();
  await writeBrowserIndexReexport();
  await writeBrowserIndexReexport(
    'threadplane-telemetry-browser-development.d.ts',
    'browser/development'
  );
  await writeCanonicalPackageJson();
  await verifyExports();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[assemble-dist] failed:', err);
    process.exit(1);
  });
}
