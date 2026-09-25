import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { satisfies } from 'semver';
import { installFootprint, runConsumer } from './verify-packages.mjs';

const entry = 'runtime/create-session';
const directImports = new Set([
  '@threadplane/core',
  '@threadplane/core/tools',
  '@langchain/langgraph-sdk',
]);
export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
export function candidateCompilerOptions(options) {
  return {
    ...options,
    lib: [
      ...new Set([...(options.lib ?? ['ES2022', 'DOM']), 'ESNext.Disposable']),
    ],
  };
}
export function filesIn(directory) {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = join(directory, name);
      assert.equal(
        lstatSync(path).isSymbolicLink(),
        false,
        'candidate files cannot be symlinks'
      );
      return lstatSync(path).isDirectory() ? filesIn(path) : [path];
    })
    .sort();
}
export function fileHashes(directory) {
  return filesIn(directory).map((path) => ({
    path: relative(directory, path),
    sha256: sha256(readFileSync(path)),
  }));
}
export function candidateManifest(version, coreVersion, sdkVersion) {
  return {
    name: '@threadplane/langgraph',
    version,
    private: true,
    type: 'module',
    files: [
      'runtime/**/*.js',
      'runtime/**/*.d.ts',
      'lib/**/*.js',
      'lib/**/*.d.ts',
    ],
    exports: {
      '.': {
        types: `./${entry}.d.ts`,
        import: `./${entry}.js`,
        default: `./${entry}.js`,
      },
    },
    dependencies: {
      '@threadplane/core': coreVersion,
      '@langchain/langgraph-sdk': sdkVersion,
    },
  };
}
export function candidateViolations(directory) {
  const errors = [];
  const manifest = JSON.parse(
    readFileSync(join(directory, 'package.json'), 'utf8')
  );
  if (
    manifest.name !== '@threadplane/langgraph' ||
    manifest.private !== true ||
    manifest.type !== 'module'
  )
    errors.push('Invalid private candidate identity');
  const expected = candidateManifest(
    manifest.version,
    manifest.dependencies?.['@threadplane/core'],
    manifest.dependencies?.['@langchain/langgraph-sdk']
  );
  if (JSON.stringify(manifest.exports) !== JSON.stringify(expected.exports))
    errors.push('Candidate exports must point directly to the real factory');
  if (JSON.stringify(manifest.files) !== JSON.stringify(expected.files))
    errors.push('Candidate files must contain only emitted graph');
  if (
    Object.keys(manifest.dependencies ?? {})
      .sort()
      .join() !== '@langchain/langgraph-sdk,@threadplane/core'
  )
    errors.push('Forbidden candidate dependency');
  if (
    manifest.scripts ||
    manifest.peerDependencies ||
    manifest.optionalDependencies
  )
    errors.push('Unexpected candidate install metadata');
  for (const extension of ['.js', '.d.ts'])
    if (!existsSync(join(directory, entry + extension)))
      errors.push(`Missing emitted ${entry}${extension}`);
  for (const path of filesIn(directory)) {
    const name = relative(directory, path);
    if (name === 'package.json') continue;
    if (!/^(?:runtime|lib)\/.*\.(?:js|d\.ts)$/.test(name)) {
      errors.push(`Unexpected candidate file ${name}`);
      continue;
    }
    const source = readFileSync(path, 'utf8');
    for (const imported of ts.preProcessFile(source, true, true)
      .importedFiles) {
      const specifier = imported.fileName;
      if (!specifier.startsWith('.')) {
        if (!directImports.has(specifier))
          errors.push(`Forbidden candidate import ${specifier} in ${name}`);
        continue;
      }
      const declarationEdge = specifier.endsWith('.d.ts');
      if (declarationEdge && !path.endsWith('.d.ts')) {
        errors.push(
          `Forbidden declaration edge in JavaScript ${name}: ${specifier}`
        );
        continue;
      }
      if (!specifier.endsWith('.js') && !declarationEdge) {
        errors.push(`Extensionless candidate edge ${name}: ${specifier}`);
        continue;
      }
      const target = resolve(dirname(path), specifier);
      if (!target.startsWith(resolve(directory) + '/')) {
        errors.push(`Escaped candidate path ${specifier}`);
        continue;
      }
      const resolved =
        path.endsWith('.d.ts') && !declarationEdge
          ? target.slice(0, -3) + '.d.ts'
          : target;
      if (!existsSync(resolved))
        errors.push(
          `Missing emitted ${relative(directory, resolved)} from ${name}`
        );
    }
  }
  return errors;
}

