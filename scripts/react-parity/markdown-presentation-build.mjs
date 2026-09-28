import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  cpSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { satisfies } from 'semver';
import {
  assertInstalledArtifacts,
  assertLocalResolutions,
  localArtifactRecords,
  lockedVendorGraph,
  sha256,
  fileHashes,
} from './langgraph-candidate-package.mjs';
import { runConsumer } from './verify-packages.mjs';
import { assertInstalledInputs } from './ag-ui-candidate-package.mjs';
import { checkTypes } from './verify-langgraph-candidate.mjs';

export function presentationConfiguration() {
  return {
    workspace: {
      version: 1,
      cli: { analytics: false, packageManager: 'npm' },
      projects: {
        presentation: {
          projectType: 'application',
          root: '',
          sourceRoot: '',
          architect: {
            build: {
              builder: '@angular/build:application',
              options: {
                browser: 'presentation.tsx',
                index: { input: 'presentation.html', output: 'index.html' },
                tsConfig: 'tsconfig.presentation.json',
                outputPath: 'presentation-output',
                deployUrl: '/presentation-assets/',
                outputHashing: 'all',
                optimization: true,
                statsJson: true,
                allowedCommonJsDependencies: [
                  'react',
                  'react-dom/client',
                  'react/jsx-runtime',
                ],
              },
            },
          },
        },
      },
    },
    typescript: {
      compilerOptions: {
        target: 'ES2022',
        module: 'preserve',
        moduleResolution: 'bundler',
        lib: ['ES2022', 'DOM'],
        strict: true,
        skipLibCheck: false,
        isolatedModules: true,
        experimentalDecorators: true,
        importHelpers: true,
        jsx: 'react-jsx',
        esModuleInterop: true,
        types: [],
      },
      angularCompilerOptions: {
        strictInjectionParameters: true,
        strictInputAccessModifiers: true,
        strictTemplates: true,
      },
      files: ['presentation.tsx'],
    },
  };
}

export function assertTemplateDiagnostic(kind, output) {
  assert.doesNotMatch(
    output,
    /Cannot find module|Could not resolve|NG8001|NG8002/
  );
  assert.match(
    output,
    kind === 'missing'
      ? /NG8008[\s\S]*Required input 'snapshot'[\s\S]*MarkdownComponent/
      : /TS2322[\s\S]*Type 'string' is not assignable to type 'MarkdownSnapshot'/
  );
}

