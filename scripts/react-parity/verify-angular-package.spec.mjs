import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as angularVerifier from './verify-angular-package.mjs';

test('Angular Markdown runtime exports exactly MarkdownComponent', () => {
  assert.equal(typeof angularVerifier.assertAngularMarkdownExports, 'function');
  assert.throws(() => angularVerifier.assertAngularMarkdownExports([]), /MarkdownComponent/);
  assert.doesNotThrow(() => angularVerifier.assertAngularMarkdownExports(['MarkdownComponent']));
  assert.throws(() => angularVerifier.assertAngularMarkdownExports(['MarkdownComponent', 'createMarkdown']), /unexpected/);
});

const versions = { '@angular/core': '21.1.6', '@angular/common': '21.1.6', '@angular/compiler': '21.1.6', '@angular/platform-browser': '21.1.6', '@angular/compiler-cli': '21.1.6', '@angular/cli': '21.1.5', '@angular/build': '21.1.5', typescript: '5.9.3', rxjs: '7.8.2', tslib: '2.8.1' };
const lock = () => ({ packages: Object.fromEntries(Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }])) });
test('Angular chat keeps the two presentation components beside the chat UI', () => {
  assert.throws(
    () => angularVerifier.assertAngularChatExports(['TextTranscriptComponent', 'ChatComponent']),
    /ToolObservationComponent/
  );
  assert.throws(
    () => angularVerifier.assertAngularChatExports(['TextTranscriptComponent', 'ToolObservationComponent']),
    /ChatComponent/
  );
  assert.doesNotThrow(() =>
    angularVerifier.assertAngularChatExports([
      'TextTranscriptComponent',
      'ToolObservationComponent',
      'ChatComponent',
      'mockAgent',
    ])
  );
});
test('an Angular app using only the plain-text views ships no A2UI', () => {
  assert.doesNotThrow(() => angularVerifier.assertA2uiFreeInputs({ 'node_modules/@threadplane/angular/fesm2022/threadplane-angular-chat.mjs': {} }));
  for (const path of ['node_modules/@threadplane/a2ui/index.js', 'node_modules/@json-render/core/dist/index.mjs'])
    assert.throws(() => angularVerifier.assertA2uiFreeInputs({ [path]: {} }), /A2UI/);
  assert.throws(() => angularVerifier.assertA2uiFreeInputs({}), /inputs/);
});
test('shipped inputs follow the entry through static and dynamic imports and skip dropped code', () => {
  const stats = { outputs: {
    'main.js': { entryPoint: 'src/main.ts', imports: [{ path: 'route.js', kind: 'dynamic-import' }], inputs: { 'src/main.ts': { bytesInOutput: 10 } } },
    'route.js': { imports: [{ path: 'shared.js', kind: 'import-statement' }], inputs: { 'node_modules/marked/lib/marked.esm.js': { bytesInOutput: 5 }, 'node_modules/@json-render/core/dist/index.mjs': { bytesInOutput: 0 } } },
    'shared.js': { imports: [], inputs: { 'node_modules/@angular/core/fesm2022/core.mjs': { bytesInOutput: 3 } } },
    // A chunk for a dynamic import in dropped code: an entry point nothing loads.
    'orphan.js': { entryPoint: 'node_modules/katex/dist/katex.mjs', imports: [], inputs: { 'node_modules/katex/dist/katex.mjs': { bytesInOutput: 99 } } },
  } };
  assert.deepEqual(Object.keys(angularVerifier.shippedInputs(stats)).sort(), [
    'node_modules/@angular/core/fesm2022/core.mjs',
    'node_modules/marked/lib/marked.esm.js',
    'src/main.ts',
  ]);
  assert.throws(() => angularVerifier.shippedInputs({ outputs: { 'orphan.js': stats.outputs['orphan.js'] } }), /main entry/);
});
test('Angular consumer pins runtime and tool versions from the root lock, not smoke lanes', () => {
  assert.equal(typeof angularVerifier.lockedAngularManifest, 'function');
  const result = angularVerifier.lockedAngularManifest({ private: true }, lock());
  assert.equal(result.dependencies['@angular/core'], '21.1.6');
  assert.equal(result.dependencies['@angular/compiler'], '21.1.6');
  assert.equal(result.devDependencies['@angular/compiler-cli'], '21.1.6');
  assert.equal(result.devDependencies['@angular/cli'], '21.1.5');
  assert.equal(result.devDependencies['@angular/build'], '21.1.5');
  assert.equal(result.devDependencies.typescript, '5.9.3');
});
test('Angular consumer refuses missing or mixed-major toolchain entries', () => {
  assert.equal(typeof angularVerifier.lockedAngularManifest, 'function');
  const missing = lock();
  delete missing.packages['node_modules/@angular/cli'];
  assert.throws(() => angularVerifier.lockedAngularManifest({}, missing), /lock/);
  const mixed = lock();
  mixed.packages['node_modules/@angular/build'].version = '22.0.0';
  assert.throws(() => angularVerifier.lockedAngularManifest({}, mixed), /major/);
});
test('Angular consumer uses installed CLI build with actual bundle stats, never raw Node APF execution', () => {
  assert.equal(typeof angularVerifier.angularBuildCommand, 'function');
  assert.deepEqual(angularVerifier.angularBuildCommand('/tmp/consumer'), ['/tmp/consumer/node_modules/@angular/cli/bin/ng.js', 'build', '--configuration=production', '--stats-json']);
});
test('Angular fixture uses strict declarations and an application builder', () => {
  const base = 'fixtures/react-parity/consumers/angular/';
  const config = JSON.parse(readFileSync(`${base}tsconfig.json`, 'utf8'));
  assert.equal(config.compilerOptions.skipLibCheck, false);
  assert.equal(config.angularCompilerOptions.strictTemplates, true);
  const workspace = JSON.parse(readFileSync(`${base}angular.json`, 'utf8'));
  assert.equal(workspace.projects.consumer.architect.build.builder, '@angular/build:application');
});
