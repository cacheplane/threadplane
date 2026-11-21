import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
import {
  backendPackageShape,
  emitCandidate,
  stageBuiltPackage,
  candidateViolations,
  candidateInstallViolations,
  assertCandidateComposition,
  assertBackendGraph,
  candidateCompilerOptions,
  lockedVendorGraph,
  vendorOverrides,
  lockedEdgeRanges,
  fileHashes,
  localArtifactRecords,
  assertLocalResolutions,
} from './langgraph-package.mjs';
import {
  checkTypes,
  reviewCandidate,
  installedMatches,
} from './verify-langgraph-package.mjs';
import { createHash } from 'node:crypto';

test('local artifact graph retains content and its owner-relative exact parser edge', () => {
  const local = {
    '@threadplane/react': {
      version: '0.0.0',
      peerDependencies: { '@threadplane/content': '0.0.0' },
    },
    '@threadplane/content': {
      version: '0.0.0',
      dependencies: { '@cacheplane/partial-markdown': '^0.5.8' },
    },
  };
  const lock = {
    packages: {
      'node_modules/@cacheplane/partial-markdown': { version: '0.5.8' },
    },
  };
  const expected = lockedVendorGraph(lock, Object.keys(local), {}, local);
  assert.deepEqual(
    expected.find(({ name }) => name === '@threadplane/content').dependencies,
    { '@cacheplane/partial-markdown': '0.5.8' }
  );
  const installed = structuredClone(lock);
  for (const [name, manifest] of Object.entries(local))
    installed.packages[`node_modules/${name}`] = structuredClone(manifest);
  assert.deepEqual(lockedVendorGraph(installed, Object.keys(local)), expected);
  installed.packages['node_modules/@cacheplane/partial-markdown'].version =
    '0.5.9';
  assert.throws(
    () =>
      assert.deepEqual(
        lockedVendorGraph(installed, Object.keys(local)),
        expected
      ),
    /Expected values/
  );
  delete installed.packages['node_modules/@threadplane/content'].dependencies;
  assert.throws(
    () =>
      assert.deepEqual(
        lockedVendorGraph(installed, Object.keys(local)),
        expected
      ),
    /Expected values/
  );
  delete lock.packages['node_modules/@cacheplane/partial-markdown'];
  assert.throws(
    () => lockedVendorGraph(lock, Object.keys(local), {}, local),
    /Missing locked dependency.*partial-markdown/
  );
});

test('candidate installation requires selected content and isolates the plain Node parser', () => {
  const names = [
    '@threadplane/core',
    '@threadplane/langgraph',
    '@threadplane/content',
  ];
  const packages = Object.fromEntries(
    names
      .slice(0, 2)
      .map((name) => [
        `node_modules/${name}`,
        { version: '0.0.0', resolved: `file:/${name.split('/')[1]}.tgz` },
      ])
  );
  assert.ok(
    candidateInstallViolations({ packages }, 'react', names).some((error) =>
      /Missing.*content/.test(error)
    )
  );
  packages['node_modules/@cacheplane/partial-markdown'] = { version: '0.5.8' };
  assert.ok(
    candidateInstallViolations({ packages }, 'node', names.slice(0, 2)).some(
      (error) => /Node.*partial-markdown/.test(error)
    )
  );
  for (const substitution of [
    { resolved: 'https://registry.test/content.tgz' },
    { link: true },
    { resolved: 'file:/content.tgz' },
  ]) {
    packages['node_modules/@threadplane/content'] = {
      version: '0.0.0',
      ...substitution,
    };
    const errors = candidateInstallViolations({ packages }, 'react', names);
    assert.equal(
      errors.some((error) => /content.*local tarball/.test(error)),
      !substitution.resolved?.startsWith('file:')
    );
  }
});

