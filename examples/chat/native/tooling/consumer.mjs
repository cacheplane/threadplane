import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { foundationCommands, preparationEnvironment } from './commands.mjs';
import { mirrorDestination, excludedSourcePath } from './source-policy.mjs';
import { createBuildWorkspace, inputFingerprint } from './build-workspace.mjs';
export { buildInputRoots, inputFingerprint } from './build-workspace.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
function files(directory) {
  assert.equal(
    lstatSync(directory).isSymbolicLink(),
    false,
    `No source links: ${directory}`
  );
  if (!lstatSync(directory).isDirectory()) return [directory];
  return readdirSync(directory)
    .sort()
    .flatMap((name) => files(join(directory, name)));
}
function hashes(directory) {
  return Object.fromEntries(
    files(directory).map((path) => [
      relative(directory, path).replaceAll('\\', '/'),
      digest(readFileSync(path)),
    ])
  );
}

export function copyApplication(root, consumer, { assistantId = '' } = {}) {
  const native = 'examples/chat/native/';
  function sourcePath(local) {
    let path = root;
    for (const part of local.split('/').filter(Boolean)) {
      path = join(path, part);
      if (existsSync(path))
        assert.equal(
          lstatSync(path).isSymbolicLink(),
          false,
          `No source links: ${path}`
        );
    }
    return path;
  }
  function copyAuthored(local) {
    if (excludedSourcePath(local)) return;
    const source = sourcePath(local);
    if (!existsSync(source)) return;
    const info = lstatSync(source);
    assert.equal(info.isSymbolicLink(), false, `No source links: ${source}`);
    if (info.isDirectory()) {
      for (const name of readdirSync(source).sort())
        copyAuthored(local + '/' + name);
      return;
    }
    const target = mirrorDestination(local);
    if (!target) return;
    assert.ok(info.isFile(), `Only regular source files: ${source}`);
    mkdirSync(dirname(join(consumer, target)), { recursive: true });
    cpSync(source, join(consumer, target));
  }
  mkdirSync(join(consumer, 'react'), { recursive: true });
  for (const name of ['src', 'public', 'index.html'])
    copyAuthored(native + 'react/' + name);
  for (const name of [
    'vite.config.mts',
    'tsconfig.json',
    'tsconfig.app.json',
  ]) {
    const source = sourcePath(native + 'react/' + name);
    files(source);
    cpSync(source, join(consumer, 'react', name));
  }
  mkdirSync(join(consumer, 'shared'), { recursive: true });
  copyAuthored(native + 'shared');
  copyAuthored('libs/design-tokens/src/lib/tokens.css');
  writeJson(join(consumer, 'shared/browser-config.json'), {
    assistantId,
    apiBase: '/api',
  });
  return {
    ...Object.fromEntries(
      Object.entries(hashes(join(consumer, 'react'))).map(([path, hash]) => [
        'react/' + path,
        hash,
      ])
    ),
    ...Object.fromEntries(
      Object.entries(hashes(join(consumer, 'shared'))).map(([path, hash]) => [
        'shared/' + path,
        hash,
      ])
    ),
  };
}

function run(command, args, cwd, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: preparationEnvironment(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0)
    throw new Error(
      `${command} failed (${result.status})\n${result.stdout}\n${result.stderr}`
    );
  return result;
}

function compiler(consumer, allowFailure = false) {
  return run(
    process.execPath,
    [
      join(consumer, 'node_modules/typescript/bin/tsc'),
      '--project',
      'tsconfig.app.json',
      '--listFiles',
      '--pretty',
      'false',
    ],
    join(consumer, 'react'),
    { allowFailure }
  );
}

