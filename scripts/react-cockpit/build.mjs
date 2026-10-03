import assert from 'node:assert/strict';
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
import {
  emitCandidate as emitAgUiCandidate,
  packCandidate as packAgUiCandidate,
  rootRangeOverrides,
} from '../react-parity/ag-ui-candidate-package.mjs';
import { packLocalArtifacts } from '../react-parity/verify-packages.mjs';
import {
  installPresentationConsumer,
  reactLanggraphPresentationSeeds,
  reactAgUiPresentationSeeds,
  reactRenderPresentationSeeds,
} from '../react-parity/markdown-presentation-build.mjs';
import { checkTypes } from '../react-parity/verify-langgraph-candidate.mjs';
import { reactCockpitConfiguration } from './configuration.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { appPath, base, adapter } = reactCockpitConfiguration(process.argv[2]);
const nativeAgUi = adapter === 'ag-ui';
const staticRender = adapter === 'none';
if (nativeAgUi) rootRangeOverrides(root);
const runtimePackage = nativeAgUi
  ? '@threadplane/ag-ui'
  : '@threadplane/langgraph';
const output = join(root, 'dist', appPath);
const temporary = realpathSync(
  mkdtempSync(join(tmpdir(), 'threadplane-react-cockpit-'))
);
try {
  // Nx app targets prepare shared packages once before parallel isolated builds.
  let emission = { sources: [] };
  const tarballs = packLocalArtifacts(root, temporary, ['react']);
  if (!staticRender) {
    const candidate = join(temporary, 'candidate');
    mkdirSync(candidate);
    emission = (nativeAgUi ? emitAgUiCandidate : emitCandidate)(root, candidate);
    const packed = (nativeAgUi ? packAgUiCandidate : packCandidate)(candidate, temporary);
    tarballs[runtimePackage] = 'file:' + packed.tarball;
  }
  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  const installed = installPresentationConsumer(
    consumer,
    JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')),
    tarballs,
    {
      seeds: staticRender ? reactRenderPresentationSeeds : nativeAgUi
        ? reactAgUiPresentationSeeds
        : reactLanggraphPresentationSeeds,
      profile: staticRender ? 'react-render' : nativeAgUi ? 'react-ag-ui' : 'react-langgraph',
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
    base,
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
  if (!staticRender) assert.ok(
    modules.some((path) =>
      path.includes('/node_modules/' + runtimePackage + '/')
    ),
    'Installed neutral runtime required'
  );
  if (staticRender) {
    assert.ok(modules.some(path => /\/node_modules\/@threadplane\/react\/.*render-spec/.test(path)), 'Installed RenderSpec required');
    assert.ok(modules.some(path => path.includes('/node_modules/@cacheplane/partial-json/')), 'Installed partial JSON parser required');
    assert.ok(!modules.some(path => /\/node_modules\/(?:@threadplane\/(?:ag-ui|langgraph)|@ag-ui\/|@langchain\/|@mastra\/|openai\/|@anthropic-ai\/)/.test(path)), 'Static render has no backend runtime');
  } else if (nativeAgUi) {
    assert.ok(
      modules.some((path) =>
        path.includes(
          '/node_modules/@threadplane/ag-ui/libs/ag-ui/src/runtime/session-publication.js'
        )
      ),
      'Installed native AG-UI publication required'
    );
    assert.ok(
      modules.some((path) => path.includes('/node_modules/@ag-ui/client/')),
      'Installed AG-UI client required'
    );
  } else
    assert.ok(
      modules.some((path) =>
        path.includes('/node_modules/@threadplane/content/')
      ),
      'Installed content required'
    );
  assert.ok(
    !modules.some(
      (path) =>
        /\/node_modules\/@angular\/|\/libs\/(?:core|react|content|langgraph)\//.test(
          path
        ) ||
        (/\/libs\/ag-ui\//.test(path) &&
          !(
            nativeAgUi &&
            path.includes('/node_modules/@threadplane/ag-ui/libs/ag-ui/')
          ))
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