// Build only the already-installed consumer; packing and installation belong to
// verify-markdown. Angular compiles the decorated host and real APF templates.
export function buildPresentation(root, consumer, expected) {
  const sourceFiles = [
    'presentation.tsx',
    'presentation-angular.ts',
    'presentation-state.ts',
    'presentation.html',
  ];
  for (const file of sourceFiles)
    cpSync(
      join(root, 'fixtures/react-parity/markdown', file),
      join(consumer, file)
    );
  const { workspace, typescript } = presentationConfiguration();
  const writeJson = (file, value) =>
    writeFileSync(join(consumer, file), JSON.stringify(value, null, 2) + '\n');
  writeJson('angular.json', workspace);
  writeJson('tsconfig.presentation.json', typescript);
  const types = checkTypes(consumer, 'tsconfig.presentation.json');
  assertInstalledInputs(
    consumer,
    types.map((file) => file.path),
    expected
  );
  for (const path of [
    'node_modules/@threadplane/content/src/markdown/index.d.ts',
    'node_modules/@threadplane/react/src/markdown/index.d.ts',
    'node_modules/@threadplane/angular/types/threadplane-angular-markdown.d.ts',
  ])
    assert.ok(
      types.some((record) => record.path === path),
      'Installed presentation declaration required: ' + path
    );
  const negatives = {};
  for (const kind of ['missing', 'wrong']) {
    const file = `presentation-negative-${kind}.ts`;
    writeFileSync(
      join(consumer, file),
      `import { Component } from '@angular/core';
import { MarkdownComponent } from '@threadplane/angular/markdown';
@Component({selector:'negative-host',standalone:true,imports:[MarkdownComponent],template: \`<threadplane-markdown ${
        kind === 'wrong' ? '[snapshot]="value"' : ''
      } />\`})
export class NegativeHost { readonly value = 'not a snapshot'; }\n`
    );
    const config = `tsconfig.presentation-negative-${kind}.json`;
    writeJson(config, {
      ...typescript,
      compilerOptions: { ...typescript.compilerOptions, noEmit: true },
      files: [file],
    });
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js',
        '-p',
        config,
      ],
      {
        cwd: consumer,
        encoding: 'utf8',
        timeout: 60000,
      }
    );
    assert.equal(
      result.status,
      1,
      'Invalid Angular snapshot input must fail compilation'
    );
    const diagnostic = result.stdout + result.stderr;
    assertTemplateDiagnostic(kind, diagnostic);
    const log = `presentation-negative-${kind}.log`;
    writeFileSync(join(consumer, log), diagnostic);
    negatives[kind] = { diagnostic, file, config, log };
    sourceFiles.push(file, config, log);
  }
  console.log(
    runConsumer(
      process.execPath,
      ['node_modules/@angular/cli/bin/ng.js', 'build', 'presentation'],
      consumer
    )
  );
  const stats = json(join(consumer, 'presentation-output/stats.json'));
  const inputs = Object.keys(stats.inputs);
  assertInstalledInputs(consumer, inputs, expected);
  for (const file of [
    'presentation.tsx',
    'presentation-angular.ts',
    'presentation-state.ts',
    'node_modules/@threadplane/react/src/markdown/markdown.js',
    'node_modules/@threadplane/angular/fesm2022/threadplane-angular-markdown.mjs',
    'node_modules/@threadplane/content/src/markdown/create-markdown.js',
    'node_modules/@threadplane/react/src/use-agent.js',
    'node_modules/@threadplane/angular/fesm2022/threadplane-angular.mjs',
  ])
    assert.ok(
      inputs.includes(file),
      `Installed presentation input required: ${file}`
    );
  assert.ok(
    inputs.some((path) =>
      path.includes('node_modules/@cacheplane/partial-markdown/')
    )
  );
  const outputDirectory = join(consumer, 'presentation-output');
  for (const file of ['failure.png', 'success.svg'])
    assert.equal(
      existsSync(join(outputDirectory, 'browser', file)),
      false,
      'Owned image fixture must not overwrite an emitted output'
    );
  // A successful HTTP response with invalid image bytes triggers deterministic
  // decoding failure without a console/network error or external request.
  writeFileSync(
    join(outputDirectory, 'browser/failure.png'),
    'owned invalid image bytes'
  );
  writeFileSync(
    join(outputDirectory, 'browser/success.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="teal"/></svg>'
  );
  const outputs = fileHashes(outputDirectory).map((record) => ({
    ...record,
    path: 'presentation-output/' + record.path,
  }));
  return {
    inputs,
    types,
    negatives,
    outputs,
    inputHashes: inputs.map((path) => ({
      path,
      sha256: sha256(readFileSync(resolve(consumer, path))),
    })),
    files: [...sourceFiles, 'angular.json', 'tsconfig.presentation.json'].map(
      (path) => ({ path, sha256: sha256(readFileSync(join(consumer, path))) })
    ),
    shell: 'presentation-output/browser/index.html',
    assets: outputs.filter(
      (record) =>
        record.path.startsWith('presentation-output/browser/') &&
        !record.path.endsWith('/index.html')
    ),
  };
}

export function readPresentation(directory, provenance) {
  if (!provenance.presentation) return undefined; // Historical owner-only proofs.
  const proof = provenance.presentation;
  const base = realpathSync(join(directory, 'consumer'));
  const safePath = (path) => {
    assert.ok(
      typeof path === 'string' &&
        path.startsWith('presentation-output/') &&
        !path
          .split('/')
          .some((part) => !part || part === '.' || part === '..') &&
        !path.includes('\\'),
      'Invalid presentation path'
    );
    const actual = realpathSync(join(base, path));
    assert.ok(
      actual.startsWith(base + '/presentation-output/'),
      'Presentation path escapes retained outputs'
    );
    return actual;
  };
  for (const record of [...proof.outputs, ...proof.assets])
    safePath(record.path);
  safePath(proof.shell);
  assert.deepEqual(
    fileHashes(join(base, 'presentation-output')).map((record) => ({
      ...record,
      path: 'presentation-output/' + record.path,
    })),
    proof.outputs,
    'Complete presentation outputs must match retained bytes'
  );
  const read = (path) => {
    const bytes = readFileSync(safePath(path));
    assert.equal(
      sha256(bytes),
      provenance.frozen.find((record) => record.path === 'consumer/' + path)
        ?.sha256,
      'Presentation served bytes require matching frozen record: ' + path
    );
    return bytes;
  };
  for (const record of proof.outputs) read(record.path);
  const expectedAssets = proof.outputs.filter(
    (record) =>
      record.path.startsWith('presentation-output/browser/') &&
      record.path !== proof.shell
  );
  assert.deepEqual(
    proof.assets,
    expectedAssets,
    'Presentation asset allowlist equals all browser outputs'
  );
  assert.equal(
    proof.shell,
    'presentation-output/browser/index.html',
    'Angular generated shell required'
  );
  const types = {
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
    '.txt': 'text/plain',
  };
  return {
    shell: read(proof.shell),
    assets: Object.fromEntries(
      proof.assets.map((record) => {
        const name = record.path.slice('presentation-output/browser/'.length);
        const extension = name.slice(name.lastIndexOf('.'));
        assert.ok(
          types[extension],
          'Known presentation asset type required: ' + name
        );
        return [
          '/presentation-assets/' + name,
          [types[extension], read(record.path)],
        ];
      })
    ),
  };
}

