import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import {
  fileHashes,
  filesIn,
  lockedVendorGraph,
  sha256,
  vendorOverrides,
} from './langgraph-candidate-package.mjs';
import { installFootprint, runConsumer } from './verify-packages.mjs';

export const entry = 'fixtures/react-parity/ag-ui-candidate/entry';
export const factory = 'libs/ag-ui/src/runtime/create-session';
export const projector = 'libs/ag-ui/src/runtime/text-transcript';
const bareImports = new Set(['@threadplane/core', '@ag-ui/client']);
const seeds = ['@ag-ui/client'];
export function candidateManifest(version, coreVersion, sdkVersion) {
  return {
    name: '@threadplane/ag-ui',
    version,
    private: true,
    type: 'module',
    exports: {
      '.': {
        types: `./${entry}.d.ts`,
        import: `./${entry}.js`,
        default: `./${entry}.js`,
      },
    },
    files: [
      entry + '.js',
      entry + '.d.ts',
      'libs/ag-ui/src/**/*.js',
      'libs/ag-ui/src/**/*.d.ts',
    ],
    dependencies: {
      '@threadplane/core': coreVersion,
      '@ag-ui/client': sdkVersion,
    },
  };
}
function forwarding(source, declaration) {
  const parsed = ts.createSourceFile(
    'entry.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const names = [];
  for (const statement of parsed.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    )
      return false;
    for (const name of statement.exportClause.elements) {
      if (name.propertyName) return false;
      const expected = ['createSession', 'Session', 'SessionOptions'].includes(
        name.name.text
      )
        ? factory
        : projector;
      if (statement.moduleSpecifier.text !== '../../../' + expected + '.js')
        return false;
      const typeOnly = statement.isTypeOnly || name.isTypeOnly;
      if (
        typeOnly !==
        ['Session', 'SessionOptions', 'TextTranscriptRow'].includes(
          name.name.text
        )
      )
        return false;
      names.push(name.name.text);
    }
  }
  return (
    JSON.stringify(names.sort()) ===
    JSON.stringify(
      (declaration
        ? [
            'createSession',
            'Session',
            'SessionOptions',
            'projectTextTranscript',
            'TextTranscriptRow',
          ]
        : ['createSession', 'projectTextTranscript']
      ).sort()
    )
  );
}
export function candidateViolations(directory) {
  const errors = [];
  const manifest = JSON.parse(
    readFileSync(join(directory, 'package.json'), 'utf8')
  );
  const expected = candidateManifest(
    manifest.version,
    manifest.dependencies?.['@threadplane/core'],
    manifest.dependencies?.['@ag-ui/client']
  );
  if (
    manifest.name !== expected.name ||
    manifest.private !== true ||
    manifest.type !== 'module'
  )
    errors.push('Invalid private candidate identity');
  if (
    JSON.stringify(manifest.exports) !== JSON.stringify(expected.exports) ||
    JSON.stringify(manifest.files) !== JSON.stringify(expected.files)
  )
    errors.push('Invalid candidate entry or files');
  if (
    Object.keys(manifest.dependencies ?? {})
      .sort()
      .join() !== '@ag-ui/client,@threadplane/core'
  )
    errors.push('Forbidden candidate dependency');
  if (
    manifest.scripts ||
    manifest.peerDependencies ||
    manifest.optionalDependencies
  )
    errors.push('Unexpected candidate install metadata');
  for (const path of [entry, factory, projector])
    for (const suffix of ['.js', '.d.ts']) {
      const target = join(directory, path + suffix);
      if (!existsSync(target)) errors.push(`Missing emitted ${path}${suffix}`);
      else if (
        path === entry &&
        !forwarding(readFileSync(target, 'utf8'), suffix === '.d.ts')
      )
        errors.push(
          `Candidate root must use direct forwarding in ${path}${suffix}`
        );
    }
  for (const path of filesIn(directory)) {
    const name = relative(directory, path);
    if (name === 'package.json') continue;
    if (
      !(
        name === entry + '.js' ||
        name === entry + '.d.ts' ||
        /^libs\/ag-ui\/src\/.*\.(?:js|d\.ts)$/.test(name)
      ) ||
      /\.(?:spec|test|type-test)\./.test(name) ||
      /\/testing\//.test(name)
    ) {
      errors.push(`Unexpected candidate file ${name}`);
      continue;
    }
    for (const imported of ts.preProcessFile(
      readFileSync(path, 'utf8'),
      true,
      true
    ).importedFiles) {
      const specifier = imported.fileName;
      if (!specifier.startsWith('.')) {
        if (!bareImports.has(specifier))
          errors.push(`Forbidden candidate import ${specifier}`);
        continue;
      }
      if (!specifier.endsWith('.js')) {
        errors.push(`Extensionless candidate edge ${name}: ${specifier}`);
        continue;
      }
      const target = resolve(dirname(path), specifier);
      if (!target.startsWith(resolve(directory) + '/')) {
        errors.push(`Escaped candidate import ${specifier}`);
        continue;
      }
      const output = path.endsWith('.d.ts')
        ? target.slice(0, -3) + '.d.ts'
        : target;
      if (!existsSync(output))
        errors.push(`Missing emitted ${relative(directory, output)}`);
    }
  }
  return errors;
}
export function emitCandidate(root, directory) {
  const core = join(root, 'dist/libs/core');
  assert.ok(
    existsSync(join(core, 'package.json')),
    'Build core before emitting the AG-UI candidate'
  );
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
    strict: true,
    skipLibCheck: false,
    declaration: true,
    rootDir: root,
    outDir: directory,
    noEmitOnError: true,
  };
  const host = ts.createCompilerHost(options);
  host.resolveModuleNames = (names, containingFile) =>
    names.map((name) =>
      name === '@threadplane/core'
        ? {
            resolvedFileName: join(core, 'src/index.d.ts'),
            extension: ts.Extension.Dts,
            isExternalLibraryImport: true,
          }
        : ts.resolveModuleName(name, containingFile, options, ts.sys)
            .resolvedModule
    );
  const program = ts.createProgram([join(root, entry + '.ts')], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnostics(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (path) => path,
      getNewLine: () => '\n',
    })
  );
  const sources = program
    .getSourceFiles()
    .filter(
      (file) =>
        !file.isDeclarationFile &&
        !program.isSourceFileFromExternalLibrary(file)
    )
    .map((file) => ({
      path: relative(root, file.fileName),
      sha256: sha256(readFileSync(file.fileName)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  assert.ok(
    sources.every(
      (file) =>
        file.path === entry + '.ts' || file.path.startsWith('libs/ag-ui/src/')
    ),
    'Only actual AG-UI and the direct fixture entry are emitted'
  );
  assert.equal(program.emit().emitSkipped, false);
  const lock = JSON.parse(
    readFileSync(join(root, 'package-lock.json'), 'utf8')
  );
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify(
      candidateManifest(
        JSON.parse(readFileSync(join(root, 'libs/ag-ui/package.json'), 'utf8'))
          .version,
        JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')).version,
        lock.packages['node_modules/@ag-ui/client'].version
      ),
      null,
      2
    ) + '\n'
  );
  return {
    sources,
    files: fileHashes(directory),
    diagnostics: diagnostics.length,
  };
}
export function packCandidate(directory, destination) {
  assert.deepEqual(candidateViolations(directory), []);
  const [packed] = JSON.parse(
    runConsumer(
      'npm',
      [
        'pack',
        directory,
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        destination,
      ],
      destination
    )
  );
  const tarball = join(destination, packed.filename),
    unpacked = join(destination, 'unpacked-ag-ui');
  mkdirSync(unpacked);
  execFileSync('tar', ['-xzf', tarball, '-C', unpacked]);
  assert.deepEqual(candidateViolations(join(unpacked, 'package')), []);
  assert.deepEqual(
    fileHashes(join(unpacked, 'package')),
    fileHashes(directory)
  );
  return {
    tarball,
    sha256: sha256(readFileSync(tarball)),
    files: packed.files.map((file) => file.path).sort(),
  };
}
export function installViolations(lock, localNames, mixed = false) {
  const errors = [];
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (!path.includes('node_modules/')) continue;
    const name = path.split('node_modules/').at(-1);
    if (
      name.startsWith('@threadplane/') &&
      (!localNames.includes(name) ||
        pkg.link ||
        !/^file:.*\.tgz$/.test(pkg.resolved ?? ''))
    )
      errors.push(`${name} must use its local tarball`);
    if (
      !mixed &&
      (name.startsWith('@angular/') ||
        ['react', 'react-dom', '@types/react', '@types/react-dom'].includes(
          name
        ))
    )
      errors.push(`Backend installed framework ${name}`);
    if (
      name.startsWith('@langchain/') ||
      name === '@ag-ui/mastra' ||
      name.startsWith('@mastra/')
    )
      errors.push(`Unrelated owner vendor ${name}`);
  }
  return errors;
}
export function rootRangeOverrides(root) {
  const overrides = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8')
  ).overrides;
  assert.deepEqual(
    overrides,
    { rxjs: '~7.8.0' },
    'Review any change to the existing supported root override policy'
  );
  return overrides;
}
export function agUiVendorOverrides(vendors) {
  const names = vendors.map((vendor) => vendor.name);
  assert.equal(
    new Set(names).size,
    names.length,
    'Review multiple versions of an AG-UI vendor before pinning'
  );
  // Pin shared vendors at every root as well as below their declared parents.
  // npm can otherwise hoist a shared proto dependency outside a seed-only pin.
  // Keep these unique-version root pins unqualified so the existing RxJS
  // override also applies to the SDK's original, different exact request.
  const pins = vendorOverrides(vendors, names);
  return Object.fromEntries(
    vendors.map(({ name, version }) => [name, pins[`${name}@${version}`]])
  );
}
export function consumerVendorGraph(lock, manifest, effectiveRanges = {}) {
  const roots = [
    ...new Set([
      ...seeds,
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]),
  ].filter((name) => !name.startsWith('@threadplane/'));
  return lockedVendorGraph(lock, roots, effectiveRanges);
}
export function installCandidate(
  consumer,
  manifest,
  tarballs,
  rootLock,
  mixed = false,
  effectiveRanges = {}
) {
  const vendors = lockedVendorGraph(rootLock, seeds, effectiveRanges);
  const consumerVendors = consumerVendorGraph(
    rootLock,
    manifest,
    effectiveRanges
  );
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        ...manifest,
        dependencies: { ...manifest.dependencies, ...tarballs },
        overrides: {
          ...agUiVendorOverrides(consumerVendors),
          ...Object.fromEntries(
            Object.keys(tarballs).map((name) => [name, `$${name}`])
          ),
        },
      },
      null,
      2
    )
  );
  console.log(
    runConsumer(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      consumer
    )
  );
  const lock = JSON.parse(
    readFileSync(join(consumer, 'package-lock.json'), 'utf8')
  );
  assert.deepEqual(installViolations(lock, Object.keys(tarballs), mixed), []);
  assert.deepEqual(
    lockedVendorGraph(lock, seeds, effectiveRanges),
    vendors,
    'Installed owner preserves its exact locked vendor graph'
  );
  assert.deepEqual(
    consumerVendorGraph(lock, manifest, effectiveRanges),
    consumerVendors,
    'Installed framework and type roots preserve their exact locked vendor graph'
  );
  return {
    vendors,
    consumerVendors,
    effectiveRanges,
    footprint: installFootprint(consumer, lock),
    versions: Object.entries(lock.packages)
      .filter(([path]) => path.includes('node_modules/'))
      .map(([path, pkg]) => ({ path, version: pkg.version })),
  };
}
/** Check package containment and bytes, including legitimate emitted libs/ag-ui/src paths. */
export function assertInstalledInputs(consumer, inputs, artifacts) {
  consumer = realpathSync(consumer);
  for (const input of inputs) {
    if (input.startsWith('\0') || input.startsWith('<')) continue;
    const path = realpathSync(resolve(consumer, input));
    assert.ok(
      path.startsWith(consumer + '/'),
      `Input outside installed consumer: ${input}`
    );
    const relativePath = relative(consumer, path);
    const matched = relativePath.match(
      /^node_modules\/(@threadplane\/[^/]+)\/(.+)$/
    );
    if (matched) {
      const [, name, file] = matched;
      const expected = artifacts[name]?.find((record) => record.path === file);
      assert.ok(expected, `Input not in installed artifact: ${input}`);
      assert.ok(
        realpathSync(path).startsWith(
          join(consumer, 'node_modules', name) + '/'
        ),
        'Installed input cannot link to private source'
      );
      assert.equal(
        sha256(readFileSync(path)),
        expected.sha256,
        `Installed artifact bytes differ: ${input}`
      );
    } else
      assert.ok(
        !relativePath.startsWith('libs/') && !relativePath.startsWith('dist/'),
        `Input outside installed artifacts: ${input}`
      );
  }
}
