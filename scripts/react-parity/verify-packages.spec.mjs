import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

test('JSON feature exposes only its owned factory', () => {
  assert.throws(() => packageVerifier.assertSupportedExports('content/json', {}), /createJson/);
  assert.doesNotThrow(() => packageVerifier.assertSupportedExports('content/json', { createJson() {} }));
  assert.throws(() => packageVerifier.assertSupportedExports('content/json', { createJson() {}, createJsonOwner() {} }), /unexpected/);
});
import * as packageVerifier from './verify-packages.mjs';
const { validatePackage } = packageVerifier;
test('consumer commands accept an explicit environment without inheriting a backend credential', () => {
  const previous = process.env.NATIVE_LANGGRAPH_API_KEY;
  process.env.NATIVE_LANGGRAPH_API_KEY = 'test-only-do-not-forward';
  try {
    const result = packageVerifier.runConsumer(process.execPath, ['-e', `
      if (process.env.NATIVE_LANGGRAPH_API_KEY !== undefined) process.exit(42);
      process.stdout.write(process.env.EXAMPLE_BUILD_MARKER);
    `], tmpdir(), { PATH: process.env.PATH, EXAMPLE_BUILD_MARKER: 'sanitized' });
    assert.equal(result, 'sanitized');
    assert.equal(packageVerifier.runConsumer(process.execPath, ['-e', 'process.stdout.write(process.env.NATIVE_LANGGRAPH_API_KEY ? "inherited" : "missing")'], tmpdir()), 'inherited');
  } finally {
    if (previous === undefined) delete process.env.NATIVE_LANGGRAPH_API_KEY;
    else process.env.NATIVE_LANGGRAPH_API_KEY = previous;
  }
});
const reactMarkdown = { types: './src/markdown/index.d.ts', import: './src/markdown/index.js', default: './src/markdown/index.js' };

test('React Markdown exposes exactly its implemented component', () => {
  assert.throws(() => packageVerifier.assertSupportedExports('react/markdown', {}), /Markdown/);
  assert.doesNotThrow(() => packageVerifier.assertSupportedExports('react/markdown', { Markdown() {} }));
  assert.throws(() => packageVerifier.assertSupportedExports('react/markdown', { Markdown() {}, createMarkdown() {} }), /unexpected/);
});
test('React Markdown cannot disappear from package validation or consumer enumeration', (t) => {
  const exports = { '.': { types: './src/index.d.ts', import: './src/index.js', default: './src/index.js' } };
  assert.ok(validatePackage(fixture(t, { manifest: { exports }, omitMarkdown: true })).some(error => error.includes('markdown')));
  assert.throws(() => packageVerifier.consumerSpecifiers({ name: '@threadplane/react', exports }), /markdown/);
});
for (const [name, files, diagnostic] of [
  ['lost client directive', { 'src/markdown/index.js': 'export function Markdown() {}' }, /markdown.*use client/],
  ['missing declarations', { 'src/markdown/index.d.ts': null }, /markdown.*missing export target/],
  ['missing runtime', { 'src/markdown/index.js': null }, /markdown.*missing export target/],
]) test(`React Markdown rejects ${name}`, (t) => {
  assert.ok(validatePackage(fixture(t, { files })).some(error => diagnostic.test(error)));
});
for (const path of [
  'node_modules/@threadplane/react/src/markdown/markdown.js',
  'node_modules/@threadplane/angular/fesm2022/threadplane-angular-markdown.mjs',
  'node_modules/@threadplane/content/src/markdown/index.js',
]) test(`headless roots reject Markdown input ${path} on both separator styles`, () => {
  for (const input of [path, path.replaceAll('/', '\\')]) {
    assert.throws(() => packageVerifier.assertHeadlessInputs({ [input]: {} }), /markdown/i);
  }
});
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  test(`framework ${field} closure requires compatible local content`, () => {
    const manifests = { react: { [field]: { '@threadplane/content': '0.0.0' } }, angular: { [field]: { '@threadplane/content': '0.0.0' } }, content: { version: '0.0.0' } };
    assert.deepEqual(packageVerifier.localDependencyProjects(['react', 'angular'], project => manifests[project]), ['react', 'content', 'angular']);
    manifests.content.version = '1.0.0';
    assert.throws(() => packageVerifier.localDependencyProjects(['react'], project => manifests[project]), /does not satisfy/);
    delete manifests.content;
    assert.throws(() => packageVerifier.localDependencyProjects(['angular'], project => manifests[project]), /Missing local artifact manifest for content/);
  });
}