export function compileApplication({ consumer }) {
  const initial = compiler(consumer);
  const inputs = initial.stdout
    .split(/\r?\n/)
    .filter((line) => isAbsolute(line));
  for (const path of inputs)
    assert.ok(
      realpathSync(path).startsWith(realpathSync(consumer) + sep),
      `Compiler input escapes installed consumer: ${path}`
    );
  const negativePath = join(consumer, 'react/src/__snapshot-negative.tsx');
  assert.equal(existsSync(negativePath), false);
  let diagnostic;
  try {
    writeFileSync(
      negativePath,
      'import { Markdown } from \'@threadplane/react/markdown\';\nexport const negative = <Markdown snapshot="invalid snapshot" />;\n'
    );
    const negative = compiler(consumer, true);
    diagnostic = negative.stdout + negative.stderr;
    assert.notEqual(
      negative.status,
      0,
      'Invalid Markdown snapshot must fail the installed compiler'
    );
    assert.doesNotMatch(
      diagnostic,
      /Cannot find module|Could not resolve|TS2307/
    );
    assert.match(
      diagnostic,
      /__snapshot-negative\.tsx.*TS2322: Type 'string' is not assignable to type 'MarkdownSnapshot'/
    );
  } finally {
    rmSync(negativePath, { force: true });
  }
  compiler(consumer); // Restoration must be green using the same installed CLI.
  return {
    version: json(join(consumer, 'node_modules/typescript/package.json'))
      .version,
    executable: 'node_modules/typescript/bin/tsc',
    executableSha256: digest(
      readFileSync(join(consumer, 'node_modules/typescript/bin/tsc'))
    ),
    inputs: Object.fromEntries(
      inputs.map((path) => [
        relative(consumer, path).replaceAll('\\', '/'),
        digest(readFileSync(path)),
      ])
    ),
    negativeSnapshot: {
      code: 'TS2322',
      expectedType: 'MarkdownSnapshot',
      restored: true,
    },
  };
}

function assertComposition(consumer, typeInputs, runtimeInputs) {
  const types = Object.keys(typeInputs);
  for (const path of [...types, ...runtimeInputs]) {
    assert.ok(
      !path.split('/').includes('..') && !isAbsolute(path),
      `Input outside consumer: ${path}`
    );
    assert.doesNotMatch(
      path,
      /(?:^|\/)(?:libs\/|fixtures\/|node_modules\/(?:@angular\/|@threadplane\/(?:angular|chat|telemetry|render|a2ui)\/))|(?:fesm\d*|runtime-entry)\//,
      `Forbidden application input: ${path}`
    );
    assert.ok(
      existsSync(join(consumer, path)),
      `Build input must exist: ${path}`
    );
  }
  for (const suffix of [
    '@threadplane/langgraph/runtime/create-session',
    '@threadplane/react/src/use-agent',
    '@threadplane/react/src/markdown/markdown',
    '@threadplane/content/src/markdown/create-markdown',
  ]) {
    assert.ok(
      types.includes('node_modules/' + suffix + '.d.ts'),
      `Installed declarations required: ${suffix}`
    );
    assert.ok(
      runtimeInputs.includes('node_modules/' + suffix + '.js'),
      `Installed runtime required: ${suffix}`
    );
  }
}