export const presentationSeeds = [
  '@cacheplane/partial-markdown',
  '@angular/core',
  '@angular/common',
  '@angular/compiler',
  '@angular/platform-browser',
  'react',
  'react-dom',
  'rxjs',
  'tslib',
  '@types/react',
  '@types/react-dom',
  '@types/node',
  'typescript',
  '@angular/cli',
  '@angular/build',
  '@angular/compiler-cli',
];
const localNames = [
  '@threadplane/content',
  '@threadplane/core',
  '@threadplane/react',
  '@threadplane/angular',
];
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const integrity = (path) =>
  'sha512-' + createHash('sha512').update(readFileSync(path)).digest('base64');

// Selection only: npm owns installation. Keep the original physical records,
// including optional binaries for other platforms; never flatten or re-resolve.
export function selectPresentationLock(lock, seeds = presentationSeeds) {
  assert.equal(lock.lockfileVersion, 3, 'Root lock v3 required');
  const packages = lock.packages,
    selected = {};
  const todo = seeds.map((name) => 'node_modules/' + name);
  const resolveDependency = (owner, name) => {
    let parent = owner;
    while (parent) {
      const path = `${parent}/node_modules/${name}`;
      if (packages[path]) return path;
      const index = parent.lastIndexOf('/node_modules/');
      parent = index < 0 ? '' : parent.slice(0, index);
    }
    const path = 'node_modules/' + name;
    if (packages[path]) return path;
  };
  while (todo.length) {
    const path = todo.shift();
    if (selected[path]) continue;
    const pkg = packages[path];
    assert.ok(pkg, `Missing locked root/selected vendor ${path}`);
    assert.ok(
      !pkg.link && pkg.version && pkg.resolved && pkg.integrity,
      `External registry record required: ${path}`
    );
    selected[path] = structuredClone(pkg);
    const required = {
      ...pkg.dependencies,
      ...Object.fromEntries(
        Object.entries(pkg.peerDependencies ?? {}).filter(
          ([name]) => !pkg.peerDependenciesMeta?.[name]?.optional
        )
      ),
    };
    for (const [name, range] of Object.entries({
      ...required,
      ...pkg.optionalDependencies,
    })) {
      const target = resolveDependency(path, name);
      if (!target && Object.hasOwn(pkg.optionalDependencies ?? {}, name))
        continue;
      assert.ok(target, `Missing locked dependency ${name} of ${path}`);
      assert.ok(
        satisfies(packages[target].version, range),
        `Locked ${target}@${packages[target].version} must satisfy ${range}`
      );
      todo.push(target);
    }
  }
  return selected;
}

// Physical duplicates/hoisting are irrelevant only when the whole record agrees.
// Keep same-name/version records with different edges distinct, including cycles.
export function canonicalVendorGraph(lock, seeds = presentationSeeds) {
  const records = lockedVendorGraph(lock, seeds).map((record) => ({
    ...record,
    dependencies: Object.fromEntries(
      Object.entries(record.dependencies).sort(([a], [b]) => a.localeCompare(b))
    ),
  }));
  return [...new Set(records.map((record) => JSON.stringify(record)))]
    .sort()
    .map((record) => JSON.parse(record));
}

export function derivePresentationConsumer(
  rootLock,
  tarballs,
  seeds = presentationSeeds
) {
  assert.deepEqual(
    Object.keys(tarballs).sort(),
    [...localNames].sort(),
    'Exactly four Markdown foundation tarballs required'
  );
  const selected = selectPresentationLock(rootLock, seeds);
  const artifacts = localArtifactRecords(tarballs);
  const manifest = {
    name: 'owned-markdown-consumer',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: {
      ...Object.fromEntries(
        seeds.map((name) => [
          name,
          rootLock.packages['node_modules/' + name].version,
        ])
      ),
      ...tarballs,
    },
  };
  const locals = Object.fromEntries(
    Object.entries(artifacts).map(([name, { manifest }]) => {
      const record = {
        version: manifest.version,
        resolved: tarballs[name],
        integrity: integrity(tarballs[name].slice(5)),
      };
      for (const key of [
        'dependencies',
        'optionalDependencies',
        'peerDependencies',
        'peerDependenciesMeta',
        'engines',
        'bin',
        'os',
        'cpu',
        'libc',
      ])
        if (manifest[key] !== undefined)
          record[key] = structuredClone(manifest[key]);
      return ['node_modules/' + name, record];
    })
  );
  const lock = {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    requires: true,
    packages: { '': manifest, ...selected, ...locals },
  };
  // This also checks that actual local manifest dependency and peer ranges fit.
  const graph = canonicalVendorGraph(lock, [...seeds, ...localNames]);
  return {
    manifest,
    lock,
    seeds: [...seeds],
    graph,
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([name, record]) => [name, record.files])
    ),
  };
}

