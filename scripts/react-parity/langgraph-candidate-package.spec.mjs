import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
} from './langgraph-candidate-package.mjs';
import { checkTypes, reviewCandidate } from './verify-langgraph-candidate.mjs';
import { createHash } from 'node:crypto';

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
test('vendor pinning follows nested lock resolution and nests descendant overrides under their parent', () => {
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
    '@langchain/langgraph-sdk': {
      '.': '1.10.0',
      vendor: { '.': '2.0.1', leaf: '3.0.1' },
      '@langchain/core': { '.': '1.2.9', vendor: '1.0.1' },
    },
    '@langchain/core': { '.': '1.2.9', vendor: '1.0.1' },
  });
  delete lock.packages['node_modules/leaf'];
  assert.throws(() => lockedVendorGraph(lock), /Missing locked dependency/);
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
  await assert.rejects(
    reviewCandidate(root, AbortSignal.timeout(5), {
      log: () => undefined,
      serve: async () => ({
        close: async () => {
          throw new Error('close failed');
        },
      }),
    }),
    /cleanup failed/
  );
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
