import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
import * as presentation from './markdown-presentation-build.mjs';
import {
  selectPresentationLock,
  canonicalVendorGraph,
  derivePresentationConsumer,
  assertPresentationInstallation,
} from './markdown-presentation-build.mjs';

const pkg = (version = '1.0.0', fields = {}) => ({
  version,
  resolved: 'https://registry.npmjs.org/example.tgz',
  integrity: 'sha512-example',
  ...fields,
});
const lock = (packages) => ({
  lockfileVersion: 3,
  packages: { '': {}, ...packages },
});
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value));

test('native presentation uses the installed application builder with strict real templates and TSX', () => {
  assert.equal(typeof presentation.presentationConfiguration, 'function');
  const { workspace, typescript } = presentation.presentationConfiguration();
  const build = workspace.projects.presentation.architect.build;
  assert.equal(build.builder, '@angular/build:application');
  assert.equal(build.options.browser, 'presentation.tsx');
  assert.equal(build.options.deployUrl, '/presentation-assets/');
  assert.equal(build.options.statsJson, true);
  assert.equal(typescript.angularCompilerOptions.strictTemplates, true);
  assert.equal(typescript.compilerOptions.skipLibCheck, false);
  assert.equal(typescript.compilerOptions.paths, undefined);
  assert.equal(typescript.compilerOptions.jsx, 'react-jsx');
});

test('strict template negative proof rejects resolution failures and requires the actual snapshot diagnostics', () => {
  assert.equal(typeof presentation.assertTemplateDiagnostic, 'function');
  presentation.assertTemplateDiagnostic(
    'missing',
    "NG8008: Required input 'snapshot' from component MarkdownComponent must be specified."
  );
  presentation.assertTemplateDiagnostic(
    'wrong',
    "TS2322: Type 'string' is not assignable to type 'MarkdownSnapshot'."
  );
  for (const diagnostic of [
    'Cannot find module @threadplane/angular/markdown',
    'Build failed',
    '',
  ])
    assert.throws(() =>
      presentation.assertTemplateDiagnostic('missing', diagnostic)
    );
});

test('frozen presentation requires all outputs and rejects missing, tampered and traversal records', (t) => {
  assert.equal(typeof presentation.readPresentation, 'function');
  const directory = mkdtempSync(
    join(tmpdir(), 'markdown-frozen-presentation-')
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, 'consumer/presentation-output/browser');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'index.html'), '<html>generated</html>');
  writeFileSync(join(output, 'main.js'), 'export {};');
  const record = (path) => ({
    path: 'presentation-output/browser/' + path,
    sha256: createHash('sha256')
      .update(readFileSync(join(output, path)))
      .digest('hex'),
  });
  const outputs = ['index.html', 'main.js'].map(record);
  const proof = {
    presentation: { shell: outputs[0].path, outputs, assets: [outputs[1]] },
    frozen: outputs.map((r) => ({ ...r, path: 'consumer/' + r.path })),
  };
  assert.equal(
    presentation.readPresentation(directory, proof).shell.toString(),
    '<html>generated</html>'
  );
  const missing = structuredClone(proof);
  missing.frozen.pop();
  assert.throws(
    () => presentation.readPresentation(directory, missing),
    /frozen/
  );
  const omitted = structuredClone(proof);
  omitted.presentation.outputs.pop();
  assert.throws(
    () => presentation.readPresentation(directory, omitted),
    /outputs/
  );
  const traversal = structuredClone(proof);
  traversal.presentation.assets[0].path =
    'presentation-output/browser/../browser/main.js';
  assert.throws(
    () => presentation.readPresentation(directory, traversal),
    /path/
  );
  writeFileSync(join(output, 'main.js'), 'tampered');
  assert.throws(
    () => presentation.readPresentation(directory, proof),
    /outputs|bytes/
  );
});
const fixture = () =>
  lock({
    'node_modules/a': pkg('1.0.0', { dependencies: { b: '^1.0.0' } }),
    'node_modules/b': pkg('1.0.0', { dependencies: { a: '^1.0.0' } }),
  });

