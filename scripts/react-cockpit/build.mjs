import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  emitCandidate,
  packCandidate,
} from '../react-parity/langgraph-candidate-package.mjs';
import { packLocalArtifacts } from '../react-parity/verify-packages.mjs';
import {
  installPresentationConsumer,
  reactLanggraphPresentationSeeds,
} from '../react-parity/markdown-presentation-build.mjs';
import { checkTypes } from '../react-parity/verify-langgraph-candidate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appPath = 'cockpit/langgraph/streaming/react';
const output = join(root, 'dist', appPath);
const temporary = realpathSync(
  mkdtempSync(join(tmpdir(), 'threadplane-react-cockpit-'))
);
try {
  execFileSync(
    'node',
    [
      join(root, 'node_modules/nx/bin/nx.js'),
      'run-many',
      '-t',
      'build',
      '-p',
      'core,content,react',
      '--skip-nx-cache',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, NX_DAEMON: 'false' },
    }
  );
  const candidate = join(temporary, 'candidate');
  mkdirSync(candidate);
  const emission = emitCandidate(root, candidate);
  const packed = packCandidate(candidate, temporary);
  const tarballs = {
    ...packLocalArtifacts(root, temporary, ['react']),
    '@threadplane/langgraph': 'file:' + packed.tarball,
  };
  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  const installed = installPresentationConsumer(
    consumer,
    JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')),
    tarballs,
    {
      seeds: reactLanggraphPresentationSeeds,
      profile: 'react-langgraph',
    }
  );
  const app = join(consumer, appPath);
  mkdirSync(app, { recursive: true });
  cpSync(join(root, appPath, 'src'), join(app, 'src'), {
    recursive: true,
    filter: (path) => !path.endsWith('.spec.ts') && !path.endsWith('.spec.tsx'),
  });
  cpSync(join(root, appPath, 'index.html'), join(app, 'index.html'));
  cpSync(
    join(root, 'libs/cockpit-runtime-bridge/src'),
    join(consumer, 'libs/cockpit-runtime-bridge/src'),
    {
      recursive: true,
      filter: (path) => !path.endsWith('.spec.ts'),
    }
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022', 'ESNext.Disposable', 'DOM'],
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        types: ['react', 'react-dom'],
      },
      files: [appPath + '/src/main.tsx'],
    })
  );
  checkTypes(consumer, 'tsconfig.json');
  const { build } = await import(
    pathToFileURL(join(consumer, 'node_modules/vite/dist/node/index.js')).href
  );
  const result = await build({
    configFile: false,
    root: app,
    base: '/langgraph/streaming/react/',
    esbuild: { jsx: 'automatic' },
    build: { outDir: output, emptyOutDir: true, sourcemap: false },
  });
  const modules = (Array.isArray(result) ? result : [result])
    .flatMap((entry) => entry.output)
    .flatMap((chunk) => Object.keys(chunk.modules ?? {}));
  assert.ok(
    modules.some((path) => path.includes('/node_modules/@threadplane/react/')),
    'Installed React required'
  );
  assert.ok(
    modules.some((path) =>
      path.includes('/node_modules/@threadplane/langgraph/')
    ),
    'Installed neutral runtime required'
  );
  assert.ok(
    modules.some((path) =>
      path.includes('/node_modules/@threadplane/content/')
    ),
    'Installed content required'
  );
  assert.ok(
    !modules.some((path) =>
      /\/node_modules\/@angular\/|\/libs\/(?:core|react|content|langgraph)\//.test(
        path
      )
    ),
    'No Angular or workspace implementation in runtime'
  );
  writeFileSync(
    join(output, 'build-proof.json'),
    JSON.stringify(
      {
        frontend: 'react',
        app: appPath,
        installed,
        runtimeSources: emission.sources,
        modules: modules.map((path) => path.replace(consumer, '<consumer>')),
      },
      null,
      2
    ) + '\n'
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
