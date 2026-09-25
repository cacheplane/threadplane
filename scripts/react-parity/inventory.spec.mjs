import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { DEFAULT_SCOPE, collectInventory, compareInventories, validateDispositions } from './inventory.mjs';
const scope = {
  libraries: ['sample'],
  entryPoints: ['libs/sample/src/public-api.ts', 'libs/sample/testing/public-api.ts'],
  docsRoot: 'apps/website/content/docs', topicsRoot: 'cockpit', configFiles: [],
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'react-parity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, content) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  execFileSync('git', ['init', '-q', root]);
  put('.gitignore', 'ignored.ts\n');
  put('libs/sample/src/public-api.ts', "export { Original as Alias } from './barrel'; export * from './view';");
  put('libs/sample/testing/public-api.ts', "export { Original } from '../src/definition';");
  put('libs/sample/src/barrel.ts', "export * from './definition';");
  put('libs/sample/src/definition.ts', 'export interface Original { value: string; }');
  put('libs/sample/src/view.ts', "import { Component as View, Directive } from '@angular/core'; @View({selector: 'demo'}) export class Demo { value = 1; } @Directive({selector: '[extra]'}) export class Extra {}");
  put('libs/sample/package.json', '{"name":"sample","exports":{"./theme.css":"./theme.css"}}');
  put('libs/sample/theme.css', ':root { color: red; }');
  put('libs/sample/src/example.spec.ts', 'const test = true;');
  put('libs/sample/src/ignored.ts', 'const ignore = true;');
  put('apps/website/content/docs/sample/overview.mdx', '# Sample');
  put('cockpit/sample/demo/angular/project.json', '{"name":"sample-demo"}');
  put('cockpit/sample/demo/angular/src/index.ts', "export const demo = { id: 'sample-demo-angular', manifestIdentity: {product: 'sample', topic: 'demo', language: 'angular'} };");
  return { root, put, collect: () => collectInventory(root, scope) };
}

function ownership(inventory) {
  return { schemaVersion: 1, rows: inventory.rows.map(({ id }) => ({ id, taskIds: ['T03'], treatment: 'shared', status: 'planned' })) };
}

test('inventory API exists', () => assert.equal(typeof collectInventory, 'function'));

test('native APF secondary and React feature entries are explicitly scoped and resolve actual declarations', t => {
  for (const library of ['angular', 'react']) assert.ok(DEFAULT_SCOPE.libraries.includes(library));
  const entries = ['libs/angular/chat/src/public-api.ts', 'libs/react/src/chat/index.ts'];
  for (const entry of entries) assert.ok(DEFAULT_SCOPE.entryPoints.includes(entry));
  const { root, put } = fixture(t);
  put(entries[0], "export { TextTranscriptComponent } from './text-transcript.component';");
  put('libs/angular/chat/src/text-transcript.component.ts', "import { Component } from '@angular/core'; @Component({selector:'threadplane-text-transcript'}) export class TextTranscriptComponent {}");
  put('libs/angular/chat/ng-package.json', '{"lib":{"entryFile":"src/public-api.ts"}}');
  put(entries[1], "'use client'; export { TextTranscript } from './text-transcript.js';");
  put('libs/react/src/chat/text-transcript.tsx', 'export function TextTranscript() { return <section />; }');
  const actual = collectInventory(root, { ...scope, libraries: ['angular', 'react'], entryPoints: entries });
  assert.ok(actual.rows.some(row => row.id === 'component:libs/angular/chat/src/text-transcript.component.ts#TextTranscriptComponent'));
  assert.ok(actual.rows.some(row => row.id === 'asset:libs/angular/chat/ng-package.json'));
  const angular = actual.rows.find(row => row.id === `export:${entries[0]}#TextTranscriptComponent`);
  const react = actual.rows.find(row => row.id === `export:${entries[1]}#TextTranscript`);
  assert.equal(angular.declarations[0].path, 'libs/angular/chat/src/text-transcript.component.ts');
  assert.equal(react.declarations[0].path, 'libs/react/src/chat/text-transcript.tsx');
  assert.equal(actual.rows.filter(row => row.kind === 'entry').length, 2);
});

test('AST inventory resolves renamed exports, barrels and secondary entries; scans aliased decorators', t => {
  const { collect } = fixture(t);
  const inventory = collect();
  const alias = inventory.rows.find(row => row.kind === 'export' && row.symbol === 'Alias');
  assert.equal(alias.declarations[0].path, 'libs/sample/src/definition.ts');
  assert.match(alias.declarations[0].signature, /value: string/);
  assert.equal(inventory.rows.filter(row => row.kind === 'export').length, 4);
  assert.deepEqual(inventory.rows.filter(row => row.kind === 'component').map(row => row.symbol).sort(), ['Demo', 'Extra']);
  assert.ok(inventory.rows.some(row => row.kind === 'topic' && row.topicId === 'sample-demo-angular'));
  assert.ok(!inventory.rows.some(row => /ignored|example.spec/.test(row.path)));
});