test('selects exact root seeds despite earlier nested versions; never mutates root lock', () => {
  const root = lock({
    'node_modules/other/node_modules/a': pkg('2.0.0'),
    ...fixture().packages,
  });
  const before = JSON.stringify(root);
  const selected = selectPresentationLock(root, ['a']);
  assert.deepEqual(Object.keys(selected).sort(), [
    'node_modules/a',
    'node_modules/b',
  ]);
  assert.equal(selected['node_modules/a'].version, '1.0.0');
  assert.equal(JSON.stringify(root), before);
  delete root.packages['node_modules/a'];
  assert.throws(
    () => selectPresentationLock(root, ['a']),
    /Missing.*node_modules\/a/
  );
});

test('fails on missing required dependency and peer', () => {
  for (const edge of ['dependencies', 'peerDependencies']) {
    const root = lock({
      'node_modules/a': pkg('1.0.0', { [edge]: { missing: '*' } }),
    });
    assert.throws(
      () => selectPresentationLock(root, ['a']),
      /Missing.*missing/
    );
  }
});

test('does not seed optional peers merely installed elsewhere', () => {
  const root = lock({
    'node_modules/a': pkg('1.0.0', {
      peerDependencies: { optional: '*' },
      peerDependenciesMeta: { optional: { optional: true } },
    }),
    'node_modules/optional': pkg(),
  });
  assert.deepEqual(Object.keys(selectPresentationLock(root, ['a'])), [
    'node_modules/a',
  ]);
});

test('preserves all optional native platform records and their closure verbatim', () => {
  const root = lock({
    'node_modules/a': pkg('1.0.0', {
      optionalDependencies: { linux: '1.0.0', mac: '1.0.0' },
    }),
    'node_modules/linux': pkg('1.0.0', {
      optional: true,
      os: ['linux'],
      cpu: ['x64'],
      libc: ['musl'],
      dependencies: { child: '1.0.0' },
    }),
    'node_modules/mac': pkg('1.0.0', {
      optional: true,
      os: ['darwin'],
      cpu: ['arm64'],
    }),
    'node_modules/child': pkg('1.0.0', { optional: true }),
  });
  assert.deepEqual(
    selectPresentationLock(root, ['a']),
    Object.fromEntries(Object.entries(root.packages).filter(([path]) => path))
  );
});

