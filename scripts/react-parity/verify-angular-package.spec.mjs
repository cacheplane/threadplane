import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as angularVerifier from './verify-angular-package.mjs';

const versions = { '@angular/core': '21.1.6', '@angular/common': '21.1.6', '@angular/compiler': '21.1.6', '@angular/platform-browser': '21.1.6', '@angular/compiler-cli': '21.1.6', '@angular/cli': '21.1.5', '@angular/build': '21.1.5', typescript: '5.9.3', rxjs: '7.8.2', tslib: '2.8.1' };
const lock = () => ({ packages: Object.fromEntries(Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }])) });
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