function fixture(t, declarationEdge = false) {
  const root = mkdtempSync(join(tmpdir(), 'package-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'),
    output = join(root, 'package');
  mkdirSync(join(source, 'src/runtime'), { recursive: true });
  writeFileSync(
    join(source, 'src/public-api.ts'),
    "export { createSession } from './runtime/helper.js';\n" +
      (declarationEdge
        ? "export type { Marker } from './runtime/helper.d.ts';\n"
        : '')
  );
  writeFileSync(
    join(source, 'src/runtime/helper.ts'),
    'export function createSession() { return { value: 1 }; }\nexport interface Marker { value: string }\n'
  );
  writeFileSync(join(source, 'package.json'), '{"type":"module"}');
  const program = ts.createProgram([join(source, 'src/public-api.ts')], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    declaration: true,
    rootDir: source,
    outDir: output,
    types: [],
    strict: true,
    skipLibCheck: false,
  });
  assert.deepEqual(ts.getPreEmitDiagnostics(program), []);
  assert.equal(program.emit().emitSkipped, false);
  // The published shape: public, peers only, the root at src/public-api.
  const manifest = {
    name: '@threadplane/langgraph',
    version: '0.3.7',
    type: 'module',
    peerDependencies: {
      '@threadplane/core': '0.3.7',
      '@langchain/core': '^1.1.33',
      '@langchain/langgraph-sdk': '^1.7.4',
    },
    ...backendPackageShape(),
  };
  writeFileSync(join(output, 'package.json'), JSON.stringify(manifest));
  for (const name of ['README.md', 'LICENSE.md'])
    writeFileSync(join(output, name), name);
  mkdirSync(join(output, 'install'));
  writeFileSync(join(output, 'install/postinstall.cjs'), '');
  mkdirSync(join(output, '.install-collector'));
  writeFileSync(
    join(output, '.install-collector/development-install.mjs'),
    'export const installationToken = null;\n'
  );
  writeFileSync(
    join(output, '.install-collector/development-install.d.ts'),
    'export declare const installationToken: string | null;\n'
  );
  return { output, manifest };
}
test('selected tarball records reject missing and incompatible local content before installation', (t) => {
  const { output } = fixture(t);
  function pack(name, manifest) {
    writeFileSync(
      join(output, 'package.json'),
      JSON.stringify({ name, version: '0.0.0', ...manifest })
    );
    const tarball = join(dirname(output), name.split('/')[1] + '.tgz');
    execFileSync('tar', ['-czf', tarball, '-C', dirname(output), 'package']);
    return 'file:' + tarball;
  }
  const tarballs = {
    '@threadplane/react': pack('@threadplane/react', {
      peerDependencies: { '@threadplane/content': '0.0.0' },
    }),
  };
  assert.throws(
    () => localArtifactRecords(tarballs),
    /Missing local artifact manifest for content/
  );
  tarballs['@threadplane/content'] = pack('@threadplane/content', {
    version: '0.0.1',
  });
  assert.throws(
    () => localArtifactRecords(tarballs),
    /Local @threadplane\/content@0.0.1 does not satisfy/
  );
  tarballs['@threadplane/content'] = pack('@threadplane/content', {});
  assert.deepEqual(
    Object.keys(localArtifactRecords(tarballs)),
    Object.keys(tarballs)
  );
});

test('selected content lock resolution rejects registry, link and different local tarball substitutes', (t) => {
  const { output } = fixture(t);
  const selected = join(output, 'selected.tgz'),
    substitute = join(output, 'substitute.tgz');
  writeFileSync(selected, 'selected');
  writeFileSync(substitute, 'substitute');
  const tarballs = { '@threadplane/content': 'file:' + selected };
  const lock = {
    packages: {
      'node_modules/@threadplane/content': { resolved: 'file:' + selected },
    },
  };
  assert.doesNotThrow(() => assertLocalResolutions(output, lock, tarballs));
  for (const pkg of [
    { resolved: 'https://registry.test/content.tgz' },
    { link: true, resolved: 'file:' + selected },
    { resolved: 'file:' + substitute },
  ]) {
    lock.packages['node_modules/@threadplane/content'] = pkg;
    assert.throws(
      () => assertLocalResolutions(output, lock, tarballs),
      /local tarball|cannot be a link|selected tarball/
    );
  }
});
for (const mutation of ['missing', 'tampered', 'linked'])
  test(`installed closure rejects ${mutation} content even when backend bytes match`, (t) => {
    const { output } = fixture(t);
    const candidate = join(dirname(output), 'candidate');
    cpSync(output, candidate, { recursive: true });
    const consumer = join(output, 'consumer');
    const backend = join(consumer, 'node_modules/@threadplane/langgraph');
    mkdirSync(dirname(backend), { recursive: true });
    cpSync(candidate, backend, { recursive: true });
    const content = join(consumer, 'node_modules/@threadplane/content');
    mkdirSync(content);
    writeFileSync(join(content, 'index.js'), 'export const value = true;');
    writeFileSync(
      join(content, 'package.json'),
      JSON.stringify({ name: '@threadplane/content', version: '0.0.0' })
    );
    const expected = {
      '@threadplane/langgraph': fileHashes(backend),
      '@threadplane/content': fileHashes(content),
    };
    assert.doesNotThrow(() => installedMatches(consumer, candidate, expected));
    if (mutation === 'missing') rmSync(content, { recursive: true });
    if (mutation === 'tampered')
      writeFileSync(join(content, 'index.js'), 'export const value = false;');
    if (mutation === 'linked') {
      const substitute = join(output, 'substitute');
      cpSync(content, substitute, { recursive: true });
      rmSync(content, { recursive: true });
      symlinkSync(substitute, content);
    }
    assert.throws(
      () => installedMatches(consumer, candidate, expected),
      /Missing installed|Installed.*content|cannot.*link/
    );
  });