test('inventory is deterministic and independent of checkout location', t => {
  const a = fixture(t), b = fixture(t);
  assert.deepEqual(a.collect(), b.collect());
  assert.doesNotMatch(JSON.stringify(a.collect()), /react-parity-[/A-Za-z0-9]+/);
});

test('source names ending in -spec remain in scope; type-spec tests do not', t => {
  const { collect, put } = fixture(t);
  put('libs/sample/src/surface-to-spec.ts', 'export function toSpec() {}');
  put('libs/sample/src/contract.type-spec.ts', 'const typeTest = true;');
  const paths = collect().rows.filter(row => row.kind === 'source').map(row => row.path);
  assert.ok(paths.includes('libs/sample/src/surface-to-spec.ts'));
  assert.ok(!paths.includes('libs/sample/src/contract.type-spec.ts'));
});

test('external re-exports preserve the local import contract without installed dependency paths', t => {
  const { collect, put } = fixture(t);
  put('libs/sample/src/definition.ts', "import type { External as Original } from 'external-package'; export type { Original };");
  const row = collect().rows.find(row => row.kind === 'export' && row.symbol === 'Alias');
  assert.equal(row.declarations[0].path, 'libs/sample/src/definition.ts');
  assert.match(row.declarations[0].signature, /import type.*External as Original.*external-package/);
});

test('malformed source syntax fails closed instead of producing a partial inventory', t => {
  const { collect, put } = fixture(t);
  put('libs/sample/src/definition.ts', 'export interface Original { value: ; }');
  assert.throws(collect, /Syntax error.*definition.ts/);
});

test('package test configuration remains an asset even when its filename contains .spec', t => {
  const { collect, put } = fixture(t);
  put('libs/sample/tsconfig.spec.json', '{"extends":"./tsconfig.json"}');
  assert.ok(collect().rows.some(row => row.id === 'asset:libs/sample/tsconfig.spec.json'));
});

test('default configuration scope rejects a lockfile-only dependency change', t => {
  const { root, put } = fixture(t);
  const collect = () => collectInventory(root, { ...scope, configFiles: DEFAULT_SCOPE.configFiles });
  put('package-lock.json', '{"lockfileVersion":3,"packages":{"node_modules/sdk":{"version":"1.0.0"}}}');
  const baseline = collect();
  put('package-lock.json', '{"lockfileVersion":3,"packages":{"node_modules/sdk":{"version":"1.1.0"}}}');
  assert.ok(compareInventories(baseline, collect()).includes('Changed config:package-lock.json'));
});

for (const [name, path, text] of [
  ['missing export', 'libs/sample/src/public-api.ts', "export * from './view';"],
  ['added export', 'libs/sample/src/public-api.ts', "export { Original as Alias, Original as Added } from './definition'; export * from './view';"],
  ['renamed export', 'libs/sample/src/public-api.ts', "export { Original as Renamed } from './definition'; export * from './view';"],
  ['aliased definition signature', 'libs/sample/src/definition.ts', 'export interface Original { value: number; }'],
  ['untracked source', 'libs/sample/src/new.ts', 'export interface Added {}'],
  ['component', 'libs/sample/src/new-view.ts', "import {Component} from '@angular/core'; @Component({}) export class NewView {}"],
  ['docs page', 'apps/website/content/docs/sample/new.mdx', '# New'],
  ['package asset', 'libs/sample/new.css', ':root {}'],
  ['package configuration', 'libs/sample/package.json', '{"name":"renamed"}'],
  ['topic identity', 'cockpit/sample/demo/angular/src/index.ts', "export const demo = {id: 'renamed-angular'};"],
]) {
  test(`rejects drift in ${name}`, t => {
    const { collect, put } = fixture(t), baseline = collect();
    put(path, text);
    const errors = compareInventories(baseline, collect());
    assert.ok(errors.length > 0);
    if (name === 'aliased definition signature') assert.ok(errors.some(error => /export.*Alias/.test(error)));
  });
}

test('rejects missing components, docs, topics and assets', t => {
  const { collect, root } = fixture(t), baseline = collect();
  for (const path of ['libs/sample/src/view.ts', 'apps/website/content/docs/sample/overview.mdx', 'cockpit/sample/demo/angular', 'libs/sample/theme.css']) rmSync(join(root, path), { recursive: true });
  const errors = compareInventories(baseline, collect());
  for (const kind of ['component', 'doc', 'topic', 'asset']) assert.ok(errors.some(error => error.includes(`${kind}:`)), kind);
});

