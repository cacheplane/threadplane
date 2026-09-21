import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import * as packageVerifier from './verify-packages.mjs';
const { validatePackage } = packageVerifier;

test('installed native contracts reject the former empty scaffold exports', () => {
  assert.equal(typeof packageVerifier.assertSupportedExports, 'function');
  assert.throws(() => packageVerifier.assertSupportedExports('core', {}), /completeDelivery/);
  assert.throws(() => packageVerifier.assertSupportedExports('react', {}), /useAgent/);
  assert.doesNotThrow(() => packageVerifier.assertSupportedExports('react', { useAgent: () => undefined }));
});

function fixture(t, change = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'threadplane-package-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manifest = { name: '@threadplane/react', private: true, type: 'module', license: 'MIT', exports: { '.': { types: './src/index.d.ts', import: './src/index.js', default: './src/index.js' } }, ...change.manifest };
  const files = { 'package.json': JSON.stringify(manifest), 'README.md': 'Private scaffolding', 'LICENSE.md': 'MIT', 'src/index.js': "'use client';\nexport {};", 'src/index.d.ts': 'export {};', ...change.files };
  for (const [path, text] of Object.entries(files)) if (text !== null) { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), text); }
  return directory;
}
test('accepts private ESM exports with declarations and client directive', (t) => assert.deepEqual(validatePackage(fixture(t)), []));
test('private core rejects CommonJS executable exports', (t) => {
  const directory = fixture(t, { manifest: { name: '@threadplane/core', exports: { '.': { types: './src/index.d.ts', import: './src/index.cjs', default: './src/index.cjs' } } }, files: { 'src/index.cjs': 'module.exports = {};' } });
  assert.ok(validatePackage(directory).some((error) => error.includes('runtime must resolve to JavaScript')));
});
test('validates final package manifests separately from private scaffolding', (t) => {
  const directory = fixture(t, { manifest: { name: '@threadplane/render', private: false } });
  assert.deepEqual(validatePackage(directory, { angularTransitions: [] }), []);
});
test('package validation rejects final-role manifest dependencies without imports', (t) => {
  const directory = fixture(t, { manifest: { name: '@threadplane/render', dependencies: { '@threadplane/content': '*' } } });
  assert.ok(validatePackage(directory, { angularTransitions: [] }).some((error) => error.includes('forbidden dependencies')));
});
const angularManifest = { name: '@threadplane/angular', exports: { './package.json': { default: './package.json' }, '.': { types: './types/threadplane-angular.d.ts', default: './fesm2022/threadplane-angular.mjs' } } };
const angularFiles = { 'types/threadplane-angular.d.ts': 'export {};', 'fesm2022/threadplane-angular.mjs': 'export {};' };
test('package validation accepts private Angular APF declarations and default ESM exports', (t) => {
  const directory = fixture(t, { manifest: angularManifest, files: angularFiles });
  assert.deepEqual(validatePackage(directory), []);
});
test('APF metadata exports are excluded from executable consumer imports', () => {
  assert.equal(typeof packageVerifier.consumerSpecifiers, 'function');
  assert.deepEqual(packageVerifier.consumerSpecifiers(angularManifest), ['@threadplane/angular']);
});
for (const [label, change] of [
  ['public Angular manifest', { manifest: { ...angularManifest, private: false }, files: angularFiles }],
  ['missing Angular declaration', { manifest: angularManifest, files: { ...angularFiles, 'types/threadplane-angular.d.ts': null } }],
  ['missing Angular executable', { manifest: angularManifest, files: { ...angularFiles, 'fesm2022/threadplane-angular.mjs': null } }],
  ['missing Angular root', { manifest: { ...angularManifest, exports: { './package.json': { default: './package.json' } } }, files: angularFiles }],
  ['missing Angular readme', { manifest: angularManifest, files: { ...angularFiles, 'README.md': null } }],
  ['missing Angular license', { manifest: angularManifest, files: { ...angularFiles, 'LICENSE.md': null } }],
  ['Angular CommonJS', { manifest: { ...angularManifest, exports: { '.': { types: './types/threadplane-angular.d.ts', default: './index.cjs' } } }, files: { ...angularFiles, 'index.cjs': 'module.exports = {};' } }],
  ['Angular test artifact', { manifest: angularManifest, files: { ...angularFiles, 'leak.type-test.ts': 'export {};' } }],
  ['Angular test setup', { manifest: angularManifest, files: { ...angularFiles, 'test-setup.js': 'export {};' } }],
  ['Angular raw source', { manifest: angularManifest, files: { ...angularFiles, 'public-api.ts': 'export {};' } }],
  ['Angular runtime disguised as metadata', { manifest: { ...angularManifest, exports: { ...angularManifest.exports, './package.json': { default: './README.md' } } }, files: angularFiles }],
  ['missing exported metadata asset', { manifest: { ...angularManifest, exports: { ...angularManifest.exports, './missing.json': { default: './missing.json' } } }, files: angularFiles }],
]) test(`rejects ${label}`, (t) => assert.ok(validatePackage(fixture(t, change)).length > 0));
for (const project of ['core', 'content', 'react']) {
  test(`${project} still requires an import condition`, (t) => {
    const directory = fixture(t, { manifest: { name: `@threadplane/${project}`, exports: { '.': { types: './src/index.d.ts', default: './src/index.js' } } } });
    assert.ok(validatePackage(directory).some((error) => error.includes('requires types, import and default')));
  });
}
test('final packages reject non-JavaScript executable exports', (t) => {
  const directory = fixture(t, { manifest: { name: '@threadplane/render', exports: { '.': { types: './src/index.d.ts', default: './README.md' } } } });
  assert.ok(validatePackage(directory).some((error) => error.includes('runtime must resolve to JavaScript')));
});
for (const project of ['render', 'react']) {
  test(`${project} metadata asset subpaths remain valid`, (t) => {
    const directory = fixture(t, { manifest: { name: `@threadplane/${project}`, exports: { '.': { types: './src/index.d.ts', import: './src/index.js', default: './src/index.js' }, './README.md': './README.md' } } });
    assert.deepEqual(validatePackage(directory), []);
  });
}
for (const entry of [null, 42, []]) {
  test(`malformed export ${JSON.stringify(entry)} produces a validation error`, (t) => {
    const directory = fixture(t, { manifest: { name: '@threadplane/render', exports: { '.': entry } } });
    assert.ok(validatePackage(directory).length > 0);
  });
}
for (const [label, change] of [
  ['public manifest', { manifest: { private: false } }],
  ['missing declaration target', { files: { 'src/index.d.ts': null } }],
  ['missing root export', { manifest: { exports: {} } }],
  ['non-declaration types target', { manifest: { exports: { '.': { types: './src/index.js', import: './src/index.js', default: './src/index.js' } } } }],
  ['missing license', { files: { 'LICENSE.md': null } }],
  ['missing readme', { files: { 'README.md': null } }],
  ['lost client directive', { files: { 'src/index.js': 'export {};' } }],
  ['lost default client directive', { manifest: { exports: { '.': { types: './src/index.d.ts', import: './src/index.js', default: './src/default.js' } } }, files: { 'src/default.js': 'export {};' } }],
  ['production test artifact', { files: { 'src/leak.spec.js': 'export {};' } }],
  ['escaping export', { manifest: { exports: { '.': { import: '../outside.js', types: './src/index.d.ts' } } } }],
  ['missing import condition', { manifest: { exports: { '.': { types: './src/index.d.ts' } } } }],
  ['non-JavaScript runtime', { manifest: { exports: { '.': { types: './src/index.d.ts', import: './runtime.txt', default: './runtime.txt' } } }, files: { 'runtime.txt': 'export {};' } }],
]) test(`rejects ${label}`, (t) => assert.ok(validatePackage(fixture(t, change)).length > 0));

