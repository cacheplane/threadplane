import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { validatePackage } from './verify-packages.mjs';

function fixture(t, change = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'threadplane-package-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manifest = { name: '@threadplane/react-render', private: true, type: 'module', license: 'MIT', exports: { '.': { types: './src/index.d.ts', import: './src/index.js', default: './src/index.js' }, './types': { types: './src/types/index.d.ts', import: './src/types/index.js', default: './src/types/index.js' } }, ...change.manifest };
  const files = { 'package.json': JSON.stringify(manifest), 'README.md': 'Private scaffolding', 'LICENSE.md': 'MIT', 'src/index.js': "'use client';\nexport {};", 'src/index.d.ts': 'export {};', 'src/types/index.js': 'export {};', 'src/types/index.d.ts': 'export {};', ...change.files };
  for (const [path, text] of Object.entries(files)) if (text !== null) { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), text); }
  return directory;
}
test('accepts private ESM exports with declarations and client directive', (t) => assert.deepEqual(validatePackage(fixture(t)), []));
for (const [label, change] of [
  ['public manifest', { manifest: { private: false } }],
  ['missing declaration target', { files: { 'src/index.d.ts': null } }],
  ['missing license', { files: { 'LICENSE.md': null } }],
  ['missing readme', { files: { 'README.md': null } }],
  ['lost client directive', { files: { 'src/index.js': 'export {};' } }],
  ['impure types entry', { files: { 'src/types/index.js': "'use client'; export {};" } }],
  ['production test artifact', { files: { 'src/leak.spec.js': 'export {};' } }],
  ['escaping export', { manifest: { exports: { '.': { import: '../outside.js', types: './src/index.d.ts' } } } }],
  ['missing import condition', { manifest: { exports: { '.': { types: './src/index.d.ts' } } } }],
]) test(`rejects ${label}`, (t) => assert.ok(validatePackage(fixture(t, change)).length > 0));
