import assert from 'node:assert/strict';
import {
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
  assertInstalledInputs,
  agUiVendorOverrides,
  consumerVendorGraph,
  installViolations,
} from './ag-ui-candidate-package.mjs';
import {
  lockedVendorGraph,
  vendorOverrides,
  fileHashes,
  sha256,
} from './langgraph-candidate-package.mjs';
import { reviewCandidate } from './verify-ag-ui-candidate.mjs';

const entry = 'fixtures/react-parity/ag-ui-candidate/entry';
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
  const root = mkdtempSync(join(tmpdir(), 'ag-ui-candidate-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'),
    output = join(root, 'package');
  mkdirSync(join(source, 'fixtures/react-parity/ag-ui-candidate'), {
    recursive: true,
  });
  mkdirSync(join(source, 'libs/ag-ui/src/runtime'), { recursive: true });
  writeFileSync(
    join(source, entry + '.ts'),
    "export { createSession } from '../../../libs/ag-ui/src/runtime/create-session.js';\nexport type { Session, SessionOptions } from '../../../libs/ag-ui/src/runtime/create-session.js';\nexport { projectTextTranscript } from '../../../libs/ag-ui/src/runtime/text-transcript.js';\nexport type { TextTranscriptRow } from '../../../libs/ag-ui/src/runtime/text-transcript.js';\n"
  );
  writeFileSync(
    join(source, 'libs/ag-ui/src/runtime/create-session.ts'),
    'export interface SessionOptions { threadId: string }\nexport interface Session { value: string }\nexport function createSession(options: SessionOptions): Session { return { value: options.threadId }; }'
  );
  writeFileSync(
    join(source, 'libs/ag-ui/src/runtime/text-transcript.ts'),
    'export type TextTranscriptRow = Readonly<{ id: string }>;\nexport function projectTextTranscript(rows: readonly TextTranscriptRow[]) { return rows; }'
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
  const manifest = {
    name: '@threadplane/ag-ui',
    version: '0.2.0',
    private: true,
    type: 'module',
    exports: {
      '.': {
        types: './' + entry + '.d.ts',
        import: './' + entry + '.js',
        default: './' + entry + '.js',
      },
    },
    files: [
      'fixtures/react-parity/ag-ui-candidate/entry.js',
      'fixtures/react-parity/ag-ui-candidate/entry.d.ts',
      'libs/ag-ui/src/**/*.js',
      'libs/ag-ui/src/**/*.d.ts',
    ],
    dependencies: { '@threadplane/core': '0.0.0', '@ag-ui/client': '1.0.1' },
  };
  writeFileSync(join(output, 'package.json'), JSON.stringify(manifest));
  return { output, manifest };
}
test('accepts an actual emitted direct forwarding graph', (t) => {
  assert.deepEqual(candidateViolations(fixture(t).output), []);
});
for (const path of [
  'libs/ag-ui/src/runtime/create-session.js',
  'libs/ag-ui/src/runtime/create-session.d.ts',
  'libs/ag-ui/src/runtime/text-transcript.js',
  'libs/ag-ui/src/runtime/text-transcript.d.ts',
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
test('rejects a wrapper and copied narrow declaration even when they compile', (t) => {
  const { output } = fixture(t);
  writeFileSync(
    join(output, entry + '.js'),
    'export function createSession() { return { value: "copied" }; }\nexport function projectTextTranscript(rows) { return rows; }'
  );
  writeFileSync(
    join(output, entry + '.d.ts'),
    'export declare function createSession(): { value: string };\nexport declare function projectTextTranscript(rows: string[]): string[];'
  );
  assert.ok(
    candidateViolations(output).filter((error) =>
      error.includes('direct forwarding')
    ).length >= 2
  );
});
test('rejects source files and undeclared own imports', (t) => {
  const { output, manifest } = fixture(t);
  writeFileSync(
    join(output, 'libs/ag-ui/src/runtime/source.ts'),
    'export const copied = true;'
  );
  writeFileSync(
    join(output, 'libs/ag-ui/src/runtime/create-session.js'),
    "export { createSession } from '@threadplane/angular';"
  );
  manifest.dependencies['@threadplane/angular'] = '0.0.0';
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
test('installed provenance permits real package-contained libs paths and rejects source substitution', (t) => {
  const { output } = fixture(t);
  const consumer = join(output, 'consumer');
  const target = join(consumer, 'node_modules/@threadplane/ag-ui');
  mkdirSync(target, { recursive: true });
  const files = {
    '@threadplane/ag-ui': [
      { path: 'libs/ag-ui/src/runtime/create-session.js', sha256: 'expected' },
    ],
  };
  assert.throws(
    () =>
      assertInstalledInputs(
        consumer,
        [join(output, 'libs/ag-ui/src/runtime/create-session.js')],
        files
      ),
    /outside installed/
  );
  writeFileSync(join(target, 'copied.js'), 'export const copied = true;');
  assert.throws(
    () => assertInstalledInputs(consumer, [join(target, 'copied.js')], files),
    /not in installed artifact/
  );
  mkdirSync(join(target, 'libs/ag-ui/src/runtime'), { recursive: true });
  writeFileSync(
    join(target, 'libs/ag-ui/src/runtime/create-session.js'),
    'export const installed = true;'
  );
  assert.doesNotThrow(() =>
    assertInstalledInputs(
      consumer,
      [
        'node_modules/@threadplane/ag-ui/libs/ag-ui/src/runtime/create-session.js',
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
  assert.throws(
    () =>
      agUiVendorOverrides([
        ...vendors,
        { name: 'zod', version: '3.24.0', dependencies: {} },
      ]),
    /multiple versions/
  );
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
        fileURLToPath(new URL('./verify-ag-ui-candidate.mjs', import.meta.url)),
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
