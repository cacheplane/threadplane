#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReviewServer } from '../../fixtures/react-parity/native-ag-ui/server.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const buildCommand =
  'NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p core,angular,react --skip-nx-cache';
export const sequence =
  'First → Remove React → Advance first → Mount React → Resume → Remove Angular → Complete resume → Mount Angular → Start other → Cancelable → Stop A → Dispose → Try disposed';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const portable = (path) => path.replaceAll('\\', '/');

export function resolveArtifacts(root = defaultRoot) {
  const entries = {};
  for (const name of ['core', 'react', 'angular']) {
    try {
      const folder = join(root, 'dist/libs', name);
      const manifest = JSON.parse(
        readFileSync(join(folder, 'package.json'), 'utf8')
      );
      if (manifest.name !== `@threadplane/${name}`)
        throw new Error('wrong package');
      for (const subpath of name === 'core' ? ['.'] : ['.', './chat']) {
        const exported = manifest.exports?.[subpath];
        const entry =
          typeof exported === 'string'
            ? exported
            : exported?.import ??
              exported?.default ??
              (subpath === '.' ? manifest.module : undefined);
        if (typeof entry !== 'string') throw new Error('missing root export');
        const absolute = resolve(folder, entry);
        if (!absolute.startsWith(folder + '/') || !existsSync(absolute))
          throw new Error('missing implementation');
        entries[manifest.name + (subpath === '.' ? '' : subpath.slice(1))] =
          absolute;
      }
    } catch {
      throw new Error(
        `Missing prebuilt ${name} artifacts. Run: ${buildCommand}`
      );
    }
  }
  return entries;
}

export function collectProvenance({
  root,
  metafile,
  bundle,
  additionalInputs = [],
}) {
  const inputs = [
    ...new Set(
      [...Object.keys(metafile.inputs), ...additionalInputs]
        .map((path) =>
          portable(
            relative(root, isAbsolute(path) ? path : resolve(root, path))
          )
        )
        .filter(
          (path) =>
            !path.startsWith('../') && !path.split('/').includes('node_modules')
        )
    ),
  ].sort();
  const scoped = [...new Set([...inputs, 'package-lock.json'])].sort();
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const paths = (value) =>
    value ? value.split('\0').filter(Boolean).sort() : [];
  const lockBytes = readFileSync(join(root, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  return {
    git: {
      head: git('rev-parse', 'HEAD'),
      modified: paths(
        git('diff', '--name-only', '-z', 'HEAD', '--', ...scoped)
      ),
      untracked: paths(
        git('ls-files', '--others', '--exclude-standard', '-z', '--', ...scoped)
      ),
    },
    inputs: inputs.map((path) => ({
      path,
      sha256: hash(readFileSync(join(root, path))),
    })),
    packageLockSha256: hash(lockBytes),
    versions: Object.fromEntries(
      [
        'react',
        'react-dom',
        '@angular/core',
        '@angular/compiler',
        '@angular/platform-browser',
        '@ag-ui/client',
        'typescript',
        'esbuild',
        '@playwright/test',
      ].flatMap((name) => {
        const version = lock.packages?.[`node_modules/${name}`]?.version;
        return version ? [[name, version]] : [];
      })
    ),
    bundleSha256: hash(bundle),
  };
}

export async function buildFixture(root = defaultRoot) {
  const alias = resolveArtifacts(root);
  const { build } = await import('esbuild');
  const built = await build({
    entryPoints: ['fixtures/react-parity/native-ag-ui/browser.tsx'],
    absWorkingDir: root,
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: join(root, 'tsconfig.base.json'),
    alias,
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  const bundle = built.outputFiles[0].text;
  const additionalInputs = [
    'fixtures/react-parity/native-ag-ui/server.mjs',
    'fixtures/react-parity/native-ag-ui/README.md',
    'scripts/react-parity/review-native-ag-ui.mjs',
    'scripts/react-parity/native-ag-ui-browser.mjs',
    'libs/react/src/use-agent.ts',
    'libs/angular/src/observe-agent.ts',
    'libs/react/src/chat/index.ts',
    'libs/react/src/chat/text-transcript.tsx',
    'libs/angular/chat/src/public-api.ts',
    'libs/angular/chat/src/text-transcript.component.ts',
    'libs/angular/chat/ng-package.json',
    ...['core', 'react', 'angular'].map(
      (name) => `dist/libs/${name}/package.json`
    ),
  ];
  return {
    bundle,
    provenance: collectProvenance({
      root,
      metafile: built.metafile,
      bundle,
      additionalInputs,
    }),
  };
}

export async function runReview(
  {
    root = defaultRoot,
    verify = false,
    signal,
    log = (value) => console.log(JSON.stringify(value)),
  } = {},
  dependencies = {}
) {
  const built = await (dependencies.buildFixture ?? buildFixture)(root);
  const server = await (dependencies.createReviewServer ?? createReviewServer)(
    built
  );
  let browser;
  let interrupt;
  const interrupted = new Promise((_, reject) => {
    interrupt = () => reject(new Error('Native review interrupted'));
  });
  // The rejection is consumed even in manual mode or before browser launch.
  interrupted.catch(() => undefined);
  signal?.addEventListener('abort', interrupt, { once: true });
  try {
    if (verify) {
      if (signal?.aborted) throw new Error('Native review interrupted');
      const launch =
        dependencies.launchBrowser ??
        (async () => (await import('@playwright/test')).chromium.launch());
      const launched = Promise.resolve()
        .then(launch)
        .then(async (owned) => {
          if (signal?.aborted) {
            await owned.close();
            throw new Error('Native review interrupted');
          }
          browser = owned;
          return owned;
        });
      await Promise.race([launched, interrupted]);
      const verifyBrowser =
        dependencies.verifyBrowser ??
        (await import('./native-ag-ui-browser.mjs')).verifyBrowser;
      const result = await Promise.race([
        verifyBrowser(browser, server),
        interrupted,
      ]);
      log({ mode: 'verified', ...result, provenance: built.provenance });
      return result;
    }
    log({
      mode: 'manual',
      url: server.url,
      sequence,
      provenance: built.provenance,
    });
    if (!signal) throw new Error('Manual review requires a shutdown signal');
    if (!signal.aborted)
      await new Promise((resolve) =>
        signal.addEventListener('abort', resolve, { once: true })
      );
  } finally {
    signal?.removeEventListener('abort', interrupt);
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--verify') || args.length > 1) {
    console.error(
      'Usage: node scripts/react-parity/review-native-ag-ui.mjs [--verify]'
    );
    process.exitCode = 1;
  } else {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      await runReview({
        verify: args.includes('--verify'),
        signal: controller.signal,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
}