test('accepts a real compiled module and full declaration graph in the published layout', (t) => {
  const { output } = fixture(t);
  assert.deepEqual(candidateViolations(output), []);
});
test('rejects the retired declaration-only .d.ts edge: every packaged edge names its .js module', (t) => {
  const { output } = fixture(t, true);
  assert.match(
    readFileSync(join(output, 'src/public-api.d.ts'), 'utf8'),
    /helper\.d\.ts/
  );
  assert.ok(
    candidateViolations(output).some(
      (error) => error.includes('Extensionless') && error.includes('.d.ts')
    )
  );
});
for (const name of ['src/runtime/helper.js', 'src/runtime/helper.d.ts'])
  test(`rejects missing reachable emission ${name}`, (t) => {
    const { output } = fixture(t);
    rmSync(join(output, name));
    assert.ok(
      candidateViolations(output).some(
        (error) => error.includes('Missing emitted') && error.includes('helper')
      )
    );
  });
for (const name of ['src/public-api.js', 'src/public-api.d.ts'])
  test(`rejects extensionless edges in ${name}`, (t) => {
    const { output } = fixture(t);
    const path = join(output, name);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('./runtime/helper.js', './runtime/helper')
    );
    assert.ok(
      candidateViolations(output).some((error) =>
        error.includes('Extensionless')
      )
    );
  });
for (const name of [
  'src/runtime/helper.ts',
  'src/runtime/helper.spec.js',
  'src/runtime/testing/fixture.js',
  'fesm2022/threadplane-langgraph.mjs',
  'install/collector.test.mjs',
])
  test(`rejects ${name} packed beside the emitted graph`, (t) => {
    const { output } = fixture(t);
    mkdirSync(dirname(join(output, name)), { recursive: true });
    writeFileSync(join(output, name), 'export const source = true;');
    assert.ok(
      candidateViolations(output).some((error) =>
        error.includes('Unexpected candidate file')
      )
    );
  });
test('rejects undeclared or framework imports even if their manifest dependency is added', (t) => {
  const { output, manifest } = fixture(t);
  manifest.peerDependencies.react = '19.2.4';
  writeFileSync(join(output, 'package.json'), JSON.stringify(manifest));
  writeFileSync(
    join(output, 'src/runtime/helper.js'),
    "import 'react'; export const createSession = () => 1;"
  );
  const errors = candidateViolations(output);
  assert.ok(errors.some((error) => error.includes('candidate dependency')));
  assert.ok(
    errors.some((error) => error.includes('Forbidden candidate import'))
  );
});
for (const specifier of [
  '@angular/core',
  '@threadplane/chat',
  '@threadplane/angular',
  'rxjs',
])
  test(`rejects ${specifier} in a module and in the manifest`, (t) => {
    const { output, manifest } = fixture(t);
    writeFileSync(
      join(output, 'src/runtime/helper.d.ts'),
      `export type { X } from '${specifier}';\nexport declare function createSession(): { value: number };\n`
    );
    assert.ok(
      candidateViolations(output).some(
        (error) =>
          error.includes('Forbidden candidate import') &&
          error.includes(specifier)
      )
    );
    const { output: clean } = fixture(t);
    writeFileSync(
      join(clean, 'package.json'),
      JSON.stringify({
        ...manifest,
        peerDependencies: { ...manifest.peerDependencies, [specifier]: '*' },
      })
    );
    assert.ok(
      candidateViolations(clean).some((error) =>
        error.includes('candidate dependency')
      )
    );
  });