test('installed native contracts reject the former empty scaffold exports', () => {
  assert.equal(typeof packageVerifier.assertSupportedExports, 'function');
  assert.throws(() => packageVerifier.assertSupportedExports('core', {}), /completeDelivery/);
  assert.throws(() => packageVerifier.assertSupportedExports('react', {}), /useAgent/);
  assert.doesNotThrow(() => packageVerifier.assertSupportedExports('react', { useAgent: () => undefined }));
});

function fixture(t, change = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'threadplane-package-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manifest = { name: '@threadplane/react', private: true, type: 'module', license: 'MIT', exports: { '.': { types: './src/index.d.ts', import: './src/index.js', default: './src/index.js' }, './markdown': reactMarkdown }, ...change.manifest };
  // Keep unrelated export mutations valid now that Markdown is mandatory.
  if (manifest.name === '@threadplane/react' && !change.omitMarkdown) manifest.exports = { './markdown': reactMarkdown, ...manifest.exports };
  const files = { 'package.json': JSON.stringify(manifest), 'README.md': 'Private scaffolding', 'LICENSE.md': 'MIT', 'src/index.js': "'use client';\nexport {};", 'src/index.d.ts': 'export {};', 'src/markdown/index.js': "'use client';\nexport function Markdown() {}", 'src/markdown/index.d.ts': 'export declare function Markdown(): void;', ...change.files };
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
const angularChat = { types: './types/threadplane-angular-chat.d.ts', default: './fesm2022/threadplane-angular-chat.mjs' };
const angularChatFiles = { ...angularFiles, 'types/threadplane-angular-chat.d.ts': 'export declare class TextTranscriptComponent {}', 'fesm2022/threadplane-angular-chat.mjs': 'export class TextTranscriptComponent {}' };
test('real Angular APF secondary entries use types/default conditions too', (t) => {
  const manifest = { ...angularManifest, exports: { ...angularManifest.exports, './chat': angularChat } };
  assert.deepEqual(validatePackage(fixture(t, { manifest, files: angularChatFiles })), []);
  assert.deepEqual(packageVerifier.consumerSpecifiers(manifest), ['@threadplane/angular', '@threadplane/angular/chat']);
});
test('APF secondary support does not admit backend SDK dependencies', (t) => {
  const manifest = { ...angularManifest, exports: { ...angularManifest.exports, './chat': angularChat }, dependencies: { '@ag-ui/client': '1.0.1' } };
  assert.ok(validatePackage(fixture(t, { manifest, files: angularChatFiles })).some(error => error.includes('forbidden dependencies entry @ag-ui/client')));
});
for (const [name, entry, files] of [
  ['missing types', { default: angularChat.default }, angularChatFiles],
  ['missing default', { types: angularChat.types }, angularChatFiles],
  ['missing declaration file', angularChat, { ...angularChatFiles, 'types/threadplane-angular-chat.d.ts': null }],
  ['missing runtime file', angularChat, { ...angularChatFiles, 'fesm2022/threadplane-angular-chat.mjs': null }],
  ['nondeclaration types', { ...angularChat, types: angularChat.default }, angularChatFiles],
]) test(`Angular secondary rejects ${name}`, (t) => {
  const manifest = { ...angularManifest, exports: { ...angularManifest.exports, './chat': entry } };
  assert.ok(validatePackage(fixture(t, { manifest, files })).length > 0);
});
test('React chat requires its real supported export', () => {
  const component = () => undefined;
  const supported = { ApprovalCard: component, Chat: component, ChatInput: component, Citations: component, MessageList: component, MessageActions: component, Reasoning: component, TextTranscript: component, ToolObservation: component };
  assert.throws(() => packageVerifier.assertSupportedExports('react/chat', {}), /ApprovalCard/);
  for (const name of Object.keys(supported)) {
    const { [name]: _omitted, ...rest } = supported;
    assert.throws(() => packageVerifier.assertSupportedExports('react/chat', rest), new RegExp(`missing supported contract ${name}$`));
  }
  assert.doesNotThrow(() => packageVerifier.assertSupportedExports('react/chat', supported));
  assert.throws(() => packageVerifier.assertSupportedExports('react/chat', { ...supported, execute: component }), /unexpected/);
  const forwarded = { $$typeof: Symbol.for('react.forward_ref'), render: component };
  assert.doesNotThrow(() => packageVerifier.assertSupportedExports('react/chat', { ...supported, ChatInput: forwarded }));
  assert.throws(() => packageVerifier.assertSupportedExports('react/chat', { ...supported, ChatInput: {} }), /ChatInput/);
  assert.throws(() => packageVerifier.assertSupportedExports('core', { completeDelivery: forwarded }), /completeDelivery/);
});
test('React render requires exactly the pure RenderSpec runtime export', () => {
  const RenderSpec = () => null;
  assert.throws(() => packageVerifier.assertSupportedExports('react/render', {}), /RenderSpec/);
  assert.doesNotThrow(() => packageVerifier.assertSupportedExports('react/render', { RenderSpec }));
  assert.throws(() => packageVerifier.assertSupportedExports('react/render', { RenderSpec, createStateStore: () => ({}) }), /unexpected/);
});
test('headless framework root rejects the render adapter and engine', () => {
  assert.throws(() => packageVerifier.assertHeadlessInputs({ 'node_modules/@threadplane/react/src/render/render-spec.js': {} }), /render/i);
  assert.throws(() => packageVerifier.assertHeadlessInputs({ 'node_modules/@json-render/core/dist/index.mjs': {} }), /render/i);
});
test('React chat still requires import and use client', (t) => {
  for (const entry of [
    { types: './src/index.d.ts', default: './src/index.js' },
    { types: './src/index.d.ts', import: './src/chat.js', default: './src/chat.js' },
  ]) {
    const directory = fixture(t, { manifest: { exports: { '.': { types: './src/index.d.ts', import: './src/index.js', default: './src/index.js' }, './chat': entry } }, files: { 'src/chat.js': 'export const TextTranscript = () => null;' } });
    assert.ok(validatePackage(directory).length > 0);
  }
});
test('headless framework root evidence excludes real chat components', () => {
  assert.throws(() => packageVerifier.assertHeadlessInputs({ 'node_modules/@threadplane/react/src/chat/text-transcript.js': {} }), /chat/);
  assert.throws(() => packageVerifier.assertHeadlessInputs({ 'node_modules/@threadplane/angular/fesm2022/threadplane-angular-chat.mjs': {} }), /chat/);
  assert.doesNotThrow(() => packageVerifier.assertParserFreeInputs({ 'node_modules/@threadplane/angular/fesm2022/threadplane-angular-chat.mjs': {} }));
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
const cssRoot = { '.': { types: './src/index.d.ts', import: './src/index.js', default: './src/index.js' } };
test('stylesheet exports are static assets outside consumer imports', (t) => {
  for (const entry of ['./src/chat/styles.css', { default: './src/chat/styles.css' }]) {
    const manifest = { name: '@threadplane/react', exports: { ...cssRoot, './chat/styles.css': entry } };
    assert.deepEqual(validatePackage(fixture(t, { manifest, files: { 'src/chat/styles.css': '.x{}' } })), []);
    assert.ok(!packageVerifier.consumerSpecifiers({ ...manifest, exports: { './markdown': reactMarkdown, ...manifest.exports } }).includes('@threadplane/react/chat/styles.css'));
  }
});
test('stylesheet subpaths cannot disguise a JavaScript runtime', (t) => {
  const manifest = { name: '@threadplane/react', exports: { ...cssRoot, './chat/styles.css': './src/index.js' } };
  assert.ok(validatePackage(fixture(t, { manifest })).length > 0);
  assert.ok(packageVerifier.consumerSpecifiers({ ...manifest, exports: { './markdown': reactMarkdown, ...manifest.exports } }).includes('@threadplane/react/chat/styles.css'));
});
test('stylesheet exports require their target file', (t) => {
  const manifest = { name: '@threadplane/react', exports: { ...cssRoot, './chat/styles.css': './src/chat/styles.css' } };
  assert.ok(validatePackage(fixture(t, { manifest })).some((error) => error.includes('missing export target ./src/chat/styles.css')));
});
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
  for (const name of ['marked', '@cacheplane/json-stream', '@cacheplane/partial-json', '@cacheplane/partial-markdown', 'remark-gfm', 'katex', 'shiki']) assert.throws(() => packageVerifier.assertParserFreeInputs({ [`node_modules/${name}/index.js`]: {} }), /parser/);
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