export async function productionOperations(buildRoot) {
  const [
    { emitCandidate, packCandidate },
    { packLocalArtifacts },
    { installPresentationConsumer, reactLanggraphPresentationSeeds },
  ] = await Promise.all([
    import(
      pathToFileURL(
        join(buildRoot, 'scripts/react-parity/langgraph-candidate-package.mjs')
      ).href
    ),
    import(
      pathToFileURL(join(buildRoot, 'scripts/react-parity/verify-packages.mjs'))
        .href
    ),
    import(
      pathToFileURL(
        join(buildRoot, 'scripts/react-parity/markdown-presentation-build.mjs')
      ).href
    ),
  ]);
  return {
    build({ buildRoot }) {
      for (const { command, args, cwd } of foundationCommands(buildRoot)) {
        console.log(`Building ${args[2]} from frozen inputs`);
        const result = run(command, args, cwd);
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
      }
    },
    pack({ buildRoot, temporary }) {
      const candidate = join(temporary, 'candidate');
      mkdirSync(candidate);
      const emission = emitCandidate(buildRoot, candidate);
      const packed = packCandidate(candidate, temporary);
      const tarballs = {
        ...packLocalArtifacts(buildRoot, temporary, ['react']),
        '@threadplane/langgraph': 'file:' + packed.tarball,
      };
      return {
        tarballs,
        emission,
        hashes: Object.fromEntries(
          Object.entries(tarballs).map(([name, path]) => [
            name,
            digest(readFileSync(path.slice(5))),
          ])
        ),
      };
    },
    install({ buildRoot, consumer, packages }) {
      return installPresentationConsumer(
        consumer,
        json(join(buildRoot, 'package-lock.json')),
        packages.tarballs,
        {
          seeds: reactLanggraphPresentationSeeds,
          profile: 'react-langgraph',
          env: preparationEnvironment(),
        }
      );
    },
    compile: compileApplication,
    bundle({ consumer, configuration, compilation }) {
      const result = run(
        process.execPath,
        [
          join(consumer, 'node_modules/vite/bin/vite.js'),
          'build',
          '--config',
          'vite.config.mts',
          '--mode',
          configuration,
        ],
        join(consumer, 'react')
      );
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      const output = join(consumer, 'react/dist');
      const inputs = json(join(output, 'build-inputs.json'));
      assertComposition(consumer, compilation.inputs, inputs);
      return {
        output,
        inputs: Object.fromEntries(
          inputs.map((path) => [
            path,
            digest(readFileSync(join(consumer, path))),
          ])
        ),
      };
    },
  };
}

// Build and serve share selected packs and root-lock installation. The caller
// owns this directory and its lifetime; a worker must never remove it.
export async function prepareConsumer({
  root,
  temporary,
  configuration = 'development',
  assistantId = '',
  operations,
  unchanged = () => {},
}) {
  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  const initialFiles = copyApplication(root, consumer, { assistantId });
  const buildRoot = join(temporary, 'build-workspace');
  const workspace = createBuildWorkspace(root, buildRoot);
  const context = { root, buildRoot, temporary, consumer, configuration };
  const stages =
    typeof operations === 'function'
      ? await operations(context)
      : operations ?? (await productionOperations(buildRoot));
  unchanged();
  await stages.build(context);
  workspace.unchanged();
  unchanged();
  const packages = await stages.pack(context);
  workspace.unchanged();
  unchanged();
  const installation = await stages.install({ ...context, packages });
  unchanged();
  return {
    context,
    initialFiles,
    stages,
    packages,
    installation,
    buildInputs: workspace.inputs,
  };
}

