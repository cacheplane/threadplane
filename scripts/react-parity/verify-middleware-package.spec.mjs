import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as verifier from './verify-middleware-package.mjs';
const manifest = () => ({ name: '@threadplane/middleware', type: 'module', exports: { './langgraph': { types: './index.d.ts', default: './index.js' } }, peerDependencies: { '@langchain/core': '^1.0.0', '@langchain/langgraph': '^1.0.0' } });
const lock = { packages: Object.fromEntries(Object.entries({ '@langchain/core': '1.2.9', '@langchain/langgraph': '1.4.13', typescript: '5.9.3', '@types/node': '25.6.0' }).map(([name, version]) => [`node_modules/${name}`, { version }])) };

test('pins declared peers and the compiler from the root lock and rejects unsupported peer ranges', () => {
  assert.equal(typeof verifier.lockedMiddlewareManifest, 'function');
  const result = verifier.lockedMiddlewareManifest(manifest(), lock);
  assert.deepEqual(result.dependencies, { '@langchain/core': '1.2.9', '@langchain/langgraph': '1.4.13' });
  assert.deepEqual(result.devDependencies, { typescript: '5.9.3', '@types/node': '25.6.0' });
  const incompatible = manifest();
  incompatible.peerDependencies['@langchain/core'] = '^2.0.0';
  assert.throws(() => verifier.lockedMiddlewareManifest(incompatible, lock), /does not satisfy/);
  assert.throws(() => verifier.lockedMiddlewareManifest(manifest(), { packages: {} }), /Missing root lock version/);
});

test('audits real emitted files for missing exports, private or undeclared imports, and source leaks', () => {
  assert.equal(typeof verifier.auditMiddlewarePackage, 'function');
  const directory = mkdtempSync(join(tmpdir(), 'middleware-audit-test-'));
  const write = (name, text) => writeFileSync(join(directory, name), text);
  try {
    write('package.json', JSON.stringify(manifest()));
    write('index.js', 'export const supported = true;');
    write('index.d.ts', 'export declare const supported: boolean;');
    assert.deepEqual(verifier.auditMiddlewarePackage(directory), []);
    rmSync(join(directory, 'index.js'));
    assert.match(verifier.auditMiddlewarePackage(directory).join('\n'), /missing export target.*index.js/);
    write('index.js', "export { secret } from '@threadplane/core';");
    assert.match(verifier.auditMiddlewarePackage(directory).join('\n'), /private dependency.*@threadplane\/core/);
    write('index.js', "import 'undeclared-runtime';");
    assert.match(verifier.auditMiddlewarePackage(directory).join('\n'), /undeclared dependency.*undeclared-runtime/);
    write('index.js', 'export {};');
    write('index.d.ts', "export type { Hidden } from '@threadplane/core/tools';");
    assert.match(verifier.auditMiddlewarePackage(directory).join('\n'), /private dependency/);
    write('index.d.ts', 'export {};');
    mkdirSync(join(directory, 'src'));
    write('src/private.ts', 'export const privateSource = true;');
    assert.match(verifier.auditMiddlewarePackage(directory).join('\n'), /source artifact.*private.ts/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('consumer command errors fail the gate rather than reporting success', () => {
  assert.equal(typeof verifier.runMiddlewareConsumer, 'function');
  const directory = mkdtempSync(join(tmpdir(), 'middleware-command-test-'));
  try {
    assert.throws(() => verifier.runMiddlewareConsumer(process.execPath, ['-e', 'process.exit(7)'], directory), /failed.*7/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('compiler file resolution rejects an external dependency reached through a symlink', () => {
  assert.equal(typeof verifier.assertConsumerFiles, 'function');
  const directory = mkdtempSync(join(tmpdir(), 'middleware-resolution-test-'));
  try {
    const consumer = join(directory, 'consumer');
    mkdirSync(consumer);
    const local = join(consumer, 'contracts.ts');
    const external = join(directory, 'external.d.ts');
    writeFileSync(local, 'export {};');
    writeFileSync(external, 'export {};');
    verifier.assertConsumerFiles(consumer, [local]);
    const linked = join(consumer, 'linked.d.ts');
    symlinkSync(external, linked);
    assert.throws(() => verifier.assertConsumerFiles(consumer, [local, linked]), /outside isolated consumer/);
    assert.throws(() => verifier.assertConsumerFiles(consumer, []), /No compiler files/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a dependency alias cannot disguise a private package in the packed manifest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'middleware-alias-test-'));
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ ...manifest(), dependencies: { hidden: 'npm:@threadplane/core@0.0.0' } }));
    writeFileSync(join(directory, 'index.js'), 'export {};');
    writeFileSync(join(directory, 'index.d.ts'), 'export {};');
    assert.match(verifier.auditMiddlewarePackage(directory).join('\n'), /dependency alias.*hidden/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
