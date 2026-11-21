import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import {
  candidateViolations,
  emitCandidate,
  reviewedSources,
  assertInstalledInputs,
  agUiVendorOverrides,
  consumerVendorGraph,
  installViolations,
} from './ag-ui-package.mjs';
import {
  backendPackageShape,
  lockedVendorGraph,
  vendorOverrides,
  fileHashes,
  sha256,
} from './langgraph-package.mjs';
import { reviewCandidate } from './verify-ag-ui-package.mjs';

const entry = 'src/public-api';
test('Library CI bootstraps the canonical client-tools lock before its worker tests and installed package proof', () => {
  const workflow = readFileSync(
    fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)),
    'utf8'
  );
  const library = workflow
    .split('\n  library:\n')[1]
    ?.split('\n  angular-compatibility:\n')[0];
  assert.ok(library, 'Actual Library workflow job');
  const steps = library.split('\n      - ').slice(1);
  const setup = steps.findIndex(
    (step) =>
      step.includes('uses: astral-sh/setup-uv@') &&
      step.includes("python-version: '3.12'")
  );
  const bootstrap = steps.findIndex((step) =>
    step.startsWith('name: Prepare canonical AG-UI client-tools fixture\n')
  );
  const tests = steps.findIndex((step) =>
    step.startsWith('name: Verify canonical AG-UI client-tools fixtures\n')
  );
  const candidate = steps.findIndex((step) =>
    step.startsWith('name: Verify the installed AG-UI package\n')
  );
  assert.ok(
    setup >= 0 && bootstrap > setup && tests > bootstrap && candidate > tests,
    'Python setup then frozen client-tools sync then scoped fixture checks then installed proof'
  );
  assert.match(
    library,
    /THREADPLANE_AG_UI_FIXTURE_ENVIRONMENT: \/tmp\/threadplane-agui-client-tools-native-fixture-env/
  );
  assert.match(
    steps[bootstrap],
    /UV_PYTHON=3\.12 UV_PROJECT_ENVIRONMENT="\$THREADPLANE_AG_UI_FIXTURE_ENVIRONMENT" uv sync --frozen --no-install-project --project cockpit\/ag-ui\/client-tools\/python/
  );
  assert.match(
    steps[tests],
    /node --test scripts\/react-parity\/ag-ui-package\.spec\.mjs fixtures\/react-parity\/native-ag-ui-client-tools\/server\.spec\.mjs/
  );
  assert.match(
    steps[candidate],
    /run: node scripts\/react-parity\/verify-ag-ui-package\.mjs/
  );
});
test('mixed AG-UI graph includes local content parser and rejects a missing or changed edge', () => {
  const local = {
    '@threadplane/content': {
      version: '0.0.0',
      dependencies: { '@cacheplane/partial-markdown': '^0.5.8' },
    },
  };
  const lock = {
    packages: {
      'node_modules/@ag-ui/client': { version: '1.0.1' },
      'node_modules/@cacheplane/partial-markdown': { version: '0.5.8' },
    },
  };
  const expected = consumerVendorGraph(lock, {}, {}, local);
  assert.ok(
    expected.some(
      ({ name, version }) =>
        name === '@cacheplane/partial-markdown' && version === '0.5.8'
    )
  );
  lock.packages['node_modules/@cacheplane/partial-markdown'].version = '0.5.9';
  assert.throws(
    () => assert.deepEqual(consumerVendorGraph(lock, {}, {}, local), expected),
    /Expected values/
  );
  delete lock.packages['node_modules/@cacheplane/partial-markdown'];
  assert.throws(
    () => consumerVendorGraph(lock, {}, {}, local),
    /Missing locked dependency.*partial-markdown/
  );
  assert.deepEqual(consumerVendorGraph(lock, {}), [
    { name: '@ag-ui/client', version: '1.0.1', dependencies: {} },
  ]);
});
test('AG-UI requires every selected local package and rejects a parser in the backend-only consumer', () => {
  assert.ok(
    installViolations({ packages: {} }, ['@threadplane/content'], true).some(
      (error) => /Missing.*content/.test(error)
    )
  );
  assert.ok(
    installViolations(
      {
        packages: {
          'node_modules/@cacheplane/partial-markdown': { version: '0.5.8' },
        },
      },
      [],
      false
    ).some((error) => /Backend.*partial-markdown/.test(error))
  );
});
test('mixed consumers pin and compare framework and type descendants by owner, not hoist path', () => {
  const manifest = {
    dependencies: { 'react-dom': '19.0.0' },
    devDependencies: { '@types/react': '19.0.0' },
  };
  const lock = {
    packages: {
      'node_modules/@ag-ui/client': { version: '1.0.1' },
      'node_modules/react-dom': {
        version: '19.0.0',
        dependencies: { scheduler: '^0.25.0' },
      },
      'node_modules/scheduler': { version: '0.25.0' },
      'node_modules/@types/react': {
        version: '19.0.0',
        dependencies: { csstype: '^3.1.0' },
      },
      'node_modules/csstype': { version: '3.1.3' },
    },
  };
  const expected = consumerVendorGraph(lock, manifest);
  assert.deepEqual(
    expected.map(({ name }) => name),
    ['@ag-ui/client', '@types/react', 'csstype', 'react-dom', 'scheduler']
  );
  const pins = agUiVendorOverrides(expected);
  assert.equal(pins.csstype, '3.1.3');
  assert.equal(pins.scheduler, '0.25.0');
  const hoisted = structuredClone(lock);
  hoisted.packages['node_modules/@types/react/node_modules/csstype'] =
    hoisted.packages['node_modules/csstype'];
  delete hoisted.packages['node_modules/csstype'];
  assert.deepEqual(consumerVendorGraph(hoisted, manifest), expected);
  hoisted.packages['node_modules/@types/react/node_modules/csstype'].version =
    '3.1.4';
  assert.throws(() =>
    assert.deepEqual(consumerVendorGraph(hoisted, manifest), expected)
  );
  assert.deepEqual(
    consumerVendorGraph(lock, {}),
    lockedVendorGraph(lock, ['@ag-ui/client'])
  );
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ag-ui-package-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'),
    output = join(root, 'package');
  mkdirSync(join(source, 'src/runtime'), { recursive: true });
  writeFileSync(
    join(source, entry + '.ts'),
    "export { createSession } from './runtime/create-session.js';\nexport type { Session, SessionOptions, ClientToolSession } from './runtime/create-session.js';\nexport type { ClientToolSessionSnapshot, ClientToolCall, ClientToolBlocker } from './runtime/client-tools.js';\nexport { projectTextTranscript } from './runtime/text-transcript.js';\nexport type { TextTranscriptRow } from './runtime/text-transcript.js';\nexport { projectMessages, projectToolCalls } from './runtime/message-projection.js';\nexport { decisionState } from './runtime/decision.js';\nexport type { DecisionState } from './runtime/decision.js';\n"
  );
  writeFileSync(
    join(source, 'src/runtime/create-session.ts'),
    "import { createPresenter } from './agent-session.js';\nexport interface SessionOptions { threadId: string }\nexport interface Session { value: string }\nexport type ClientToolSession = Session;\nexport function createSession(options: SessionOptions): Session { return { value: createPresenter()(options.threadId) }; }"
  );
  writeFileSync(
    join(source, 'src/runtime/client-tools.ts'),
    'export interface ClientToolSessionSnapshot {}\nexport interface ClientToolCall {}\nexport interface ClientToolBlocker {}'
  );
  writeFileSync(
    join(source, 'src/runtime/text-transcript.ts'),
    'export type TextTranscriptRow = Readonly<{ id: string }>;\nexport function projectTextTranscript(rows: readonly TextTranscriptRow[]) { return rows; }'
  );
  writeFileSync(
    join(source, 'src/runtime/message-projection.ts'),
    'export function projectMessages(snapshot: object) { return [snapshot]; }\nexport function projectToolCalls(snapshot: object) { return [snapshot]; }'
  );
  writeFileSync(
    join(source, 'src/runtime/agent-session.ts'),
    'export function createPresenter() { return (value: string) => value; }'
  );
  writeFileSync(
    join(source, 'src/runtime/decision.ts'),
    'export type DecisionState = Readonly<{ kind: string }>;\nexport function decisionState(snapshot: object): DecisionState | undefined { return snapshot ? undefined : undefined; }'
  );
  writeFileSync(join(source, 'package.json'), '{"type":"module"}');
  const program = ts.createProgram([join(source, entry + '.ts')], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    declaration: true,
    rootDir: source,
    outDir: output,
    strict: true,
    skipLibCheck: false,
    types: [],
  });
  assert.deepEqual(ts.getPreEmitDiagnostics(program), []);
  assert.equal(program.emit().emitSkipped, false);
  // The published shape: public, peers only, the root at src/public-api.
  const manifest = {
    name: '@threadplane/ag-ui',
    version: '0.3.7',
    type: 'module',
    peerDependencies: {
      '@threadplane/core': '0.3.7',
      '@ag-ui/client': '^1.0.1',
      rxjs: '~7.8.0',
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
test('accepts an actual emitted graph in the published layout', (t) => {
  assert.deepEqual(candidateViolations(fixture(t).output), []);
});
test('accepts type-only core tools but rejects runtime and unrelated subpaths', (t) => {
  const { output } = fixture(t);
  const path = join(output, 'src/runtime/create-session.d.ts');
  writeFileSync(
    path,
    readFileSync(path, 'utf8') +
      "\nimport type { CheckedTools } from '@threadplane/core/tools';\n"
  );
  assert.deepEqual(candidateViolations(output), []);
  writeFileSync(
    join(output, 'src/runtime/create-session.js'),
    "import '@threadplane/core/tools';\n"
  );
  assert.ok(
    candidateViolations(output).some((error) =>
      error.includes('Forbidden candidate import')
    )
  );
  writeFileSync(
    path,
    "import type { X } from '@threadplane/core/unrelated';\n"
  );
  assert.ok(
    candidateViolations(output).some((error) =>
      error.includes('core/unrelated')
    )
  );
});
test('RxJS is admitted as the SDK stream type; Angular, chat and other frameworks are not', (t) => {
  const { output } = fixture(t);
  const path = join(output, 'src/runtime/create-session.js');
  const original = readFileSync(path, 'utf8');
  writeFileSync(path, "import { Observable } from 'rxjs';\n" + original);
  assert.deepEqual(candidateViolations(output), []);
  for (const specifier of [
    '@angular/core',
    '@threadplane/angular/chat',
    '@threadplane/angular',
    'react',
    'rxjs/operators',
    '@ag-ui/core',
    '@langchain/langgraph-sdk',
  ]) {
    writeFileSync(path, `import '${specifier}';\n` + original);
    assert.ok(
      candidateViolations(output).some(
        (error) =>
          error.includes('Forbidden candidate import') &&
          error.includes(specifier)
      ),
      specifier
    );
  }
});
test('rejects an unreviewed emitted module within the backend tree', (t) => {
  const { output } = fixture(t);
  writeFileSync(
    join(output, 'src/runtime/unrelated.js'),
    'export const unexpected = true;'
  );
  assert.ok(
    candidateViolations(output).some((error) =>
      error.includes('Unexpected candidate file')
    )
  );
});
for (const path of [
  'src/public-api.js',
  'src/public-api.d.ts',
  'src/runtime/create-session.js',
  'src/runtime/create-session.d.ts',
  'src/runtime/text-transcript.js',
  'src/runtime/text-transcript.d.ts',
  'src/runtime/message-projection.js',
  'src/runtime/message-projection.d.ts',
  'src/runtime/agent-session.js',
  'src/runtime/agent-session.d.ts',
  'src/runtime/decision.js',
  'src/runtime/decision.d.ts',
])
  test('rejects missing actual output ' + path, (t) => {
    const { output } = fixture(t);
    rmSync(join(output, path));
    assert.ok(
      candidateViolations(output).some((error) =>
        error.includes('Missing emitted')
      )
    );
  });
test('rejects extensionless declaration and implementation edges', (t) => {
  const { output } = fixture(t);
  for (const suffix of ['.js', '.d.ts']) {
    const path = join(output, entry + suffix);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('create-session.js', 'create-session')
    );
  }
  assert.ok(
    candidateViolations(output).filter((error) =>
      error.includes('Extensionless')
    ).length >= 2
  );
});
for (const [label, change, expected] of [
  ['a private manifest', (m) => ({ ...m, private: true }), 'identity'],
  [
    'the retired forwarding entry as its root',
    (m) => ({
      ...m,
      exports: {
        ...m.exports,
        '.': './fixtures/react-parity/ag-ui-candidate/entry.js',
      },
    }),
    'exports',
  ],
  [
    'an Angular peer',
    (m) => ({
      ...m,
      peerDependencies: { ...m.peerDependencies, '@angular/core': '*' },
    }),
    'candidate dependency',
  ],
  [
    'a chat peer',
    (m) => ({
      ...m,
      peerDependencies: { ...m.peerDependencies, '@threadplane/angular/chat': '*' },
    }),
    'candidate dependency',
  ],
  ['a dependency', (m) => ({ ...m, dependencies: { zod: '*' } }), 'install metadata'],
])
  test(`rejects ${label}`, (t) => {
    const { output, manifest } = fixture(t);
    writeFileSync(join(output, 'package.json'), JSON.stringify(change(manifest)));
    assert.ok(
      candidateViolations(output).some((error) => error.includes(expected)),
      candidateViolations(output).join('\n')
    );
  });
test('rejects source files and undeclared own imports', (t) => {
  const { output, manifest } = fixture(t);
  writeFileSync(
    join(output, 'src/runtime/source.ts'),
    'export const copied = true;'
  );
  writeFileSync(
    join(output, 'src/runtime/create-session.js'),
    "export { createSession } from '@threadplane/angular';"
  );
  manifest.peerDependencies['@threadplane/angular'] = '0.3.7';
  writeFileSync(join(output, 'package.json'), JSON.stringify(manifest));
  const errors = candidateViolations(output);
  assert.ok(
    errors.some((error) => error.includes('Unexpected candidate file'))
  );
  assert.ok(
    errors.some((error) => error.includes('Forbidden candidate import'))
  );
  assert.ok(
    errors.some((error) => error.includes('Forbidden candidate dependency'))
  );
});
test('the real source is exactly the reviewed module set, in the published layout', (t) => {
  const repository = join(fileURLToPath(new URL('../..', import.meta.url)));
  if (!existsSync(join(repository, 'dist/libs/core/package.json'))) {
    t.skip('Requires built core declarations.');
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), 'ag-ui-package-emit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const emission = emitCandidate(repository, join(directory, 'emitted'));
  assert.deepEqual(
    emission.sources.map((source) => source.path),
    reviewedSources
  );
  assert.deepEqual(candidateViolations(join(directory, 'emitted')), []);
  assert.ok(reviewedSources.includes('libs/ag-ui/src/public-api.ts'));
  assert.ok(reviewedSources.every((path) => !path.includes('/lib/')));
});
test('installed provenance permits real package-contained paths and rejects source substitution', (t) => {
  const { output } = fixture(t);
  const consumer = join(output, 'consumer');
  const target = join(consumer, 'node_modules/@threadplane/ag-ui');
  mkdirSync(target, { recursive: true });
  const files = {
    '@threadplane/ag-ui': [
      { path: 'src/runtime/create-session.js', sha256: 'expected' },
    ],
  };
  assert.throws(
    () =>
      assertInstalledInputs(
        consumer,
        [join(output, 'src/runtime/create-session.js')],
        files
      ),
    /outside installed/
  );
  writeFileSync(join(target, 'copied.js'), 'export const copied = true;');
  assert.throws(
    () => assertInstalledInputs(consumer, [join(target, 'copied.js')], files),
    /not in installed artifact/
  );
  mkdirSync(join(target, 'src/runtime'), { recursive: true });
  writeFileSync(
    join(target, 'src/runtime/create-session.js'),
    'export const installed = true;'
  );
  assert.doesNotThrow(() =>
    assertInstalledInputs(
      consumer,
      [
        'node_modules/@threadplane/ag-ui/src/runtime/create-session.js',
      ],
      { '@threadplane/ag-ui': fileHashes(target) }
    )
  );
});
test('AG-UI resolves and pins its nested RxJS/Zod graph independently of LangGraph defaults', () => {
  const lock = {
    packages: {
      'node_modules/@ag-ui/client': {
        version: '1.0.1',
        dependencies: { rxjs: '^7.8.0', zod: '^3.25.0' },
      },
      'node_modules/@ag-ui/client/node_modules/zod': { version: '3.25.76' },
      'node_modules/zod': { version: '4.0.0' },
      'node_modules/rxjs': { version: '7.8.2' },
    },
  };
  const vendors = lockedVendorGraph(lock, ['@ag-ui/client']);
  assert.deepEqual(vendorOverrides(vendors, ['@ag-ui/client']), {
    '@ag-ui/client@1.0.1': {
      '.': '1.0.1',
      'rxjs@7.8.2': '7.8.2',
      'zod@3.25.76': '3.25.76',
    },
  });
  assert.equal(agUiVendorOverrides(vendors).zod, '3.25.76');
  const mixed = agUiVendorOverrides([
    ...vendors,
    {
      name: '@json-render/core',
      version: '0.16.0',
      dependencies: { zod: '4.3.6' },
    },
    { name: 'zod', version: '4.3.6', dependencies: {} },
  ]);
  assert.equal(mixed['zod@3.25.76'], '3.25.76');
  assert.equal(mixed['zod@4.3.6'], '4.3.6');
  assert.equal(
    mixed.zod,
    undefined,
    'Do not flatten incompatible schema versions'
  );
  assert.equal(mixed['@ag-ui/client']['zod@3.25.76'], '3.25.76');
  assert.equal(mixed['@json-render/core']['zod@4.3.6'], '4.3.6');
  lock.packages['node_modules/@ag-ui/client/node_modules/zod'].version =
    '4.0.0';
  assert.throws(
    () => lockedVendorGraph(lock, ['@ag-ui/client']),
    /must satisfy/
  );
});
test('only an explicit existing effective range permits the overridden SDK dependency', () => {
  const lock = {
    packages: {
      'node_modules/@ag-ui/client': {
        version: '1.0.1',
        dependencies: { rxjs: '7.8.1' },
      },
      'node_modules/rxjs': { version: '7.8.2' },
    },
  };
  assert.throws(
    () => lockedVendorGraph(lock, ['@ag-ui/client']),
    /must satisfy/
  );
  const expected = lockedVendorGraph(lock, ['@ag-ui/client'], {
    rxjs: '~7.8.0',
  });
  assert.equal(
    expected.find((vendor) => vendor.name === 'rxjs').version,
    '7.8.2'
  );
  // The SDK asks for exactly 7.8.1. A selector qualified with the resolved
  // 7.8.2 would not apply the existing root override to that request.
  assert.equal(agUiVendorOverrides(expected).rxjs, '7.8.2');
  lock.packages['node_modules/rxjs'].version = '8.0.0';
  assert.throws(
    () => lockedVendorGraph(lock, ['@ag-ui/client'], { rxjs: '~7.8.0' }),
    /must satisfy/
  );
  lock.packages['node_modules/rxjs'].version = '7.8.1';
  assert.throws(() =>
    assert.deepEqual(
      lockedVendorGraph(lock, ['@ag-ui/client'], { rxjs: '~7.8.0' }),
      expected
    )
  );
});
test('shared descendants receive a top-level pin as well as both recursive paths', () => {
  const vendors = [
    {
      name: '@ag-ui/client',
      version: '1.0.1',
      dependencies: { '@ag-ui/encoder': '1.0.1', '@ag-ui/proto': '1.0.1' },
    },
    {
      name: '@ag-ui/encoder',
      version: '1.0.1',
      dependencies: { '@ag-ui/proto': '1.0.1' },
    },
    {
      name: '@ag-ui/proto',
      version: '1.0.1',
      dependencies: { '@bufbuild/protobuf': '2.11.0' },
    },
    { name: '@bufbuild/protobuf', version: '2.11.0', dependencies: {} },
  ];
  const pins = agUiVendorOverrides(vendors);
  assert.equal(pins['@bufbuild/protobuf'], '2.11.0');
  assert.equal(
    pins['@ag-ui/client']['@ag-ui/proto@1.0.1']['@bufbuild/protobuf@2.11.0'],
    '2.11.0'
  );
  assert.equal(
    pins['@ag-ui/client']['@ag-ui/encoder@1.0.1']['@ag-ui/proto@1.0.1'][
      '@bufbuild/protobuf@2.11.0'
    ],
    '2.11.0'
  );
});
function retainedFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ag-ui-retained-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'consumer'));
  writeFileSync(
    join(directory, 'consumer/browser.js'),
    'export const retained = true;'
  );
  writeFileSync(
    join(directory, 'provenance.json'),
    JSON.stringify({
      tarballs: [],
      installed: {},
      node: { artifacts: {} },
      browser: { bundleSha256: sha256('export const retained = true;') },
    })
  );
  return directory;
}
test('review rejects altered browser bytes and an already-aborted startup before serving', async (t) => {
  const directory = retainedFixture(t);
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(
    reviewCandidate(directory, stopped.signal),
    /startup aborted/
  );
  writeFileSync(join(directory, 'consumer/browser.js'), 'changed');
  await assert.rejects(
    reviewCandidate(directory, new AbortController().signal),
    /Frozen candidate browser bytes/
  );
});
test(
  'retained review CLI serves its frozen bytes and SIGTERM closes its owned server',
  { timeout: 10000 },
  async (t) => {
    const directory = retainedFixture(t);
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('./verify-ag-ui-package.mjs', import.meta.url)),
        '--review',
        directory,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let output = '',
      errors = '',
      exited = false;
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    child.on('exit', () => {
      exited = true;
    });
    async function until(predicate) {
      const deadline = Date.now() + 4000;
      while (!predicate()) {
        assert.ok(
          Date.now() < deadline,
          'Owned review process reached its bounded deadline'
        );
        await delay(10);
      }
    }
    try {
      await until(() => output.includes('\n') || exited);
      assert.equal(exited, false, errors);
      const { url } = JSON.parse(output.trim());
      const response = await fetch(url + '/app.js', {
        signal: AbortSignal.timeout(2000),
      });
      assert.equal(await response.text(), 'export const retained = true;');
      child.kill('SIGTERM');
      await until(() => exited);
      assert.equal(child.exitCode, 0, errors);
      await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
    } finally {
      if (!exited) child.kill('SIGKILL');
      await until(() => exited);
    }
  }
);
test('installed type provenance rejects copied declarations even under a legitimate package path', (t) => {
  const directory = retainedFixture(t),
    target = join(directory, 'node_modules/@threadplane/ag-ui');
  mkdirSync(join(target, 'libs/ag-ui/src/runtime'), { recursive: true });
  const file = 'libs/ag-ui/src/runtime/create-session.d.ts';
  writeFileSync(
    join(target, file),
    'export declare function createSession(): { actual: true };'
  );
  const expected = { '@threadplane/ag-ui': fileHashes(target) };
  writeFileSync(
    join(target, file),
    'export declare function createSession(): { copied: true };'
  );
  assert.throws(
    () =>
      assertInstalledInputs(
        directory,
        ['node_modules/@threadplane/ag-ui/' + file],
        expected
      ),
    /bytes differ/
  );
});