// All stages run against owned temporary paths. The previous valid publication
// remains intact through installation, diagnostics and bundle validation.
export async function buildConsumer({
  root,
  configuration = 'production',
  assistantId = '',
  output = join(root, 'dist/examples/chat/native/react'),
  temporaryParent = tmpdir(),
  operations,
  capture,
}) {
  const inputs = inputFingerprint(root);
  const unchanged = () =>
    assert.deepEqual(
      inputFingerprint(root),
      inputs,
      'Build inputs changed during preparation; retry with stable sources'
    );
  const temporary = realpathSync(
    mkdtempSync(join(temporaryParent, 'native-conversation-'))
  );
  let staging;
  let backup;
  let captured;
  try {
    const {
      context,
      initialFiles: copied,
      stages,
      packages,
      installation,
      buildInputs,
    } = await prepareConsumer({
      root,
      temporary,
      configuration,
      assistantId,
      operations,
      unchanged,
    });
    const compilation = await stages.compile(context);
    const bundle = await stages.bundle({ ...context, compilation });
    unchanged();
    const provenance = {
      configuration,
      inputs,
      buildInputs,
      copied,
      packages: packages.hashes,
      candidate: packages.emission,
      installation,
      compiler: compilation,
      bundler: { inputs: bundle.inputs },
      outputs: hashes(bundle.output),
    };
    captured = await capture?.({
      ...context,
      packages,
      installation,
      compilation,
      bundle,
      provenance,
    });
    unchanged();
    mkdirSync(dirname(output), { recursive: true });
    staging = mkdtempSync(join(dirname(output), '.native-react-staging-'));
    cpSync(bundle.output, staging, { recursive: true });
    writeJson(join(staging, 'provenance.json'), provenance);
    unchanged();
    if (existsSync(output)) {
      backup = staging + '-previous';
      renameSync(output, backup);
    }
    try {
      renameSync(staging, output);
    } catch (error) {
      if (backup) renameSync(backup, output);
      throw error;
    }
    if (backup) rmSync(backup, { recursive: true, force: true });
    console.log(`Built native conversation (${configuration}): ${output}`);
    return { output, provenance };
  } catch (error) {
    // A successfully captured directory is provisional until publication.
    await captured?.discard?.();
    throw error;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

// Tests reuse the selected build/pack/locked installation, but emit into a
// disposable test graph. Neither test support nor Node types enter the app.
export async function testConsumer({
  root,
  configuration,
  assistantId,
  testNamePattern,
}) {
  const inputs = inputFingerprint(root);
  const unchanged = () =>
    assert.deepEqual(
      inputFingerprint(root),
      inputs,
      'Test inputs changed during preparation; retry with stable sources'
    );
  const temporary = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-conversation-test-'))
  );
  try {
    const {
      context: { consumer },
    } = await prepareConsumer({
      root,
      temporary,
      configuration,
      assistantId,
      unchanged,
    });
    const native = join(root, 'examples/chat/native');
    cpSync(
      join(native, 'tsconfig.test.json'),
      join(consumer, 'tsconfig.test.json')
    );
    mkdirSync(join(consumer, 'tooling'));
    cpSync(
      join(native, 'tooling/proof-server.mjs'),
      join(consumer, 'tooling/proof-server.mjs')
    );
    const compilation = run(
      process.execPath,
      [
        join(consumer, 'node_modules/typescript/bin/tsc'),
        '--project',
        'tsconfig.test.json',
        '--listFiles',
        '--pretty',
        'false',
      ],
      consumer
    );
    const typeInputs = compilation.stdout.split(/\r?\n/).filter(isAbsolute);
    for (const path of typeInputs)
      assert.ok(
        realpathSync(path).startsWith(consumer + sep),
        `Test compiler input escapes installed consumer: ${path}`
      );
    assert.ok(
      typeInputs.includes(
        join(consumer, 'node_modules/@langchain/langgraph-sdk/dist/index.d.ts')
      )
    );
    console.log(
      `Installed test compiler: TypeScript ${
        json(join(consumer, 'node_modules/typescript/package.json')).version
      }; SDK ${
        json(
          join(consumer, 'node_modules/@langchain/langgraph-sdk/package.json')
        ).version
      }; ${typeInputs.length} isolated inputs`
    );
    const specs = files(join(consumer, 'test-output/shared')).filter((path) =>
      path.endsWith('.spec.js')
    );
    assert.ok(specs.length, 'Emitted tests are required');
    unchanged();
    const result = run(
      process.execPath,
      [
        '--test',
        ...(testNamePattern === undefined
          ? []
          : ['--test-name-pattern', testNamePattern]),
        ...specs,
      ],
      consumer,
      { allowFailure: true }
    );
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    assert.equal(
      result.status,
      0,
      'Installed native conversation tests failed'
    );
    unchanged();
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    assert.ok(['--worker', '--test-worker'].includes(process.argv[2]));
    assert.equal(process.argv.length, 5);
    assert.equal(
      process.env.NATIVE_LANGGRAPH_API_KEY,
      '',
      'Use the sanitized build launcher'
    );
    const root = resolve(process.argv[3]);
    const execute =
      process.argv[2] === '--test-worker' ? testConsumer : buildConsumer;
    await execute({ root, ...JSON.parse(process.argv[4]) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