for (const [label, change, expected] of [
  ['a private manifest', (m) => ({ ...m, private: true }), 'identity'],
  ['a CommonJS manifest', ({ type, ...m }) => m, 'identity'],
  [
    'a root that is not src/public-api',
    (m) => ({
      ...m,
      exports: { ...m.exports, '.': './src/runtime/helper.js' },
    }),
    'exports',
  ],
  [
    'a retired secondary entry',
    (m) => ({ ...m, exports: { ...m.exports, './testing': './src/public-api.js' } }),
    'exports',
  ],
  ['a dependency', (m) => ({ ...m, dependencies: { lodash: '*' } }), 'install metadata'],
  ['no install hook script', ({ scripts, ...m }) => m, 'install metadata'],
  [
    'a package-internal import map',
    (m) => ({ ...m, imports: { '#development-install': './x.js' } }),
    'install metadata',
  ],
  ['unlisted files', (m) => ({ ...m, files: ['**/*'] }), 'files'],
])
  test(`rejects ${label}`, (t) => {
    const { output, manifest } = fixture(t);
    writeFileSync(join(output, 'package.json'), JSON.stringify(change(manifest)));
    assert.ok(
      candidateViolations(output).some((error) => error.includes(expected)),
      candidateViolations(output).join('\n')
    );
  });
