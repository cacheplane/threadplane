import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const load = () => import('./verify-a2ui-surfaces.mjs');
test('feature proof requires actual installed owner, native bindings and erased protocol runtime', async () => {
  const { assertFeatureInputs } = await load();
  const inputs = [
    'node_modules/@threadplane/content/src/a2ui/create-surfaces.js',
    'node_modules/@threadplane/react/src/use-agent.js',
    'node_modules/@threadplane/angular/fesm2022/threadplane-angular.mjs',
  ];
  assertFeatureInputs(inputs);
  for (const missing of inputs)
    assert.throws(() =>
      assertFeatureInputs(inputs.filter((p) => p !== missing))
    );
  for (const bad of [
    'node_modules/@threadplane/a2ui/index.js',
    'node_modules/@threadplane/content/src/markdown/index.js',
    'libs/content/src/a2ui/index.ts',
  ])
    assert.throws(() => assertFeatureInputs([...inputs, bad]));
});
test('request policy permits bounded same-origin GET assets only', async () => {
  const { requestPolicy } = await load();
  const policy = requestPolicy('http://127.0.0.1:1234', 2);
  assert.equal(policy('http://127.0.0.1:1234/presentation', 'GET'), true);
  assert.equal(policy('https://example.com/', 'GET'), false);
  assert.equal(policy('http://127.0.0.1:1234/app.js', 'GET'), false);
  assert.equal(
    requestPolicy('http://127.0.0.1:1234')('http://127.0.0.1:1234/', 'POST'),
    false
  );
  assert.throws(() => requestPolicy('https://example.com'));
});
test('owner accounting rejects borrowed identity and lost cleanup handles', async () => {
  const { assertOwnerAccounting } = await load();
  const count = {
    registrations: 2,
    cleanups: 1,
    outstanding: 1,
    notifications: 0,
  };
  const evidence = {
    selected: 1,
    owners: [
      {
        id: 0,
        apply: 4,
        dispose: 0,
        react: { ...count, cleanups: 2, outstanding: 0 },
        angular: { ...count, cleanups: 2, outstanding: 0 },
      },
      { id: 1, apply: 0, dispose: 0, react: count, angular: count },
    ],
  };
  assertOwnerAccounting(evidence);
  assert.throws(() => assertOwnerAccounting({ ...evidence, selected: 2 }));
  assert.throws(() =>
    assertOwnerAccounting({
      ...evidence,
      owners: evidence.owners.map((o) => ({
        ...o,
        react: { ...count, outstanding: 0 },
      })),
    })
  );
});
test('owner accounting rejects negative commands and repeated disposal', async () => {
  const { assertOwnerAccounting } = await load();
  const count = {
    registrations: 0,
    cleanups: 0,
    outstanding: 0,
    notifications: 0,
  };
  for (const fields of [
    { apply: -1, dispose: 0 },
    { apply: 0, dispose: 2 },
    { apply: 0.5, dispose: 0 },
  ]) {
    assert.throws(() =>
      assertOwnerAccounting({
        selected: 0,
        owners: [{ id: 0, ...fields, react: count, angular: count }],
      })
    );
  }
});
test('request policy rejects non-HTTP loopback origins', async () => {
  const { requestPolicy } = await load();
  assert.throws(() => requestPolicy('ftp://127.0.0.1'));
});
test('every publishing control requires the corresponding visible model and delete requires emptiness', async () => {
  const { assertSurfaceTransition } = await load();
  const owner = { apply: 2, dispose: 0 };
  const empty = { selected: 0, snapshot: { surfaces: [] }, owners: [owner] };
  for (const [action, value] of Object.entries({
    'Commit root': 'staged',
    Update: 'updated',
    Recreate: 'recreated',
    'Commit new': 'second',
    'Commit third': 'third',
    'Update absent React': 'absent-react',
    'Update absent Angular': 'absent-angular',
  })) {
    const next = {
      ...empty,
      snapshot: { surfaces: [{ dataModel: { value } }] },
    };
    assert.equal(assertSurfaceTransition(empty, next, action), true);
    assert.throws(() => assertSurfaceTransition(empty, empty, action));
    assert.throws(() =>
      assertSurfaceTransition(
        empty,
        {
          ...next,
          snapshot: { surfaces: [{ dataModel: { value: 'wrong' } }] },
        },
        action
      )
    );
  }
  assert.equal(assertSurfaceTransition(empty, empty, 'Stage'), false);
  assert.throws(() =>
    assertSurfaceTransition(
      empty,
      { ...empty, snapshot: { surfaces: [{}] } },
      'Stage'
    )
  );
  assert.equal(assertSurfaceTransition(empty, empty, 'Delete'), true);
  assert.throws(() =>
    assertSurfaceTransition(
      empty,
      { ...empty, snapshot: { surfaces: [{}] } },
      'Delete'
    )
  );
});
test('switch rejects owner reuse and old-owner commands reject notification leakage or disposal', async () => {
  const { assertSurfaceTransition } = await load();
  const first = {
    id: 0,
    apply: 4,
    dispose: 0,
    snapshot: { surfaces: [{ dataModel: { value: 'old-alive' } }] },
  };
  const second = {
    id: 1,
    apply: 0,
    dispose: 0,
    react: { notifications: 0 },
    angular: { notifications: 0 },
  };
  const before = { selected: 0, snapshot: first.snapshot, owners: [first] };
  const after = {
    selected: 1,
    snapshot: { surfaces: [] },
    owners: [first, second],
  };
  assert.equal(assertSurfaceTransition(before, after, 'Switch owner'), false);
  assert.throws(() => assertSurfaceTransition(before, before, 'Switch owner'));
  assert.throws(() =>
    assertSurfaceTransition(
      before,
      { ...after, owners: [{ ...first, dispose: 1 }, second] },
      'Switch owner'
    )
  );
  assert.equal(assertSurfaceTransition(after, after, 'Apply old'), false);
  assert.throws(() =>
    assertSurfaceTransition(
      after,
      { ...after, owners: [first, { ...second, react: { notifications: 1 } }] },
      'Apply old'
    )
  );
});
test('reused exact artifact verification detects modified installed declarations and runtime bytes', async (t) => {
  const { assertArtifactFiles } = await import('./verify-markdown.mjs');
  const { fileHashes } = await import('./langgraph-candidate-package.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'a2ui-byte-check-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'src'));
  const originals = {
    'src/index.d.ts': 'export declare const protocol: string;',
    'src/index.js': 'export const protocol = "v0.9";',
  };
  for (const [path, bytes] of Object.entries(originals))
    writeFileSync(join(directory, path), bytes);
  const expected = fileHashes(directory);
  assertArtifactFiles(directory, expected);
  for (const path of ['src/index.d.ts', 'src/index.js']) {
    writeFileSync(join(directory, path), 'changed');
    assert.throws(
      () => assertArtifactFiles(directory, expected),
      /actual unpacked tarball/
    );
    writeFileSync(join(directory, path), originals[path]);
  }
});
test('owner accounting rejects invalid subscription counter arithmetic', async () => {
  const { assertOwnerAccounting } = await load();
  const count = {
    registrations: 0,
    cleanups: 0,
    outstanding: 0,
    notifications: 0,
  };
  for (const fields of [
    { notifications: -1 },
    { registrations: 0.5, cleanups: 0.5 },
    { registrations: -1, cleanups: -1 },
  ]) {
    assert.throws(() =>
      assertOwnerAccounting({
        selected: 0,
        owners: [
          {
            id: 0,
            apply: 0,
            dispose: 0,
            react: { ...count, ...fields },
            angular: count,
          },
        ],
      })
    );
  }
});
for (const failure of ['none', 'launch', 'check', 'close'])
  test('shared owned browser/server cleanup after ' + failure, async () => {
    const { verifyMarkdownBrowser } = await import('./verify-markdown.mjs');
    let origin,
      closed = false,
      checked = false;
    const task = verifyMarkdownBrowser('', {
      launch: async (url) => {
        origin = url;
        assert.equal(
          (await fetch(url)).status,
          200,
          'Real owned socket is live'
        );
        if (failure === 'launch') throw new Error('launch failure');
        return {
          close: async () => {
            await Promise.resolve();
            closed = true;
            if (failure === 'close') throw new Error('close failure');
          },
        };
      },
      check: async () => {
        checked = true;
        if (failure === 'check') throw new Error('check failure');
        return 'checked';
      },
    });
    if (failure === 'none') assert.equal(await task, 'checked');
    else await assert.rejects(task, new RegExp(failure + ' failure'));
    assert.equal(closed, failure !== 'launch');
    assert.equal(checked, failure !== 'launch');
    await assert.rejects(
      fetch(origin),
      /fetch failed/,
      'Owned socket released after awaited cleanup'
    );
  });
