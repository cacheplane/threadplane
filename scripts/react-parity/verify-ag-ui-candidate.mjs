#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import ts from 'typescript';
import {
  assertInstalledInputs,
  candidateViolations,
  emitCandidate,
  entry,
  factory,
  installCandidate,
  packCandidate,
  projector,
  rootRangeOverrides,
} from './ag-ui-candidate-package.mjs';
import {
  fileHashes,
  sha256,
  localArtifactRecords,
  assertInstalledArtifacts,
} from './langgraph-candidate-package.mjs';
import { checkTypes } from './verify-langgraph-candidate.mjs';
import {
  packLocalArtifacts,
  localDependencyProjects,
} from './verify-packages.mjs';
import { createReviewServer } from '../../fixtures/react-parity/native-ag-ui/server.mjs';
import { verifyBrowser } from './native-ag-ui-browser.mjs';
import { sequence } from './review-native-ag-ui.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
export const buildCommand =
  'NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p core,content,angular,react --skip-nx-cache --outputStyle=stream';

function artifacts(consumer, expected) {
  const records = assertInstalledArtifacts(consumer, expected);
  assert.deepEqual(
    candidateViolations(join(consumer, 'node_modules/@threadplane/ag-ui')),
    []
  );
  return records;
}
function typeProbes(root, consumer, mixed) {
  cpSync(
    join(root, 'fixtures/react-parity/ag-ui-candidate/installed-types.ts'),
    join(consumer, 'installed-types.ts')
  );
  const files = ['installed-types.ts'];
  if (mixed) {
    writeFileSync(
      join(consumer, 'binding-types.ts'),
      `import { createSession } from '@threadplane/ag-ui';
import { useAgent } from '@threadplane/react';
import { observeAgent } from '@threadplane/angular';
export function check() {
  const session = createSession({ threadId: 'check', url: 'http://127.0.0.1:1' });
  const react = useAgent(session), angular = observeAgent(session)();
  const same: typeof react = angular;
  react.transcript; angular.subagents;
  // @ts-expect-error No core message aggregate is manufactured.
  react.messages;
  // @ts-expect-error Native snapshots remain readonly through Angular.
  angular.state = {};
  return same;
}
`
    );
    files.push('binding-types.ts');
  }
  const types = {};
  for (const mode of ['NodeNext', 'Bundler']) {
    const config = `tsconfig.${mode}.json`;
    writeJson(join(consumer, config), {
      compilerOptions: {
        target: 'ES2022',
        module: mode === 'NodeNext' ? 'NodeNext' : 'ESNext',
        moduleResolution: mode,
        strict: true,
        skipLibCheck: false,
        types: [],
        lib: ['ES2022', 'DOM'],
        noEmit: true,
      },
      files,
    });
    types[mode] = checkTypes(consumer, config);
    assert.ok(
      types[mode].some(
        (file) =>
          file.path.startsWith('node_modules/@threadplane/core/') &&
          file.path.endsWith('.d.ts')
      ),
      'Actual core declarations are resolved even when core is runtime type-only'
    );
  }
  return types;
}
function nodeProbe(consumer) {
  writeFileSync(
    join(consumer, 'node-probe.mjs'),
    `import assert from 'node:assert/strict';
const original = globalThis.fetch; let attempts = 0;
globalThis.fetch = () => { attempts++; throw new Error('Inert lifecycle must not fetch'); };
try {
  const backend = await import('@threadplane/ag-ui');
  assert.deepEqual(Object.keys(backend).sort(), ['createSession', 'projectTextTranscript']);
  const session = backend.createSession({ threadId: 'inert', url: 'http://127.0.0.1:1' });
  const snapshot = session.getSnapshot(); assert.ok(Object.isFrozen(snapshot));
  assert.equal(session.getSnapshot(), snapshot); let notifications = 0;
  const release = session.subscribe(() => notifications++); release(); release();
  const rows = backend.projectTextTranscript(snapshot.transcript); assert.ok(Object.isFrozen(rows));
  await session.dispose(); await session.dispose();
  assert.equal(session.getSnapshot(), snapshot); assert.equal(notifications, 0); assert.equal(attempts, 0);
  console.log(JSON.stringify({ import: true, inertObservation: true, fetches: attempts }));
} finally { globalThis.fetch = original; }
`
  );
  return JSON.parse(
    execFileSync(process.execPath, ['node-probe.mjs'], {
      cwd: consumer,
      encoding: 'utf8',
      timeout: 15000,
    })
  );
}
function ownerVersion(consumer) {
  const require = createRequire(
    join(consumer, 'node_modules/@threadplane/ag-ui', entry + '.js')
  );
  const path = require.resolve('@ag-ui/client/package.json');
  assert.ok(
    realpathSync(path).startsWith(consumer + '/node_modules/'),
    'Owner SDK is installed inside its consumer'
  );
  return {
    path: relative(consumer, path),
    version: json(path).version,
    sha256: sha256(readFileSync(path)),
  };
}
async function browserProof(root, consumer, expected) {
  cpSync(
    join(root, 'fixtures/react-parity/native-ag-ui/browser.tsx'),
    join(consumer, 'browser.tsx')
  );
  cpSync(
    join(root, 'fixtures/react-parity/ag-ui-candidate/backend-binding.ts'),
    join(consumer, 'backend-binding.ts')
  );
  writeJson(join(consumer, 'tsconfig.browser.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM'],
      types: [],
      jsx: 'react-jsx',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: false,
      noEmit: true,
    },
    files: ['browser.tsx'],
  });
  const types = checkTypes(consumer, 'tsconfig.browser.json');
  const built = buildSync({
    absWorkingDir: consumer,
    entryPoints: ['browser.tsx'],
    tsconfig: join(consumer, 'tsconfig.browser.json'),
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  const inputs = Object.keys(built.metafile.inputs);
  assertInstalledInputs(consumer, inputs, expected);
  assertInstalledInputs(
    consumer,
    types.map((file) => file.path),
    expected
  );
  for (const target of [
    `node_modules/@threadplane/ag-ui/${factory}.js`,
    `node_modules/@threadplane/ag-ui/${projector}.js`,
    'node_modules/@threadplane/react/src/use-agent.js',
    'node_modules/@threadplane/angular/fesm2022/threadplane-angular.mjs',
  ])
    assert.ok(
      inputs.includes(target),
      `Real installed implementation required: ${target}`
    );
  const bundle = built.outputFiles[0].text;
  writeFileSync(join(consumer, 'browser.js'), bundle);
  const server = await createReviewServer({
    bundle,
    provenance: { mode: 'installed-candidate', bundleSha256: sha256(bundle) },
  });
  let browser;
  try {
    browser = await (await import('@playwright/test')).chromium.launch();
    const result = await verifyBrowser(browser, server);
    return { inputs, types, bundleSha256: sha256(bundle), result };
  } finally {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
}
function providerProof(root, consumer, expected) {
  const service = join(root, 'deployments/ag-ui-mastra');
  let source = readFileSync(
    join(root, 'scripts/react-parity/native-mastra-runner.ts'),
    'utf8'
  );
  assert.ok(
    source.includes(
      "'../../fixtures/react-parity/native-ag-ui/mastra-backend.js'"
    )
  );
  source = source
    .replace(
      "'../../fixtures/react-parity/native-ag-ui/mastra-backend.js'",
      "'./backend-binding.js'"
    )
    .replace(
      "'../../deployments/ag-ui-mastra/test/scripted-service.mjs'",
      "'./service-helpers.mjs'"
    );
  writeFileSync(join(consumer, 'native-mastra-runner.ts'), source);
  cpSync(
    join(root, 'fixtures/react-parity/ag-ui-candidate/backend-binding.ts'),
    join(consumer, 'backend-binding.ts')
  );
  const helper = join(service, 'test/scripted-service.mjs');
  writeFileSync(
    join(consumer, 'service-helpers.mjs'),
    `export { bounded, waitUntil } from ${JSON.stringify(helper)};\n`
  );
  writeFileSync(
    join(consumer, 'service-helpers.d.mts'),
    `export { bounded, waitUntil } from ${JSON.stringify(
      helper
    )};\nexport type { ScriptedService } from ${JSON.stringify(helper)};\n`
  );
  const versions = {
    provider: json(join(service, 'node_modules/@ag-ui/mastra/package.json'))
      .version,
    mastraCore: json(join(service, 'node_modules/@mastra/core/package.json'))
      .version,
    libsql: json(join(service, 'node_modules/@mastra/libsql/package.json'))
      .version,
    serviceClient: json(
      join(service, 'node_modules/@ag-ui/client/package.json')
    ).version,
    ownerClient: ownerVersion(consumer).version,
  };
  const serviceLockSha256 = sha256(
    readFileSync(join(service, 'package-lock.json'))
  );
  writeFileSync(
    join(consumer, 'provider.ts'),
    `import { runNativeMastra } from './native-mastra-runner.js';
import { startScriptedService } from ${JSON.stringify(helper)};
const result = await runNativeMastra({ startService: () => startScriptedService(), versions: ${JSON.stringify(
      versions
    )}, serviceLockSha256: ${JSON.stringify(serviceLockSha256)} });
console.log(JSON.stringify(result));
`
  );
  writeJson(join(consumer, 'tsconfig.provider.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2022', 'DOM'],
      types: ['node'],
      strict: true,
      skipLibCheck: false,
      noEmit: true,
    },
    files: ['provider.ts'],
  });
  const types = checkTypes(consumer, 'tsconfig.provider.json');
  const built = buildSync({
    absWorkingDir: consumer,
    entryPoints: ['provider.ts'],
    bundle: true,
    packages: 'external',
    external: [helper],
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    logLevel: 'silent',
  });
  const inputs = Object.keys(built.metafile.inputs);
  assertInstalledInputs(consumer, inputs, expected);
  assertInstalledInputs(
    consumer,
    types.map((file) => file.path),
    expected
  );
  const code = built.outputFiles[0].text;
  assert.match(
    code,
    /from "@threadplane\/ag-ui"/,
    'Provider process preserves a real installed owner import'
  );
  assert.doesNotMatch(
    code,
    /libs\/ag-ui\/src|create-session\.ts/,
    'Provider code never embeds private backend source'
  );
  writeFileSync(join(consumer, 'provider.mjs'), code);
  const output = execFileSync(process.execPath, ['provider.mjs'], {
    cwd: consumer,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const result = JSON.parse(output.trim().split('\n').at(-1));
  assert.equal(result.scenarios.length, 4);
  assert.equal(result.providerPosts, 8);
  assert.equal(result.providerResponsesClosed, true);
  assert.equal(result.externalFetchAttempts, 0);
  writeJson(join(consumer, 'provider-result.json'), result);
  return {
    inputs,
    types,
    bundleSha256: sha256(code),
    helper: {
      sha256: sha256(readFileSync(helper)),
      path: relative(root, helper),
    },
    serviceLockSha256,
    result,
  };
}
export async function verifyAgUiCandidate({ root = defaultRoot, retain } = {}) {
  root = realpathSync(root);
  for (const name of localDependencyProjects(
    ['core', 'react', 'angular'],
    (name) => json(join(root, 'libs', name, 'package.json'))
  ))
    assert.ok(
      existsSync(join(root, 'dist/libs', name, 'package.json')),
      `Missing ${name}; run ${buildCommand}`
    );
  assert.ok(
    existsSync(
      join(
        root,
        'deployments/ag-ui-mastra/node_modules/@ag-ui/mastra/package.json'
      )
    ),
    'Run npm ci --prefix deployments/ag-ui-mastra --no-audit --no-fund first'
  );
  let temporary = retain
    ? resolve(retain)
    : mkdtempSync(join(tmpdir(), 'ag-ui-candidate-'));
  if (retain) mkdirSync(temporary);
  temporary = realpathSync(temporary);
  let success = false;
  try {
    const candidate = join(temporary, 'candidate'),
      emission = emitCandidate(root, candidate);
    assert.equal(
      emission.sources.length,
      21,
      'Twenty actual backend modules plus the direct forwarding entry'
    );
    const packed = packCandidate(candidate, temporary),
      tarballs = packLocalArtifacts(root, temporary, [
        'core',
        'react',
        'angular',
      ]);
    tarballs['@threadplane/ag-ui'] = 'file:' + packed.tarball;
    const expected = Object.fromEntries(
      Object.entries(localArtifactRecords(tarballs)).map(([name, record]) => [
        name,
        record.files,
      ])
    );
    const lock = json(join(root, 'package-lock.json')),
      ranges = rootRangeOverrides(root);
    const node = join(temporary, 'node');
    mkdirSync(node);
    const nodeTarballs = Object.fromEntries(
      ['@threadplane/core', '@threadplane/ag-ui'].map((name) => [
        name,
        tarballs[name],
      ])
    );
    const nodeInstallation = installCandidate(
      node,
      { private: true, type: 'module' },
      nodeTarballs,
      lock,
      false,
      ranges
    );
    const nodeArtifacts = artifacts(
      node,
      Object.fromEntries(
        Object.keys(nodeTarballs).map((name) => [name, expected[name]])
      )
    );
    const nodeResult = nodeProbe(node),
      nodeTypes = typeProbes(root, node, false);
    for (const files of Object.values(nodeTypes))
      assertInstalledInputs(
        node,
        files.map((file) => file.path),
        nodeArtifacts
      );
    const graph = buildSync({
      absWorkingDir: node,
      stdin: {
        contents:
          "export { createSession, projectTextTranscript } from '@threadplane/ag-ui';",
        resolveDir: node,
      },
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const nodeInputs = Object.keys(graph.metafile.inputs);
    assertInstalledInputs(node, nodeInputs, nodeArtifacts);
    assert.ok(
      !nodeInputs.some((path) =>
        /node_modules\/(?:@angular|react|@threadplane\/(?:chat|telemetry))\//.test(
          path
        )
      ),
      'Backend graph has no framework implementation'
    );
    const consumer = join(temporary, 'consumer');
    mkdirSync(consumer);
    const names = [
      '@angular/core',
      '@angular/common',
      '@angular/compiler',
      '@angular/platform-browser',
      'react',
      'react-dom',
      'rxjs',
      'tslib',
    ];
    const devNames = [
      '@types/react',
      '@types/react-dom',
      '@types/node',
      'typescript',
    ];
    const pinned = (names) =>
      Object.fromEntries(
        names.map((name) => [
          name,
          lock.packages['node_modules/' + name].version,
        ])
      );
    const installation = installCandidate(
      consumer,
      {
        private: true,
        type: 'module',
        dependencies: pinned(names),
        devDependencies: pinned(devNames),
      },
      tarballs,
      lock,
      true,
      ranges
    );
    const installed = artifacts(consumer, expected),
      types = typeProbes(root, consumer, true);
    for (const files of Object.values(types))
      assertInstalledInputs(
        consumer,
        files.map((file) => file.path),
        installed
      );
    const browser = await browserProof(root, consumer, installed),
      provider = providerProof(root, consumer, installed);
    const git = (...args) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const scope = [
      'libs/ag-ui/src/runtime',
      'libs/ag-ui/src/lib/internal',
      'fixtures/react-parity/native-ag-ui',
      'fixtures/react-parity/ag-ui-candidate',
      'scripts/react-parity/ag-ui-candidate-package.mjs',
      'scripts/react-parity/verify-ag-ui-candidate.mjs',
      'scripts/react-parity/native-mastra-runner.ts',
      'scripts/react-parity/verify-native-mastra.ts',
      'scripts/react-parity/native-ag-ui-browser.mjs',
      'deployments/ag-ui-mastra',
    ];
    const paths = [
      ...new Set(
        git(
          'ls-files',
          '-z',
          '--cached',
          '--others',
          '--exclude-standard',
          '--',
          ...scope
        )
          .split('\0')
          .filter(Boolean)
      ),
    ].sort();
    const provenance = {
      head: git('rev-parse', 'HEAD'),
      compiler: ts.version,
      packageLockSha256: sha256(readFileSync(join(root, 'package-lock.json'))),
      effectiveRanges: ranges,
      sources: paths.map((path) => ({
        path,
        sha256: sha256(readFileSync(join(root, path))),
      })),
      emission,
      tarballs: Object.entries(tarballs).map(([name, value]) => ({
        name,
        file: relative(temporary, value.slice(5)),
        sha256: sha256(readFileSync(value.slice(5))),
      })),
      node: {
        installation: nodeInstallation,
        artifacts: nodeArtifacts,
        result: nodeResult,
        types: nodeTypes,
        inputs: nodeInputs,
        ownerClient: ownerVersion(node),
      },
      installation,
      installed,
      types,
      ownerClient: ownerVersion(consumer),
      browser,
      provider,
    };
    writeJson(join(temporary, 'provenance.json'), provenance);
    success = true;
    console.log(
      JSON.stringify({
        mode: 'verified-ag-ui-candidate',
        modules: 21,
        tarballSha256: packed.sha256,
        node: nodeResult,
        ownerClient: provenance.ownerClient,
        browser: browser.result,
        provider: provider.result.scenarios,
        providerPosts: provider.result.providerPosts,
        retained: Boolean(retain),
      })
    );
    return { temporary, provenance };
  } finally {
    if (!retain || !success)
      rmSync(temporary, { recursive: true, force: true });
  }
}
export async function reviewCandidate(directory, signal) {
  assert.equal(signal.aborted, false, 'Candidate review startup aborted');
  directory = realpathSync(directory);
  const provenance = json(join(directory, 'provenance.json'));
  for (const tarball of provenance.tarballs) {
    const path = realpathSync(resolve(directory, tarball.file));
    assert.ok(path.startsWith(directory + '/'));
    assert.equal(sha256(readFileSync(path)), tarball.sha256);
  }
  for (const [folder, packages] of [
    ['node', provenance.node.artifacts],
    ['consumer', provenance.installed],
  ]) {
    for (const [name, files] of Object.entries(packages))
      assert.deepEqual(
        fileHashes(join(directory, folder, 'node_modules', name)),
        files,
        'Frozen installed package bytes unchanged'
      );
  }
  const bundle = readFileSync(join(directory, 'consumer/browser.js'), 'utf8');
  assert.equal(
    sha256(bundle),
    provenance.browser.bundleSha256,
    'Frozen candidate browser bytes unchanged'
  );
  const server = await createReviewServer({ bundle, provenance });
  try {
    console.log(
      JSON.stringify({
        mode: 'candidate-review',
        url: server.url,
        sequence,
        bundleSha256: provenance.browser.bundleSha256,
        tarballs: provenance.tarballs,
      })
    );
    if (!signal.aborted)
      await new Promise((resolve) =>
        signal.addEventListener('abort', resolve, { once: true })
      );
  } finally {
    await server.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (
      process.argv.length === 2 ||
      (process.argv.length === 4 && process.argv[2] === '--retain')
    )
      await verifyAgUiCandidate({ retain: process.argv[3] });
    else if (process.argv.length === 4 && process.argv[2] === '--review') {
      const controller = new AbortController(),
        stop = () => controller.abort();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      try {
        await reviewCandidate(process.argv[3], controller.signal);
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
    } else if (process.argv[2] === '--help' && process.argv.length === 3)
      console.log(
        `Prerequisites: ${buildCommand}; npm ci --prefix deployments/ag-ui-mastra --no-audit --no-fund\nVerify: node scripts/react-parity/verify-ag-ui-candidate.mjs [--retain NEW_DIRECTORY]\nReview retained bytes: --review DIRECTORY`
      );
    else
      throw new Error(
        'Expected no arguments, --retain NEW_DIRECTORY, --review DIRECTORY, or --help'
      );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