test('rejects a package without its install hook file', (t) => {
  const { output } = fixture(t);
  rmSync(join(output, 'install/postinstall.cjs'));
  assert.ok(
    candidateViolations(output).some((error) =>
      error.includes('Missing install/postinstall.cjs')
    )
  );
});
test('the real source compiles into the published layout and a stale build is refused', (t) => {
  const repository = join(dirname(fileURLToPath(import.meta.url)), '../..');
  if (!existsSync(join(repository, 'dist/libs/core/package.json'))) {
    t.skip('Requires built core declarations.');
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), 'package-emit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const emitted = join(directory, 'emitted');
  const emission = emitCandidate(repository, emitted);
  assert.deepEqual(candidateViolations(emitted), []);
  assert.ok(
    emission.sources.some(
      (source) => source.path === 'libs/langgraph/src/public-api.ts'
    )
  );
  assert.ok(
    emission.sources.every(
      (source) =>
        source.path.startsWith('libs/langgraph/src/') &&
        !/\.(?:spec|type-test)\.ts$|\/testing\//.test(source.path)
    )
  );
  // A dist that differs from a fresh compile is not the package under test.
  const stale = join(directory, 'stale');
  cpSync(emitted, join(stale, 'dist/libs/langgraph'), { recursive: true });
  for (const path of ['libs/langgraph', 'libs/telemetry/install', 'dist/libs/core'])
    cpSync(join(repository, path), join(stale, path), {
      recursive: true,
      filter: (source) => !source.includes('node_modules'),
    });
  cpSync(
    join(repository, 'libs/telemetry/install/postinstall.cjs'),
    join(stale, 'dist/libs/langgraph/install/postinstall.cjs')
  );
  symlinkSync(join(repository, 'node_modules'), join(stale, 'node_modules'));
  assert.doesNotThrow(() => stageBuiltPackage(stale, join(directory, 'fresh')));
  writeFileSync(
    join(stale, 'dist/libs/langgraph/src/runtime/wire-message.js'),
    'export const stale = true;\n'
  );
  assert.throws(
    () => stageBuiltPackage(stale, join(directory, 'refused')),
    /stale|Missing emitted|Forbidden|Unexpected/
  );
  // The contributor stub is never the hook a release ships.
  cpSync(emitted, join(stale, 'dist/libs/langgraph'), { recursive: true });
  assert.throws(
    () => stageBuiltPackage(stale, join(directory, 'stub')),
    /shared install hook/
  );
});
test('candidate installation rejects registry/link fallback and optional framework installation in Node', () => {
  const lock = {
    packages: {
      'node_modules/@threadplane/langgraph': {
        version: '0.2.0',
        resolved: 'https://registry.test/candidate.tgz',
      },
      'node_modules/@threadplane/core': { link: true },
      'node_modules/react': { version: '19.2.4' },
    },
  };
  const errors = candidateInstallViolations(lock, 'node');
  assert.ok(errors.some((error) => error.includes('local tarball')));
  assert.ok(
    errors.some((error) => error.includes('Node candidate installed framework'))
  );
});
test('composition requires the actual installed runtime and declarations and rejects source/facade substitutes', () => {
  const runtime = [
    'node_modules/@threadplane/langgraph/src/runtime/create-session.js',
    'runtime-entry.ts',
  ];
  const types = [
    'node_modules/@threadplane/langgraph/src/runtime/create-session.d.ts',
    'runtime-entry.ts',
  ];
  assert.doesNotThrow(() => assertCandidateComposition(runtime, types));
  assert.throws(
    () =>
      assertCandidateComposition(
        ['libs/langgraph/src/runtime/create-session.ts'],
        types
      ),
    /installed candidate|workspace backend/
  );
  assert.throws(
    () => assertCandidateComposition(runtime, ['runtime-entry.d.ts']),
    /declarations|surrogate/
  );
  assert.throws(
    () => assertCandidateComposition([...runtime, 'runtime-entry.js'], types),
    /bundled fixture/
  );
  assert.throws(
    () =>
      assertCandidateComposition(
        [
          ...runtime,
          'node_modules/@threadplane/langgraph/../../react/index.js',
        ],
        types
      ),
    /framework|path/
  );
});
test('vendor pinning scopes every nested override to its locked version', () => {
  const versions = [{ name: 'zod', version: '3.25.76', dependencies: {} }, { name: 'zod', version: '4.3.6', dependencies: {} }];
  assert.deepEqual(vendorOverrides(versions, ['zod@3.25.76', 'zod@4.3.6']), { 'zod@3.25.76': '3.25.76', 'zod@4.3.6': '4.3.6' });
  const lock = {
    packages: {
      'node_modules/@langchain/langgraph-sdk': {
        version: '1.10.0',
        dependencies: { vendor: '^2.0.0' },
        peerDependencies: { '@langchain/core': '^1.0.0', react: '*' },
        peerDependenciesMeta: { react: { optional: true } },
      },
      'node_modules/@langchain/core': {
        version: '1.2.9',
        dependencies: { vendor: '^1.0.0' },
      },
      'node_modules/vendor': { version: '1.0.1' },
      'node_modules/@langchain/langgraph-sdk/node_modules/vendor': {
        version: '2.0.1',
        dependencies: { leaf: '^3.0.0' },
      },
      'node_modules/leaf': { version: '3.0.1' },
    },
  };
  const graph = lockedVendorGraph(lock);
  assert.equal(
    graph.some((v) => v.name === 'react'),
    false,
    'optional UI peer is not a mandatory backend dependency'
  );
  assert.deepEqual(vendorOverrides(graph), {
    '@langchain/langgraph-sdk@1.10.0': {
      '.': '1.10.0',
      'vendor@2.0.1': { '.': '2.0.1', 'leaf@3.0.1': '3.0.1' },
      '@langchain/core@1.2.9': { '.': '1.2.9', 'vendor@1.0.1': '1.0.1' },
    },
    '@langchain/core@1.2.9': { '.': '1.2.9', 'vendor@1.0.1': '1.0.1' },
  });
  assert.deepEqual(
    vendorOverrides(graph, undefined, {
      rootPins: ['@langchain/langgraph-sdk@1.10.0', '@langchain/core@1.2.9'],
    })['@langchain/langgraph-sdk@1.10.0'],
    {
      '.': '1.10.0',
      'vendor@2.0.1': { '.': '2.0.1', 'leaf@3.0.1': '3.0.1' },
    },
    'a root-pinned peer is not re-pinned inside another owner subtree'
  );
  delete lock.packages['node_modules/leaf'];
  assert.throws(() => lockedVendorGraph(lock), /Missing locked dependency/);
});
test('edge ranges qualify selectors so npm 11 replaces a hoisted incompatible candidate', () => {
  const lock = {
    packages: {
      'node_modules/@langchain/core': {
        version: '1.2.9',
        dependencies: { zod: '^3.25.76 || ^4' },
      },
      'node_modules/zod': { version: '3.25.76' },
      'node_modules/@json-render/core': {
        version: '0.16.0',
        dependencies: { zod: '^4.3.6' },
      },
      'node_modules/@json-render/core/node_modules/zod': { version: '4.3.6' },
    },
  };
  const graph = lockedVendorGraph(lock, ['@langchain/core']);
  assert.deepEqual(
    vendorOverrides(graph, ['@langchain/core'], {
      edgeRanges: lockedEdgeRanges(lock),
    }),
    { '@langchain/core@1.2.9': { '.': '1.2.9', 'zod@^3.25.76 || ^4': '3.25.76' } }
  );
  assert.deepEqual(vendorOverrides(graph, ['@langchain/core']), {
    '@langchain/core@1.2.9': { '.': '1.2.9', 'zod@3.25.76': '3.25.76' },
  });
});
test('conflicting queue descendants retain distinct version selectors and reject incompatible hoisting', () => {
  const lock = {
    packages: {
      'node_modules/@langchain/langgraph-sdk': {
        version: '1.10.0',
        dependencies: { 'p-queue': '^9.0.0' },
      },
      'node_modules/@langchain/core': {
        version: '1.2.9',
        dependencies: { 'p-queue': '^6.6.2' },
      },
      'node_modules/p-queue': {
        version: '6.6.2',
        dependencies: { eventemitter3: '^4.0.4', 'p-timeout': '^3.2.0' },
      },
      'node_modules/eventemitter3': { version: '4.0.7' },
      'node_modules/p-timeout': { version: '3.2.0' },
      'node_modules/@langchain/langgraph-sdk/node_modules/p-queue': {
        version: '9.1.0',
        dependencies: { eventemitter3: '^5.0.1', 'p-timeout': '^7.0.0' },
      },
      'node_modules/@langchain/langgraph-sdk/node_modules/eventemitter3': {
        version: '5.0.4',
      },
      'node_modules/@langchain/langgraph-sdk/node_modules/p-timeout': {
        version: '7.0.1',
      },
    },
  };
  const overrides = vendorOverrides(lockedVendorGraph(lock));
  assert.deepEqual(overrides['@langchain/core@1.2.9']['p-queue@6.6.2'], {
    '.': '6.6.2',
    'eventemitter3@4.0.7': '4.0.7',
    'p-timeout@3.2.0': '3.2.0',
  });
  assert.deepEqual(
    overrides['@langchain/langgraph-sdk@1.10.0']['p-queue@9.1.0'],
    {
      '.': '9.1.0',
      'eventemitter3@5.0.4': '5.0.4',
      'p-timeout@7.0.1': '7.0.1',
    }
  );
  lock.packages['node_modules/eventemitter3'].version = '5.0.4';
  assert.throws(() => lockedVendorGraph(lock), /must satisfy \^4\.0\.4/);
});
test('backend import graph permits its actual vendor closure while rejecting framework and source coupling', () => {
  const inputs = [
    'node_modules/@threadplane/langgraph/src/runtime/create-session.js',
    'node_modules/@threadplane/core/src/index.js',
    'node_modules/@langchain/langgraph-sdk/dist/index.js',
  ];
  assert.doesNotThrow(() => assertBackendGraph(inputs));
  for (const path of [
    'node_modules/react/index.js',
    'node_modules/@angular/core/index.js',
    'node_modules/rxjs/index.js',
    'node_modules/@threadplane/chat/index.js',
    'node_modules/@threadplane/telemetry/index.js',
    'libs/langgraph/src/runtime/create-session.ts',
  ])
    assert.throws(
      () => assertBackendGraph([...inputs, path]),
      /Forbidden backend graph/
    );
});
test('candidate compiler libraries expose vendor disposal declarations without weakening or mutating original framework options', () => {
  const original = Object.freeze({
    strict: true,
    skipLibCheck: false,
    lib: Object.freeze(['ES2022', 'DOM']),
    noEmit: true,
  });
  const candidate = candidateCompilerOptions(original);
  assert.deepEqual(candidate, {
    strict: true,
    skipLibCheck: false,
    lib: ['ES2022', 'DOM', 'ESNext.Disposable'],
    noEmit: true,
  });
  assert.deepEqual(original.lib, ['ES2022', 'DOM']);
  assert.equal(candidate.paths, undefined);
});
function reviewFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'candidate-review-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const frameworks = ['react', 'angular'].map((kind) => {
    mkdirSync(join(root, kind));
    writeFileSync(join(root, kind, 'index.html'), '<p>owned fixture</p>');
    return {
      kind,
      directory: kind,
      served: [
        {
          path: 'index.html',
          sha256: createHash('sha256')
            .update('<p>owned fixture</p>')
            .digest('hex'),
        },
      ],
    };
  });
  writeFileSync(
    join(root, 'provenance.json'),
    JSON.stringify({ frameworks, tarballs: [] })
  );
  return root;
}
test('strict type provenance follows real installed declarations through a temporary-directory alias', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'candidate-type-path-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'consumer'),
    alias = join(parent, 'alias');
  mkdirSync(join(root, 'node_modules/candidate'), { recursive: true });
  symlinkSync(root, alias);
  writeFileSync(
    join(root, 'node_modules/candidate/package.json'),
    JSON.stringify({ name: 'candidate', types: './index.d.ts' })
  );
  writeFileSync(
    join(root, 'node_modules/candidate/index.d.ts'),
    'export declare const text: string;'
  );
  writeFileSync(
    join(root, 'probe.ts'),
    "import { text } from 'candidate'; export const result: string = text;"
  );
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        types: [],
      },
      files: ['probe.ts'],
    })
  );
  const files = checkTypes(alias, 'tsconfig.json');
  assert.ok(
    files.some((file) => file.path === 'node_modules/candidate/index.d.ts'),
    'actual resolved package declarations are included'
  );
  assert.ok(
    files.every((file) => !file.path.startsWith('../')),
    'provenance remains consumer-relative'
  );
});
test('retained review refuses changed bytes before opening a server', async (t) => {
  const root = reviewFixture(t);
  writeFileSync(join(root, 'react/index.html'), 'changed');
  let opened = 0;
  await assert.rejects(
    reviewCandidate(root, AbortSignal.timeout(1000), {
      log: () => undefined,
      serve: async () => {
        opened++;
        throw new Error('must not start');
      },
    }),
    /Frozen served files/
  );
  assert.equal(opened, 0);
});
test('retained review refuses a changed candidate tarball before opening a server', async (t) => {
  const root = reviewFixture(t);
  const provenance = JSON.parse(
    readFileSync(join(root, 'provenance.json'), 'utf8')
  );
  writeFileSync(join(root, 'candidate.tgz'), 'changed package');
  provenance.tarballs = [{ file: 'candidate.tgz', sha256: 'original digest' }];
  writeFileSync(join(root, 'provenance.json'), JSON.stringify(provenance));
  let opened = 0;
  await assert.rejects(
    reviewCandidate(root, new AbortController().signal, {
      log: () => undefined,
      serve: async () => {
        opened++;
        throw new Error('must not start');
      },
    }),
    /Frozen tarball unchanged/
  );
  assert.equal(opened, 0);
});
test('review closes its first server when second startup fails and reports cleanup failure', async (t) => {
  const root = reviewFixture(t);
  let opened = 0,
    closed = 0;
  await assert.rejects(
    reviewCandidate(root, AbortSignal.timeout(1000), {
      log: () => undefined,
      serve: async () => {
        if (++opened === 2) throw new Error('second setup failed');
        return {
          close: async () => {
            closed++;
          },
        };
      },
    }),
    /second setup failed/
  );
  assert.equal(closed, 1);
  const controller = new AbortController();
  opened = 0;
  closed = 0;
  await assert.rejects(
    reviewCandidate(root, controller.signal, {
      // Mock servers have no event-loop handles. Abort explicitly once both
      // have been registered instead of relying on an unreferenced timer.
      log: () => {
        if (opened === 2) controller.abort();
      },
      serve: async () => {
        opened++;
        return {
          close: async () => {
            closed++;
            throw new Error('close failed');
          },
        };
      },
    }),
    /cleanup failed/
  );
  assert.equal(opened, 2);
  assert.equal(closed, 2);
});
test('review abort during startup never opens its second server and closes the owned first', async (t) => {
  const root = reviewFixture(t),
    controller = new AbortController();
  let opened = 0,
    closed = 0;
  await assert.rejects(
    reviewCandidate(root, controller.signal, {
      log: () => undefined,
      serve: async () => {
        opened++;
        controller.abort();
        return {
          close: async () => {
            closed++;
          },
        };
      },
    }),
    /startup aborted/
  );
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});
