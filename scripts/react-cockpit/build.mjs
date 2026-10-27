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
const { appPath, base, adapter, topic } = reactCockpitConfiguration(process.argv[2]);
const nativeA2ui = topic === 'a2ui';
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
  const tarballs = packLocalArtifacts(root, temporary, ['react'], {
    optionalPeers: nativeA2ui ? ['a2ui'] : [],
  });
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
      profile: staticRender ? 'react-render' : nativeA2ui
        ? nativeAgUi ? 'react-native-a2ui-ag-ui' : 'react-native-a2ui-langgraph'
        : nativeAgUi ? 'react-ag-ui' : 'react-langgraph',
    }
  );
  const app = join(consumer, appPath);
  mkdirSync(app, { recursive: true });
  cpSync(join(root, appPath, 'src'), join(app, 'src'), {
    recursive: true,
    filter: (path) => !path.endsWith('.spec.ts') && !path.endsWith('.spec.tsx') &&
      !(nativeA2ui && path.split(/[\\/]/).includes('testing')),
  });
  cpSync(join(root, appPath, 'index.html'), join(app, 'index.html'));
  if (nativeA2ui) cpSync(
    join(root, 'libs/cockpit-a2ui-react/src'),
    join(consumer, 'libs/cockpit-a2ui-react/src'),
    {
      recursive: true,
      filter: (path) => !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path) &&
        !path.split(/[\\/]/).some(part => ['testing', 'fixtures'].includes(part)),
    }
  );
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
  const emittedModules = (Array.isArray(result) ? result : [result])
    .flatMap((entry) => entry.output)
    .flatMap((chunk) => Object.entries(chunk.modules ?? {}));
  const modules = emittedModules.map(([path]) => path);
  if (nativeA2ui) {
    for (const implementation of [
      '/node_modules/@threadplane/content/src/a2ui/create-surfaces.js',
      '/node_modules/@threadplane/a2ui/src/lib/parser.js',
      '/node_modules/@threadplane/content/src/render-state/create-render-state.js',
      '/node_modules/@threadplane/react/src/render/render-spec.js',
    ]) assert.ok(emittedModules.some(([path, module]) =>
      path.endsWith(implementation) && module.renderedLength > 0
    ), 'Installed nonzero A2UI implementation required: ' + implementation);
    assert.ok(emittedModules.some(([path, module]) =>
      path.includes('/node_modules/' + runtimePackage + '/') && module.renderedLength > 0
    ), 'Installed nonzero native runtime required');
    const agUiEntry = join(consumer, 'node_modules/@threadplane/ag-ui/fixtures/react-parity/ag-ui-candidate/entry.js');
    assert.ok(!modules.some(path => /\/(?:testing|fixtures|e2e)\//.test(path) &&
      !(nativeAgUi && path === agUiEntry)
    ), 'No testing implementation in public A2UI assets');
    if (nativeAgUi) assert.ok(!modules.some(path =>
      /\/node_modules\/(?:@threadplane\/langgraph\/|@langchain\/|@mastra\/|openai\/|@anthropic-ai\/)/.test(path)
    ), 'AG-UI A2UI has no LangGraph or provider implementation');
  }
  if (appPath === 'cockpit/render/computed-functions/react') {
    assert.ok(
      emittedModules.some(([path, module]) =>
        path.endsWith('/node_modules/@threadplane/react/src/render/readiness.js') &&
        module.renderedLength > 0
      ),
      'Installed readiness implementation required for computed functions'
    );
  }
  if (appPath === 'cockpit/render/element-rendering/react' ||
      appPath === 'cockpit/render/state-management/react' ||
      appPath === 'cockpit/render/repeat-loops/react') {
    assert.ok(
      emittedModules.some(([path, module]) =>
        path.endsWith('/node_modules/@threadplane/content/src/render-state/create-render-state.js') &&
        module.renderedLength > 0
      ),
      'Installed render-state owner implementation required for element rendering, state management and repeat loops'
    );
  }
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