/** Ordinary compiler output; only core resolution points at real built declarations. */
export function emitCandidate(root, directory) {
  const sourceRoot = join(root, 'libs/langgraph/src');
  const core = join(root, 'dist/libs/core');
  assert.ok(
    existsSync(join(core, 'package.json')),
    'Build core before emitting the candidate'
  );
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.esnext.disposable.d.ts', 'lib.dom.d.ts'],
    types: [],
    strict: true,
    skipLibCheck: false,
    declaration: true,
    rootDir: sourceRoot,
    outDir: directory,
    noEmitOnError: true,
  };
  const host = ts.createCompilerHost(options);
  host.resolveModuleNames = (names, containingFile) =>
    names.map((name) => {
      if (name === '@threadplane/core' || name === '@threadplane/core/tools')
        return {
          resolvedFileName: join(
            core,
            name.endsWith('/tools') ? 'src/tools/index.d.ts' : 'src/index.d.ts'
          ),
          extension: ts.Extension.Dts,
          isExternalLibraryImport: true,
        };
      return ts.resolveModuleName(name, containingFile, options, ts.sys)
        .resolvedModule;
    });
  const program = ts.createProgram(
    [join(sourceRoot, entry + '.ts')],
    options,
    host
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnostics(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n',
    })
  );
  const sources = program
    .getSourceFiles()
    .filter(
      (file) =>
        !file.isDeclarationFile &&
        !program.isSourceFileFromExternalLibrary(file)
    );
  assert.deepEqual(
    sources
      .filter((file) => !file.fileName.startsWith(sourceRoot + '/'))
      .map((file) => relative(root, file.fileName)),
    [],
    'Candidate emits only its actual backend graph'
  );
  assert.equal(
    program.emit().emitSkipped,
    false,
    'Candidate JavaScript and declarations emitted'
  );
  const lock = JSON.parse(
    readFileSync(join(root, 'package-lock.json'), 'utf8')
  );
  const manifest = candidateManifest(
    JSON.parse(readFileSync(join(root, 'libs/langgraph/package.json'), 'utf8'))
      .version,
    JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')).version,
    lock.packages['node_modules/@langchain/langgraph-sdk'].version
  );
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  return {
    sources: sources
      .map((file) => ({
        path: relative(root, file.fileName),
        sha256: sha256(readFileSync(file.fileName)),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
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
  const tarball = join(destination, packed.filename);
  const unpacked = join(destination, 'unpacked-candidate');
  mkdirSync(unpacked);
  execFileSync('tar', ['-xzf', tarball, '-C', unpacked]);
  assert.deepEqual(candidateViolations(join(unpacked, 'package')), []);
  assert.deepEqual(
    fileHashes(join(unpacked, 'package')),
    fileHashes(directory),
    'tarball retains every emitted module/declaration exactly'
  );
  return {
    tarball,
    sha256: sha256(readFileSync(tarball)),
    files: packed.files.map((file) => file.path).sort(),
  };
}

/** Resolve dependencies where the lock actually placed them, including nested SDK vendors. */
export function lockedVendorGraph(
  lock,
  seeds = ['@langchain/langgraph-sdk', '@langchain/core']
) {
  const packages = lock.packages;
  const todo = seeds.map((name) => `node_modules/${name}`),
    seen = new Map();
  const resolveDependency = (owner, name) => {
    let parent = owner;
    while (parent) {
      const path = `${parent}/node_modules/${name}`;
      if (packages[path]) return path;
      const index = parent.lastIndexOf('/node_modules/');
      parent = index < 0 ? '' : parent.slice(0, index);
    }
    assert.ok(
      packages[`node_modules/${name}`],
      `Missing locked dependency ${name} of ${owner}`
    );
    return `node_modules/${name}`;
  };
  while (todo.length) {
    const path = todo.shift();
    if (seen.has(path)) continue;
    const pkg = packages[path];
    assert.ok(pkg, `Missing locked vendor ${path}`);
    const edges = {
      ...pkg.dependencies,
      ...Object.fromEntries(
        Object.entries(pkg.peerDependencies ?? {}).filter(
          ([name]) => !pkg.peerDependenciesMeta?.[name]?.optional
        )
      ),
    };
    const dependencies = Object.fromEntries(
      Object.entries(edges).map(([name, range]) => {
        const target = resolveDependency(path, name),
          dependency = packages[target];
        assert.ok(
          satisfies(dependency.version, range),
          `Locked ${target}@${dependency.version} must satisfy ${range}`
        );
        todo.push(target);
        return [name, dependency.version];
      })
    );
    seen.set(path, {
      name: path.split('node_modules/').at(-1),
      version: pkg.version,
      dependencies,
    });
  }
  return [...seen.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)
  );
}
export function candidateInstallViolations(
  lock,
  kind,
  localNames = ['@threadplane/core', '@threadplane/langgraph']
) {
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
      errors.push(`${name} must resolve to its local tarball`);
    if (
      kind === 'node' &&
      (/^@angular\//.test(name) ||
        [
          'react',
          'react-dom',
          'rxjs',
          '@types/react',
          '@types/react-dom',
        ].includes(name))
    )
      errors.push(`Node candidate installed framework ${name}`);
    if (kind === 'react' && name.startsWith('@angular/'))
      errors.push(`React candidate installed Angular ${name}`);
    if (
      kind === 'angular' &&
      ['react', 'react-dom', '@types/react', '@types/react-dom'].includes(name)
    )
      errors.push(`Angular candidate installed React ${name}`);
    if (
      /^@ag-ui\//.test(name) ||
      ['openai', '@anthropic-ai/sdk'].includes(name)
    )
      errors.push(`Unrelated candidate backend ${name}`);
  }
  return errors;
}
export function vendorOverrides(vendors) {
  const graph = new Map(vendors.map((v) => [`${v.name}@${v.version}`, v]));
  function pin(name, version, ancestors = []) {
    const key = `${name}@${version}`,
      vendor = graph.get(key);
    assert.ok(vendor, `Missing override vendor ${key}`);
    assert.ok(!ancestors.includes(key), `Cyclic vendor override ${key}`);
    if (!Object.keys(vendor.dependencies).length) return version;
    return {
      '.': version,
      ...Object.fromEntries(
        Object.entries(vendor.dependencies).map(
          ([dependency, dependencyVersion]) => [
            dependency,
            pin(dependency, dependencyVersion, [...ancestors, key]),
          ]
        )
      ),
    };
  }
  return Object.fromEntries(
    ['@langchain/langgraph-sdk', '@langchain/core'].map((name) => {
      const vendor = vendors.find((v) => v.name === name);
      assert.ok(vendor, `Missing root vendor ${name}`);
      return [name, pin(name, vendor.version)];
    })
  );
}
export function installCandidateConsumer(
  consumer,
  manifest,
  tarballs,
  rootLock,
  kind
) {
  const vendors = lockedVendorGraph(rootLock);
  const overrides = vendorOverrides(vendors);
  const direct = {
    ...manifest.dependencies,
    '@langchain/core':
      rootLock.packages['node_modules/@langchain/core'].version,
    ...tarballs,
  };
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        ...manifest,
        dependencies: direct,
        overrides: {
          ...overrides,
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
  assert.deepEqual(
    candidateInstallViolations(lock, kind, Object.keys(tarballs)),
    []
  );
  assert.deepEqual(
    lockedVendorGraph(lock),
    vendors,
    'Installed backend dependency edges preserve the reviewed locked graph'
  );
  for (const vendor of vendors) {
    assert.ok(
      Object.entries(lock.packages).some(
        ([path, pkg]) =>
          path.split('node_modules/').at(-1) === vendor.name &&
          pkg.version === vendor.version
      ),
      `Installed locked vendor ${vendor.name}@${vendor.version}`
    );
  }
  return {
    vendors,
    footprint: installFootprint(consumer, lock),
    versions: Object.fromEntries(
      Object.entries(lock.packages)
        .filter(([path]) => path.includes('node_modules/'))
        .map(([path, pkg]) => [path, pkg.version])
    ),
  };
}
export function assertCandidateComposition(runtimeInputs, typeInputs) {
  const runtime = runtimeInputs.map((path) => path.replaceAll('\\', '/'));
  const types = typeInputs.map((path) => path.replaceAll('\\', '/'));
  for (const path of [...runtime, ...types]) {
    assert.ok(
      !path.split('/').includes('..'),
      `Unexpected composition path ${path}`
    );
    assert.ok(
      !path.includes('/libs/langgraph/') && !path.startsWith('libs/langgraph/'),
      'No workspace backend source'
    );
    assert.ok(
      !/(?:^|\/)runtime-entry\.d\.ts$/.test(path),
      'No surrogate backend declarations'
    );
    assert.ok(
      !/(?:^|\/)runtime-entry\.js$/.test(path),
      'No private bundled fixture backend'
    );
  }
  assert.ok(
    runtime.some((path) =>
      path.endsWith(
        'node_modules/@threadplane/langgraph/runtime/create-session.js'
      )
    ),
    'Actual installed candidate runtime required'
  );
  assert.ok(
    types.some((path) =>
      path.endsWith(
        'node_modules/@threadplane/langgraph/runtime/create-session.d.ts'
      )
    ),
    'Actual installed candidate declarations required'
  );
}
export function assertBackendGraph(inputs) {
  for (const path of inputs) {
    assert.ok(
      !/(?:^|\/)node_modules\/(?:@angular\/|react(?:-dom)?\/|rxjs\/|@threadplane\/(?:angular|react|chat|telemetry)\/)/.test(
        path
      ) && !/(?:^|\/)libs\/langgraph\//.test(path),
      `Forbidden backend graph ${path}`
    );
  }
}
