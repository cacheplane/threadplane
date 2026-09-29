import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { inputFingerprint } from './consumer.mjs';
import { frozenInputFingerprint } from './source-mirror.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'native-inputs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of [
    'libs/core/src/index.ts',
    'libs/telemetry/project.json',
    'fixtures/react-parity/traces/langgraph-text-state.sse',
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), path);
  }
  return root;
}

test('selected input hashes exclude private, generated and unrelated files', (t) => {
  const root = fixture(t);
  for (const path of [
    'libs/core/.env.local',
    'libs/core/src/private.key',
    'libs/core/dist/stale.js',
    'libs/core/.cache/stale',
    'libs/core/node_modules/stale.js',
    'libs/core/.install-collector/stale.mjs',
    'libs/unrelated/src/index.ts',
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), 'must never copy');
  }
  assert.deepEqual(Object.keys(inputFingerprint(root)).sort(), [
    'fixtures/react-parity/traces/langgraph-text-state.sse',
    'libs/core/src/index.ts',
    'libs/telemetry/project.json',
  ]);
});

for (const local of [
  'libs/telemetry/project.json',
  'fixtures/react-parity/traces/langgraph-text-state.sse',
])
  test(`auxiliary input is frozen: ${local}`, (t) => {
    const root = fixture(t);
    const before = frozenInputFingerprint(root);
    writeFileSync(
      join(root, local),
      readFileSync(join(root, local)) + 'changed'
    );
    assert.notDeepEqual(frozenInputFingerprint(root), before);
  });

for (const local of ['libs/core/src/index.ts', 'libs', 'fixtures/react-parity'])
  test(`selected input rejects source or ancestor symlinks: ${local}`, (t) => {
    const root = fixture(t);
    const target = join(root, 'external');
    renameSync(join(root, local), target);
    symlinkSync(target, join(root, local));
    assert.throws(() => inputFingerprint(root), /source links/i);
  });