test('rejects duplicate baseline records and stale source references', t => {
  const actual = fixture(t).collect(), baseline = structuredClone(actual);
  baseline.rows.push(baseline.rows[0]);
  baseline.rows.find(row => row.kind === 'export').declarations[0].path = 'libs/sample/gone.ts';
  const errors = compareInventories(baseline, actual);
  assert.ok(errors.some(error => /Duplicate/.test(error)));
  assert.ok(errors.some(error => /Changed export/.test(error)));
});

test('ownership is complete planning evidence, not an implementation-completion claim', t => {
  const inventory = fixture(t).collect();
  assert.deepEqual(validateDispositions(inventory, ownership(inventory)), []);
});

for (const [name, mutate, expected] of [
  ['missing row', rows => rows.pop(), /Missing disposition/],
  ['duplicate row', rows => rows.push(rows[0]), /Duplicate disposition/],
  ['unknown task ID', rows => { rows[0].taskIds = ['T40']; }, /Unknown task/],
  ['non-string task ID', rows => { rows[0].taskIds = [['T03']]; }, /Unknown task/],
  ['stale reference', rows => { rows[0].id = 'source:missing.ts'; }, /Stale disposition/],
  ['Angular-only reason', rows => { rows[0].treatment = 'angular-only'; }, /reason/],
  ['internal reason', rows => { rows[0].treatment = 'internal'; }, /reason/],
]) {
  test(`rejects ${name}`, t => {
    const inventory = fixture(t).collect(), dispositions = ownership(inventory);
    mutate(dispositions.rows);
    assert.ok(validateDispositions(inventory, dispositions).some(error => expected.test(error)));
  });
}

test('CLI check fails on drift without changing either manifest', t => {
  const { root, collect, put } = fixture(t), baseline = collect();
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
  baseline.baselineHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  put('baseline.json', JSON.stringify(baseline));
  put('dispositions.json', JSON.stringify(ownership(baseline)));
  const before = ['baseline.json', 'dispositions.json'].map(path => readFileSync(join(root, path), 'utf8'));
  const check = () => spawnSync(process.execPath, ['scripts/react-parity/inventory.mjs', '--check', '--root', root, '--baseline', join(root, 'baseline.json'), '--dispositions', join(root, 'dispositions.json')], { encoding: 'utf8' });
  const unchanged = check();
  assert.equal(unchanged.status, 0, unchanged.stderr);
  put('libs/sample/src/new.ts', 'export const newFile = true;');
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Added source:libs\/sample\/src\/new.ts/);
  assert.deepEqual(['baseline.json', 'dispositions.json'].map(path => readFileSync(join(root, path), 'utf8')), before);
});

test('CLI help documents check, explicit fact regeneration, and scope without scanning', () => {
  const result = spawnSync(process.execPath, ['scripts/react-parity/inventory.mjs', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--check/);
  assert.match(result.stdout, /--write-baseline/);
  assert.match(result.stdout, /scope/);
});

test('explicit regeneration records the checked-out commit and preserves ownership', t => {
  const { root, collect, put } = fixture(t);
  execFileSync('git', ['add', '.'], { cwd: root });
  const commit = () => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
  commit();
  put('baseline.json', JSON.stringify(collect()));
  put('dispositions.json', JSON.stringify(ownership(collect())));
  const ownedBefore = readFileSync(join(root, 'dispositions.json'), 'utf8');
  const generate = () => {
    const result = spawnSync(process.execPath, ['scripts/react-parity/inventory.mjs', '--write-baseline', '--root', root, '--baseline', join(root, 'baseline.json')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(join(root, 'baseline.json'), 'utf8'));
  };
  const first = generate();
  assert.equal(first.baselineHead, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
  put('unrelated.txt', 'A second commit changes provenance, not selected facts.');
  execFileSync('git', ['add', 'unrelated.txt'], { cwd: root });
  commit();
  const second = generate();
  assert.notEqual(second.baselineHead, first.baselineHead);
  assert.equal(second.baselineHead, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
  assert.deepEqual(second.rows, first.rows);
  put('libs/sample/src/definition.ts', 'export interface Original { value: boolean; }');
  put('libs/sample/src/added.ts', 'export const added = true;');
  const dirty = generate();
  assert.deepEqual(dirty.sourceState.modified, ['libs/sample/src/definition.ts']);
  assert.deepEqual(dirty.sourceState.untracked, ['libs/sample/src/added.ts']);
  assert.equal(readFileSync(join(root, 'dispositions.json'), 'utf8'), ownedBefore);
});