const lockFor = (names) => ({ packages: Object.fromEntries(names.map((name) => [`node_modules/${name}`, { version: '1.0.0', resolved: name.startsWith('@threadplane/') ? 'file:/tmp/local.tgz' : 'https://registry.npmjs.org/pkg.tgz' }])) });
test('isolated graph distinguishes installation footprint from bundle inputs', () => {
  assert.equal(typeof packageVerifier.installGraphViolations, 'function');
  assert.deepEqual(packageVerifier.installGraphViolations(lockFor(['@threadplane/core']), 'core'), []);
  assert.ok(packageVerifier.installGraphViolations(lockFor(['@threadplane/core', 'tslib']), 'core').length);
  for (const name of ['@angular/core', '@langchain/core', '@ag-ui/client']) assert.ok(packageVerifier.installGraphViolations(lockFor([name]), 'plain').length);
  for (const name of ['react', '@types/react', '@langchain/langgraph-sdk']) assert.ok(packageVerifier.installGraphViolations(lockFor([name]), 'angular').length);
  assert.deepEqual(packageVerifier.installGraphViolations(lockFor(['@threadplane/react', 'react', 'marked']), 'plain'), []);
});
test('consumer graph refuses registry Threadplane resolutions even when nested', () => {
  const lock = lockFor(['@threadplane/core']);
  lock.packages['node_modules/@threadplane/core'].resolved = 'https://registry.npmjs.org/@threadplane/core/-/core.tgz';
  assert.equal(typeof packageVerifier.installGraphViolations, 'function');
  assert.ok(packageVerifier.installGraphViolations(lock, 'plain').some((e) => e.includes('local tarball')));
  assert.ok(packageVerifier.installGraphViolations(lockFor(['x/node_modules/@angular/core']), 'plain').length);
});
test('root bundle evidence rejects parser inputs, not parser strings in generated code', () => {
  assert.equal(typeof packageVerifier.assertParserFreeInputs, 'function');
  assert.doesNotThrow(() => packageVerifier.assertParserFreeInputs({ 'node_modules/@threadplane/react/src/index.js': {} }));
  for (const name of ['marked', '@cacheplane/partial-json', '@cacheplane/partial-markdown', 'remark-gfm', 'katex', 'shiki']) assert.throws(() => packageVerifier.assertParserFreeInputs({ [`node_modules/${name}/index.js`]: {} }), /parser/);
  assert.throws(() => packageVerifier.assertParserFreeInputs(undefined), /inputs/);
});
test('packing selects only actual local Threadplane dependency closure', () => {
  assert.equal(typeof packageVerifier.localDependencyProjects, 'function');
  const manifests = { angular: { version: '0.0.0', peerDependencies: { '@angular/core': '^21' } }, core: { version: '0.0.0' }, content: { version: '0.0.0', dependencies: { '@threadplane/core': '*' } } };
  assert.deepEqual(packageVerifier.localDependencyProjects(['angular'], (p) => manifests[p]), ['angular']);
  assert.deepEqual(packageVerifier.localDependencyProjects(['content'], (p) => manifests[p]), ['content', 'core']);
  assert.throws(() => packageVerifier.localDependencyProjects(['content'], () => ({ dependencies: { '@threadplane/missing': '*' } })), /local/);
});
test('local tarball selection refuses incompatible dependency and peer ranges before npm overrides', () => {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const manifests = { core: { version: '0.0.0' }, content: { [field]: { '@threadplane/core': '^1.0.0' } } };
    assert.throws(() => packageVerifier.localDependencyProjects(['content'], (project) => manifests[project]), /does not satisfy/);
  }
});
test('installation footprint counts actual package files and bytes separately from optional lock entries', (t) => {
  assert.equal(typeof packageVerifier.installFootprint, 'function');
  const directory = mkdtempSync(join(tmpdir(), 'threadplane-footprint-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'node_modules/core'), { recursive: true });
  writeFileSync(join(directory, 'node_modules/core/package.json'), '{}');
  writeFileSync(join(directory, 'node_modules/core/index.js'), 'abc');
  assert.deepEqual(packageVerifier.installFootprint(directory, lockFor(['core', 'optional-platform'])), { installedPackages: 1, lockedPackages: 2, fileBytes: 5 });
});