function installedPackages(consumer) {
  const packages = {};
  const visit = (directory) => {
    if (!existsSync(join(consumer, directory))) return;
    for (const entry of readdirSync(join(consumer, directory), {
      withFileTypes: true,
    })) {
      if (entry.name.startsWith('.')) continue;
      const path = directory + '/' + entry.name;
      assert.equal(
        lstatSync(join(consumer, path)).isSymbolicLink(),
        false,
        `Installed package cannot be a link: ${path}`
      );
      if (entry.name.startsWith('@')) {
        visit(path);
        continue;
      }
      if (!entry.isDirectory()) continue;
      const manifest = json(join(consumer, path, 'package.json'));
      assert.equal(
        manifest.name,
        path.split('node_modules/').at(-1),
        `Installed package identity: ${path}`
      );
      packages[path] = manifest;
      visit(path + '/node_modules');
    }
  };
  visit('node_modules');
  return packages;
}

export function assertPresentationInstallation(consumer, derived, tarballs) {
  const { lock, seeds, artifacts } = derived;
  assertLocalResolutions(consumer, lock, tarballs);
  for (const [name, specifier] of Object.entries(tarballs)) {
    const record = lock.packages['node_modules/' + name];
    assert.ok(record, `Missing local lock record ${name}`);
    assert.equal(
      record.integrity,
      integrity(specifier.slice(5)),
      `Selected tarball integrity: ${name}`
    );
  }
  assertInstalledArtifacts(consumer, artifacts);
  const actual = { packages: installedPackages(consumer) };
  for (const name of seeds) {
    assert.equal(
      lock.packages[''].dependencies[name],
      derived.manifest.dependencies[name],
      `Locked root selection: ${name}`
    );
    assert.equal(
      actual.packages['node_modules/' + name]?.version,
      derived.manifest.dependencies[name],
      `Installed root selection: ${name}`
    );
  }
  for (const path of Object.keys(actual.packages)) {
    const name = path.split('node_modules/').at(-1);
    assert.ok(
      !/^@(?:langchain|ag-ui)\//.test(name) &&
        !['langchain', '@mastra/client-js'].includes(name),
      `Unexpected backend SDK: ${name}`
    );
    if (name.startsWith('@threadplane/'))
      assert.ok(localNames.includes(name), `Unexpected local package: ${name}`);
  }
  const graph = canonicalVendorGraph(actual, [...seeds, ...localNames]);
  assert.deepEqual(
    graph,
    derived.graph,
    'Actual installed required graph equals complete locked graph'
  );
  return {
    externalRecords: Object.keys(lock.packages).filter(
      (path) => path && !path.startsWith('node_modules/@threadplane/')
    ).length,
    optionalRecords: Object.values(lock.packages).filter(
      (record) => record.optional
    ).length,
    requiredPhysicalRecords: lockedVendorGraph(actual, seeds).length,
    requiredCanonicalRecords: canonicalVendorGraph(actual, seeds).length,
    graph,
  };
}

export function installPresentationConsumer(consumer, rootLock, tarballs) {
  assert.equal(
    existsSync(join(consumer, 'node_modules')),
    false,
    'Fresh isolated consumer required'
  );
  const derived = derivePresentationConsumer(rootLock, tarballs);
  for (const [file, value] of [
    ['package.json', derived.manifest],
    ['package-lock.json', derived.lock],
  ])
    writeFileSync(join(consumer, file), JSON.stringify(value, null, 2) + '\n');
  const before = sha256(readFileSync(join(consumer, 'package-lock.json')));
  console.log(
    runConsumer(
      'npm',
      ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      consumer
    )
  );
  assert.equal(
    sha256(readFileSync(join(consumer, 'package-lock.json'))),
    before,
    'npm ci preserves derived lock bytes'
  );
  const proof = assertPresentationInstallation(consumer, derived, tarballs);
  return {
    ...proof,
    seeds: derived.seeds,
    derivedLockSha256: before,
    artifacts: derived.artifacts,
  };
}
