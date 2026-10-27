import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseProofArguments,
  runInstalledApplicationProof,
} from './ag-ui-a2ui-native-probe.mjs';
const args = [
  '--retain',
  '/private/tmp/proof-retain',
  '--python',
  '/private/tmp/proof-python/bin/python',
  '--environment',
  '/private/tmp/proof-python',
  '--home',
  '/private/tmp/proof-home',
  '--tmpdir',
  '/private/tmp/proof-tmp',
];
test('installed proof pins match the canonical graph and release lockfile', () => {
  const source = readFileSync(
    new URL('./ag-ui-a2ui-native-probe.mjs', import.meta.url),
    'utf8'
  );
  for (const [binding, path] of [
    ['graphHash', '../../cockpit/ag-ui/a2ui/python/src/graph.py'],
    ['lockHash', '../../package-lock.json'],
  ]) {
    const literals = [...source.matchAll(
      new RegExp(`\\b${binding}\\s*=\\s*'([a-f0-9]{64})'`, 'g')
    )];
    assert.equal(literals.length, 1, `One fixed ${binding} literal required`);
    const actual = createHash('sha256')
      .update(readFileSync(new URL(path, import.meta.url)))
      .digest('hex');
    assert.equal(literals[0][1], actual, `${binding} must match its reviewed input`);
  }
});
test('proof preparation rejects extra options and relative paths before any installation', async () => {
  const valid = parseProofArguments(args);
  await assert.rejects(
    runInstalledApplicationProof({ ...valid, extra: true }),
    /Unknown installed application proof options/
  );
  await assert.rejects(
    runInstalledApplicationProof({ ...valid, python: 'relative-python' }),
    /Five absolute proof flags required/
  );
});
test('the offline installed proof accepts exactly five authored absolute flags', () => {
  assert.deepEqual(parseProofArguments(args), {
    retain: args[1],
    python: args[3],
    environment: args[5],
    home: args[7],
    tmpdir: args[9],
  });
  assert.ok(Object.isFrozen(parseProofArguments(args)));
});
test('caller arguments cannot redirect source root or omit/duplicate proof paths', () => {
  for (const invalid of [
    [],
    args.slice(0, 8),
    [...args, '--root', '/private/tmp/foreign'],
    [...args, '--home', '/private/tmp/second'],
    [...args.slice(0, 1), 'relative', ...args.slice(2)],
    [...args.slice(0, -1), ''],
  ])
    assert.throws(
      () => parseProofArguments(invalid),
      /Five absolute proof flags required/
    );
});
test('importing the probe is inert and exposes only explicit proof work', () => {
  assert.equal(typeof runInstalledApplicationProof, 'function');
  const source = new URL('./ag-ui-a2ui-native-probe.mjs', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(source)})`,
    ],
    {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 65536,
    }
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0);
  assert.equal(child.signal, null);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
});