test('cycles retain every required edge', () => {
  assert.deepEqual(canonicalVendorGraph(fixture(), ['a']), [
    { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0' } },
    { name: 'b', version: '1.0.0', dependencies: { a: '1.0.0' } },
  ]);
});

test('conflicting owner resolutions survive canonicalization', () => {
  const root = fixture();
  root.packages['node_modules/b/node_modules/a'] = pkg('1.2.0');
  assert.deepEqual(canonicalVendorGraph(root, ['a']), [
    { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0' } },
    { name: 'a', version: '1.2.0', dependencies: {} },
    { name: 'b', version: '1.0.0', dependencies: { a: '1.2.0' } },
  ]);
});

test('canonicalization tolerates duplicate physical records only with all the same edges', () => {
  const root = fixture();
  root.packages['node_modules/b/node_modules/a'] = structuredClone(
    root.packages['node_modules/a']
  );
  assert.equal(canonicalVendorGraph(root, ['a']).length, 2);
  root.packages['node_modules/b/node_modules/a'].dependencies = {};
  assert.equal(canonicalVendorGraph(root, ['a']).length, 3);
});

function consumerFixture(t) {
  const temporary = mkdtempSync(join(tmpdir(), 'markdown-install-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  const tarballs = {};
  for (const project of ['content', 'core', 'react', 'angular']) {
    const directory = join(temporary, project, 'package');
    mkdirSync(directory, { recursive: true });
    writeJson(join(directory, 'package.json'), {
      name: '@threadplane/' + project,
      version: '0.0.1',
      dependencies:
        project === 'content'
          ? { a: '^1.0.0' }
          : { '@threadplane/content': '0.0.1' },
    });
    writeFileSync(join(directory, 'index.js'), 'export {};');
    const tarball = join(temporary, project + '.tgz');
    execFileSync('tar', [
      '-czf',
      tarball,
      '-C',
      join(temporary, project),
      'package',
    ]);
    tarballs['@threadplane/' + project] = 'file:' + tarball;
    const installed = join(consumer, 'node_modules/@threadplane', project);
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      tarball,
      '--strip-components=1',
      '-C',
      installed,
    ]);
  }
  const root = fixture();
  for (const [path, record] of Object.entries(root.packages).filter(
    ([path]) => path
  )) {
    mkdirSync(join(consumer, path), { recursive: true });
    writeJson(join(consumer, path, 'package.json'), {
      name: path.split('/').at(-1),
      version: record.version,
      dependencies: record.dependencies,
    });
  }
  return { root, tarballs, consumer };
}

test('derives local records from packed manifests and byte integrity with exact seeds and no overrides', (t) => {
  const { root, tarballs } = consumerFixture(t);
  const derived = derivePresentationConsumer(root, tarballs, ['a']);
  assert.ok(
    derived.manifest && derived.lock,
    'Derived consumer manifest and lock required'
  );
  assert.equal(derived.manifest.dependencies.a, '1.0.0');
  assert.equal(derived.manifest.overrides, undefined);
  assert.deepEqual(derived.lock.packages[''], derived.manifest);
  assert.deepEqual(
    derived.lock.packages['node_modules/a'],
    root.packages['node_modules/a']
  );
  const record = derived.lock.packages['node_modules/@threadplane/content'];
  assert.deepEqual(record.dependencies, { a: '^1.0.0' });
  assert.equal(record.resolved, tarballs['@threadplane/content']);
  assert.equal(
    record.integrity,
    'sha512-' +
      createHash('sha512')
        .update(readFileSync(record.resolved.slice(5)))
        .digest('base64')
  );
});

test('independently rejects actual installed rangesatisfying drift with unchanged lock', (t) => {
  const input = consumerFixture(t);
  const derived = derivePresentationConsumer(input.root, input.tarballs, ['a']);
  assertPresentationInstallation(input.consumer, derived, input.tarballs);
  writeJson(join(input.consumer, 'node_modules/b/package.json'), {
    name: 'b',
    version: '1.1.0',
    dependencies: { a: '^1.0.0' },
  });
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /installed.*graph/i
  );
});

test('independently rejects installed seed drift even when a matching record exists nested', (t) => {
  const input = consumerFixture(t);
  const derived = derivePresentationConsumer(input.root, input.tarballs, ['a']);
  writeJson(join(input.consumer, 'node_modules/a/package.json'), {
    name: 'a',
    version: '1.1.0',
    dependencies: { b: '^1.0.0' },
  });
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /root selection/i
  );
});

test('rejects tarball resolution, integrity, archive byte and installed byte tampering', (t) => {
  const input = consumerFixture(t);
  const derived = derivePresentationConsumer(input.root, input.tarballs, ['a']);
  const path = 'node_modules/@threadplane/content';
  assert.ok(derived.lock, 'Derived consumer lock required');
  const wrongPath = structuredClone(derived);
  wrongPath.lock.packages[path].resolved = input.tarballs['@threadplane/react'];
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, wrongPath, input.tarballs),
    /selected tarball/
  );
  const wrongIntegrity = structuredClone(derived);
  wrongIntegrity.lock.packages[path].integrity = 'sha512-tampered';
  assert.throws(
    () =>
      assertPresentationInstallation(
        input.consumer,
        wrongIntegrity,
        input.tarballs
      ),
    /integrity/
  );
  const tarball = input.tarballs['@threadplane/content'].slice(5),
    bytes = readFileSync(tarball);
  writeFileSync(tarball, 'tampered');
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /integrity/
  );
  writeFileSync(tarball, bytes);
  writeFileSync(join(input.consumer, path, 'index.js'), 'tampered');
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /bytes equal/
  );
});
