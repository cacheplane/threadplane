#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import ts from 'typescript';
import { buildSync } from 'esbuild';
import {
  assertBackendGraph,
  assertCandidateComposition,
  candidateCompilerOptions,
  candidateViolations,
  emitCandidate,
  fileHashes,
  installCandidateConsumer,
  packCandidate,
  sha256,
} from './langgraph-candidate-package.mjs';
import {
  assertHeadlessInputs,
  packLocalArtifacts,
  runConsumer,
} from './verify-packages.mjs';
import {
  angularBuildCommand,
  lockedAngularManifest,
} from './verify-angular-package.mjs';
import {
  lockedReactManifest,
  prepareInstalledTypes,
  prepareRuntimeViews,
  runRuntimeScenarios,
  serveRuntimeConsumer,
} from './runtime-consumer.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const buildCommand =
  'NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p core,content,angular,react --skip-nx-cache --outputStyle=stream';

export function checkTypes(consumer, config) {
  consumer = realpathSync(consumer);
  const path = join(consumer, config);
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        );
      },
    }
  );
  assert.ok(parsed);
  assert.equal(parsed.options.skipLibCheck, false);
  assert.equal(
    parsed.options.paths,
    undefined,
    'Installed consumers have no workspace aliases'
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnostics(diagnostics, {
      getCurrentDirectory: () => consumer,
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n',
    })
  );
  return program
    .getSourceFiles()
    .filter((file) => file.fileName.startsWith(consumer + '/'))
    .map((file) => ({
      path: relative(consumer, file.fileName),
      sha256: sha256(readFileSync(file.fileName)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function directTypeProbes(root, consumer) {
  cpSync(
    join(root, 'fixtures/react-parity/langgraph-candidate/installed-types.ts'),
    join(consumer, 'candidate-types.ts')
  );
  const results = {};
  for (const mode of ['NodeNext', 'Bundler']) {
    const config = `tsconfig.candidate-${mode}.json`;
    writeJson(join(consumer, config), {
      compilerOptions: {
        target: 'ES2022',
        module: mode === 'NodeNext' ? 'NodeNext' : 'ESNext',
        moduleResolution: mode,
        lib: ['ES2022', 'DOM', 'ESNext.Disposable'],
        types: [],
        strict: true,
        skipLibCheck: false,
        noEmit: true,
      },
      files: ['candidate-types.ts'],
    });
    results[mode] = checkTypes(consumer, config);
  }
  return results;
}

function verifyNode(consumer) {
  const source = `import assert from 'node:assert/strict';
let calls = 0;
const original = globalThis.fetch;
globalThis.fetch = async () => { calls++; throw new Error('Unexpected candidate fetch'); };
try {
  const imported = await import('@threadplane/langgraph');
  assert.deepEqual(Object.keys(imported), ['createSession']);
  const session = imported.createSession({ assistantId: 'inert', threadId: 'fixed', apiUrl: 'http://127.0.0.1:1' });
  const snapshot = session.getSnapshot();
  assert.ok(Object.isFrozen(snapshot));
  let notifications = 0;
  const release = session.subscribe(() => notifications++);
  assert.equal(session.getSnapshot(), snapshot);
  release(); release();
  await session.dispose(); await session.dispose();
  assert.equal(session.getSnapshot(), snapshot);
  assert.equal(notifications, 0);
  assert.equal(calls, 0);
  console.log(JSON.stringify({ import: true, inertObservation: true, stable: true, fetches: calls }));
} finally { globalThis.fetch = original; }
`;
  writeFileSync(join(consumer, 'node-probe.mjs'), source);
  return JSON.parse(
    execFileSync(process.execPath, ['node-probe.mjs'], {
      cwd: consumer,
      encoding: 'utf8',
      timeout: 30000,
    })
  );
}

function backendGraph(consumer) {
  const built = buildSync({
    absWorkingDir: consumer,
    stdin: {
      contents: "export { createSession } from '@threadplane/langgraph';",
      resolveDir: consumer,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const inputs = Object.keys(built.metafile.inputs);
  assertBackendGraph(inputs);
  assert.ok(
    inputs.some((path) =>
      path.endsWith(
        'node_modules/@threadplane/langgraph/runtime/create-session.js'
      )
    )
  );
  return {
    inputs,
    bytes: built.outputFiles[0].contents.length,
    sha256: sha256(built.outputFiles[0].contents),
  };
}

function installedMatches(consumer, candidate) {
  const directory = join(consumer, 'node_modules/@threadplane/langgraph');
  assert.deepEqual(candidateViolations(directory), []);
  assert.deepEqual(
    fileHashes(directory),
    fileHashes(candidate),
    'Installed candidate exactly matches emitted package, including all declarations'
  );
}

async function frameworkConsumer(
  root,
  temporary,
  kind,
  tarballs,
  lock,
  candidate
) {
  const consumer = join(temporary, kind);
  mkdirSync(consumer);
  let manifest;
  if (kind === 'angular') {
    cpSync(join(root, 'fixtures/react-parity/consumers/angular'), consumer, {
      recursive: true,
    });
    manifest = lockedAngularManifest(
      readJson(join(consumer, 'package.json')),
      lock
    );
  } else manifest = lockedReactManifest(lock);
  const selected = Object.fromEntries(
    ['core', kind, 'langgraph'].map((name) => [
      `@threadplane/${name}`,
      tarballs[`@threadplane/${name}`],
    ])
  );
  const installation = installCandidateConsumer(
    consumer,
    manifest,
    selected,
    lock,
    kind
  );
  installedMatches(consumer, candidate);
  prepareInstalledTypes(root, consumer, kind);
  prepareRuntimeViews(root, consumer, kind);
  for (const name of [
    'tsconfig.contracts.json',
    kind === 'angular' ? 'tsconfig.json' : 'tsconfig.app.json',
  ]) {
    const path = join(consumer, name),
      config = readJson(path);
    writeJson(path, {
      ...config,
      compilerOptions: candidateCompilerOptions(config.compilerOptions),
    });
  }
  const destination = kind === 'angular' ? join(consumer, 'src') : consumer;
  cpSync(
    join(root, 'fixtures/react-parity/langgraph-candidate/runtime-entry.ts'),
    join(destination, 'runtime-entry.ts')
  );
  const directTypes = directTypeProbes(root, consumer);
  const bindingTypes = checkTypes(consumer, 'tsconfig.contracts.json');
  const appTypes = checkTypes(consumer, 'tsconfig.app.json');
  const rootProbe = buildSync({
    absWorkingDir: consumer,
    stdin: {
      contents: `import * as binding from '@threadplane/${kind}'; console.log(binding);`,
      resolveDir: consumer,
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  assertHeadlessInputs(rootProbe.metafile.inputs);
  let inputs, directory;
  if (kind === 'react') {
    writeFileSync(
      join(consumer, 'vite.candidate.config.mts'),
      `import base from './vite.config.mts';
import { writeFileSync } from 'node:fs';
export default { ...base, plugins: [...base.plugins, { name: 'candidate-provenance', generateBundle(_options, bundle) { const inputs = [...new Set(Object.values(bundle).flatMap(output => output.type === 'chunk' ? Object.keys(output.modules) : []))]; writeFileSync('candidate-inputs.json', JSON.stringify(inputs)); } }] };
`
    );
    console.log(
      runConsumer(
        process.execPath,
        [
          join(consumer, 'node_modules/vite/bin/vite.js'),
          'build',
          '--config',
          'vite.candidate.config.mts',
        ],
        consumer
      )
    );
    inputs = readJson(join(consumer, 'candidate-inputs.json'))
      .filter((path) => !path.startsWith('\0'))
      .map((path) =>
        path.startsWith(consumer + '/') ? relative(consumer, path) : path
      );
    directory = join(consumer, 'dist');
  } else {
    console.log(
      runConsumer(process.execPath, angularBuildCommand(consumer), consumer)
    );
    const stats = readJson(join(consumer, 'dist/consumer/stats.json'));
    inputs = Object.keys(stats.inputs);
    directory = join(consumer, 'dist/consumer/browser');
  }
  assertCandidateComposition(
    inputs,
    bindingTypes.map((file) => file.path)
  );
  assert.ok(
    inputs.some((path) => path.includes(`node_modules/@threadplane/${kind}/`)),
    'Actual installed binding used'
  );
  assert.ok(
    inputs.some((path) => path.includes('node_modules/@threadplane/core/')),
    'Actual installed core used'
  );
  const scenarios = await runRuntimeScenarios(directory, `Candidate ${kind}`);
  assert.equal(scenarios.length, 27, 'All original scenarios remain required');
  return {
    kind,
    directory: relative(temporary, directory),
    installation,
    directTypes,
    bindingTypes,
    appTypes,
    inputs,
    served: fileHashes(directory),
    scenarios,
  };
}

/** Full candidate proof; a retained directory is newly created and never overwrites user data. */
export async function verifyLangGraphCandidate({
  root = defaultRoot,
  retain,
} = {}) {
  root = resolve(root);
  for (const name of ['core', 'angular', 'react'])
    assert.ok(
      existsSync(join(root, 'dist/libs', name, 'package.json')),
      `Missing ${name}; run ${buildCommand}`
    );
  let temporary = retain
    ? resolve(retain)
    : mkdtempSync(join(tmpdir(), 'langgraph-candidate-'));
  if (retain) mkdirSync(temporary);
  temporary = realpathSync(temporary);
  let success = false;
  try {
    const candidate = join(temporary, 'candidate');
    const emission = emitCandidate(root, candidate);
    assert.equal(
      emission.sources.length,
      29,
      'Complete reviewed backend graph'
    );
    const packed = packCandidate(candidate, temporary);
    const tarballs = packLocalArtifacts(root, temporary, [
      'core',
      'react',
      'angular',
    ]);
    tarballs['@threadplane/langgraph'] = `file:${packed.tarball}`;
    const lock = readJson(join(root, 'package-lock.json'));
    const node = join(temporary, 'node');
    mkdirSync(node);
    const nodeInstallation = installCandidateConsumer(
      node,
      { private: true, type: 'module' },
      {
        '@threadplane/core': tarballs['@threadplane/core'],
        '@threadplane/langgraph': tarballs['@threadplane/langgraph'],
      },
      lock,
      'node'
    );
    installedMatches(node, candidate);
    const nodeProof = verifyNode(node),
      types = directTypeProbes(root, node),
      graph = backendGraph(node);
    const frameworks = [];
    for (const kind of ['react', 'angular'])
      frameworks.push(
        await frameworkConsumer(
          root,
          temporary,
          kind,
          tarballs,
          lock,
          candidate
        )
      );
    const git = (...args) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const scope = [
      'libs/langgraph/src/runtime',
      'libs/langgraph/src/lib/client',
      'libs/langgraph/src/lib/transport',
      'fixtures/react-parity/runtime',
      'fixtures/react-parity/langgraph-candidate',
      'scripts/react-parity/langgraph-candidate-package.mjs',
      'scripts/react-parity/verify-langgraph-candidate.mjs',
      'scripts/react-parity/runtime-consumer.mjs',
    ];
    const sources = [
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
    ]
      .sort()
      .map((path) => ({
        path,
        sha256: sha256(readFileSync(join(root, path))),
      }));
    const provenance = {
      head: git('rev-parse', 'HEAD'),
      sources,
      packageLockSha256: sha256(readFileSync(join(root, 'package-lock.json'))),
      compiler: ts.version,
      emission,
      tarballs: Object.entries(tarballs).map(([name, path]) => ({
        name,
        file: relative(temporary, path.slice(5)),
        sha256: sha256(readFileSync(path.slice(5))),
      })),
      node: { proof: nodeProof, installation: nodeInstallation, types, graph },
      frameworks,
    };
    writeJson(join(temporary, 'provenance.json'), provenance);
    success = true;
    console.log(
      JSON.stringify({
        mode: 'verified-candidate',
        modules: emission.sources.length,
        tarballSha256: packed.sha256,
        node: nodeProof,
        vendorVersions: nodeInstallation.vendors.map(
          (v) => `${v.name}@${v.version}`
        ),
        frameworks: frameworks.map((f) => ({
          kind: f.kind,
          scenarios: f.scenarios.length,
          served: f.served,
        })),
        retained: Boolean(retain),
      })
    );
    return { temporary, provenance };
  } finally {
    if (!retain || !success)
      rmSync(temporary, { recursive: true, force: true });
  }
}

/** Serve exactly the retained candidate-backed bytes without rebuilding or installing. */
export async function reviewCandidate(
  directory,
  signal,
  { serve = serveRuntimeConsumer, log = console.log } = {}
) {
  directory = realpathSync(directory);
  const provenance = readJson(join(directory, 'provenance.json'));
  for (const tarball of provenance.tarballs) {
    const path = realpathSync(resolve(directory, tarball.file));
    assert.ok(
      path.startsWith(directory + '/'),
      'Retained tarball remains inside the owned proof'
    );
    assert.equal(
      sha256(readFileSync(path)),
      tarball.sha256,
      'Frozen tarball unchanged'
    );
  }
  const servers = [];
  let failure;
  try {
    for (const framework of provenance.frameworks) {
      assert.equal(signal.aborted, false, 'Candidate review startup aborted');
      const output = resolve(directory, framework.directory);
      assert.ok(
        output.startsWith(directory + '/'),
        'Retained output remains inside the owned proof'
      );
      assert.deepEqual(
        fileHashes(output),
        framework.served,
        'Frozen served files unchanged'
      );
      const server = await serve(output);
      servers.push(server);
      log(
        JSON.stringify({
          mode: 'candidate-review',
          framework: framework.kind,
          url: server.url,
          served: framework.served,
          tarballs: provenance.tarballs,
          head: provenance.head,
        })
      );
    }
    log(
      'Use the full existing main sequence; /?threads and /?checkpoints have their own sequences. These fresh servers reuse frozen candidate builds. Reload does not reset their counters; restart --review for a fresh walkthrough. Ctrl+C closes only these servers.'
    );
    if (!signal.aborted)
      await new Promise((resolve) =>
        signal.addEventListener('abort', resolve, { once: true })
      );
  } catch (error) {
    failure = error;
  }
  const closed = await Promise.allSettled(
    servers.map((server) => server.close())
  );
  const failures = closed
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length)
    throw new AggregateError(
      failure ? [failure, ...failures] : failures,
      'Candidate review cleanup failed'
    );
  if (failure) throw failure;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv[2] === '--review' && process.argv.length === 4) {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      try {
        await reviewCandidate(process.argv[3], controller.signal);
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
    } else if (
      process.argv.length === 2 ||
      (process.argv[2] === '--retain' && process.argv.length === 4)
    ) {
      await verifyLangGraphCandidate({ retain: process.argv[3] });
    } else if (process.argv[2] === '--help' && process.argv.length === 3) {
      console.log(
        `Prerequisite: ${buildCommand}\nVerify: node scripts/react-parity/verify-langgraph-candidate.mjs\nRetain a verified new directory: --retain /tmp/candidate-proof\nServe frozen builds: --review /tmp/candidate-proof`
      );
    } else
      throw new Error(
        'Expected no arguments, --retain NEW_DIRECTORY, --review DIRECTORY, or --help'
      );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
