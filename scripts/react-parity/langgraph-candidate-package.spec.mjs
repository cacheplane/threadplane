import assert from 'node:assert/strict';
import {
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
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
import {
  candidateViolations,
  candidateInstallViolations,
  assertCandidateComposition,
  assertBackendGraph,
  candidateCompilerOptions,
  lockedVendorGraph,
  vendorOverrides,
  fileHashes,
  localArtifactRecords,
  assertLocalResolutions,
} from './langgraph-candidate-package.mjs';
import {
  checkTypes,
  reviewCandidate,
  installedMatches,
} from './verify-langgraph-candidate.mjs';
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
  const root = mkdtempSync(join(tmpdir(), 'candidate-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'),
    output = join(root, 'package');
  mkdirSync(join(source, 'runtime'), { recursive: true });
  writeFileSync(
    join(source, 'runtime/create-session.ts'),
    "export { createSession } from './helper.js';\n" +
      (declarationEdge ? "export type { Marker } from './helper.d.ts';\n" : '')
  );
  writeFileSync(
    join(source, 'runtime/helper.ts'),
    'export function createSession() { return { value: 1 }; }\nexport interface Marker { value: string }\n'
  );
  writeFileSync(join(source, 'package.json'), '{"type":"module"}');
  const program = ts.createProgram(
    [join(source, 'runtime/create-session.ts')],
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      declaration: true,
      rootDir: source,
      outDir: output,
      types: [],
      strict: true,
      skipLibCheck: false,
    }
  );
  assert.deepEqual(ts.getPreEmitDiagnostics(program), []);
  assert.equal(program.emit().emitSkipped, false);
  const manifest = {
    name: '@threadplane/langgraph',
    version: '0.2.0',
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
        types: './runtime/create-session.d.ts',
        import: './runtime/create-session.js',
        default: './runtime/create-session.js',
      },
    },
    dependencies: {
      '@threadplane/core': '0.0.0',
      '@langchain/langgraph-sdk': '1.10.0',
    },
  };
  writeFileSync(join(output, 'package.json'), JSON.stringify(manifest));
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
    mkdirSync(backend, { recursive: true });
    cpSync(join(output, 'runtime'), join(backend, 'runtime'), {
      recursive: true,
    });
    cpSync(join(output, 'package.json'), join(backend, 'package.json'));
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
test('accepts a real compiled module and full declaration graph without built workspace artifacts', (t) => {
  const { output } = fixture(t);
  assert.deepEqual(candidateViolations(output), []);
});
test('ordinary TypeScript declaration-only .d.ts edges retain real declarations and never become executable imports', (t) => {
  const { output } = fixture(t, true);
  assert.match(
    readFileSync(join(output, 'runtime/create-session.d.ts'), 'utf8'),
    /helper\.d\.ts/
  );
  assert.doesNotMatch(
    readFileSync(join(output, 'runtime/create-session.js'), 'utf8'),
    /helper\.d\.ts/
  );
  assert.deepEqual(candidateViolations(output), []);
  writeFileSync(
    join(output, 'runtime/create-session.js'),
    "export * from './helper.d.ts';\n"
  );
  assert.ok(
    candidateViolations(output).some((error) =>
      error.includes('declaration edge in JavaScript')
    )
  );
});
for (const name of ['runtime/helper.js', 'runtime/helper.d.ts'])
  test(`rejects missing reachable emission ${name}`, (t) => {
    const { output } = fixture(t);
    rmSync(join(output, name));
    assert.ok(
      candidateViolations(output).some(
        (error) => error.includes('Missing emitted') && error.includes('helper')
      )
    );
  });
for (const name of ['runtime/create-session.js', 'runtime/create-session.d.ts'])
  test(`rejects extensionless edges in ${name}`, (t) => {
    const { output } = fixture(t);
    const path = join(output, name);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('./helper.js', './helper')
    );
    assert.ok(
      candidateViolations(output).some((error) =>
        error.includes('Extensionless')
      )
    );
  });
test('rejects source packed beside its real emitted declaration', (t) => {
  const { output } = fixture(t);
  writeFileSync(
    join(output, 'runtime/helper.ts'),
    'export const source = true;'
  );
  assert.ok(
    candidateViolations(output).some((error) =>
      error.includes('Unexpected candidate file')
    )
  );
});
test('rejects undeclared or framework imports even if their manifest dependency is added', (t) => {
  const { output, manifest } = fixture(t);
  manifest.dependencies.react = '19.2.4';
  writeFileSync(join(output, 'package.json'), JSON.stringify(manifest));
  writeFileSync(
    join(output, 'runtime/helper.js'),
    "import 'react'; export const createSession = () => 1;"
  );
  const errors = candidateViolations(output);
  assert.ok(errors.some((error) => error.includes('candidate dependency')));
  assert.ok(
    errors.some((error) => error.includes('Forbidden candidate import'))
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
    'node_modules/@threadplane/langgraph/runtime/create-session.js',
    'runtime-entry.ts',
  ];
  const types = [
    'node_modules/@threadplane/langgraph/runtime/create-session.d.ts',
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
  delete lock.packages['node_modules/leaf'];
  assert.throws(() => lockedVendorGraph(lock), /Missing locked dependency/);
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
    'node_modules/@threadplane/langgraph/runtime/create-session.js',
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
