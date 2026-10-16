import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertReadinessInputs,
  assertReadinessArtifacts,
  requestPolicy,
  assertOwnership,
  assertTransition,
  assertProcessAbsent,
  partitionViteInputs,
  installedFileRecords,
  assertLiteralCounts,
} from './verify-react-readiness.mjs';
const required = [
  'node_modules/@threadplane/content/src/render-state/create-render-state.js',
  'node_modules/@threadplane/content/src/render-state/owned-value.js',
  'node_modules/@threadplane/react/src/use-agent.js',
  'node_modules/@threadplane/react/src/render/render-spec.js',
  'node_modules/@threadplane/react/src/render/readiness.js',
  'node_modules/@json-render/core/dist/index.mjs',
  'node_modules/react/cjs/react.development.js',
  'node_modules/react-dom/cjs/react-dom-client.development.js',
];
const modules = () => required.map((path) => ({ path, renderedLength: 10 }));
test('requires executed installed owner, observer, renderer, readiness, SDK and development React bytes', () => {
  assertReadinessInputs(modules());
  for (const path of required) {
    assert.throws(
      () => assertReadinessInputs(modules().filter((m) => m.path !== path)),
      /required/i
    );
    assert.throws(
      () =>
        assertReadinessInputs(
          modules().map((m) =>
            m.path === path ? { ...m, renderedLength: 0 } : m
          )
        ),
      /required/i
    );
  }
});
for (const path of [
  'libs/react/src/render/readiness.tsx',
  'node_modules/@angular/core/fesm2022/core.mjs',
  'node_modules/@threadplane/angular/fesm2022/threadplane-angular.mjs',
  'node_modules/@threadplane/render/index.js',
  'node_modules/@langchain/langgraph-sdk/index.js',
  'node_modules/@ag-ui/client/index.js',
  'node_modules/openai/index.js',
  'node_modules/@cacheplane/partial-json/index.js',
  'node_modules/@cacheplane/json-stream/index.js',
  'node_modules/@threadplane/content/src/json/index.js',
  'node_modules/@threadplane/content/src/markdown/index.js',
])
  test('rejects forbidden executed input ' + path, () => {
    assert.throws(
      () => assertReadinessInputs([...modules(), { path, renderedLength: 1 }]),
      /runtime|alias/i
    );
  });
test('does not misreport tree-shaken parser dependencies as execution', () => {
  assertReadinessInputs([
    ...modules(),
    {
      path: 'node_modules/@cacheplane/partial-json/index.js',
      renderedLength: 0,
    },
  ]);
});
const artifacts = () =>
  Object.fromEntries(
    ['core', 'content', 'react'].map((p) => [
      '@threadplane/' + p,
      'file:/tmp/' + p + '.tgz',
    ])
  );
test('requires exact three actual distinct local artifacts and react-render profile', () => {
  assertReadinessArtifacts(artifacts(), 'react-render');
  for (const value of [
    { ...artifacts(), '@threadplane/angular': 'file:/tmp/angular.tgz' },
    { '@threadplane/core': 'file:/tmp/core.tgz' },
    { ...artifacts(), '@threadplane/react': 'file:/tmp/core.tgz' },
  ])
    assert.throws(() => assertReadinessArtifacts(value, 'react-render'));
  for (const profile of ['render-state', 'markdown', 'react-langgraph'])
    assert.throws(() => assertReadinessArtifacts(artifacts(), profile));
});
test('requests are canonical GET-only owned loopback allowlist with budget', () => {
  const origin = 'http://127.0.0.1:1234',
    asset = '/presentation-assets/main.js';
  for (const [url, method] of [
    [origin + '/api', 'GET'],
    [origin + '/presentation?x=1', 'GET'],
    [origin + '/presentation#x', 'GET'],
    [origin + '/presentation', 'POST'],
    [origin + '/presentation', 'HEAD'],
    ['https://example.com' + asset, 'GET'],
    ['http://localhost:1234' + asset, 'GET'],
    [origin + '/presentation-assets/unknown.js', 'GET'],
    [origin + '/presentation-assets/%6dain.js', 'GET'],
    ['invalid', 'GET'],
  ])
    assert.equal(requestPolicy(origin, [asset])(url, method), false);
  const allow = requestPolicy(origin, [asset], 2);
  assert.equal(allow(origin + '/presentation', 'GET'), true);
  assert.equal(allow(origin + asset, 'GET'), true);
  assert.equal(allow(origin + asset, 'GET'), false);
  for (const origin of [
    'http://localhost:1234',
    'https://127.0.0.1:1234',
    'http://127.0.0.1:1234/path',
    'http://127.0.0.1:1234/',
  ])
    assert.throws(() => requestPolicy(origin));
});
const sample = () => ({
  constructed: 1,
  set: 0,
  update: 0,
  dispose: 0,
  registrations: 2,
  cleanups: 1,
  outstanding: 1,
  notifications: 0,
  snapshotId: 1,
  observedId: 1,
  snapshot: {
    payload: null,
    label: 'initial',
    show: true,
    rows: [
      { id: 'a', value: 'A' },
      { id: 'b', value: 'B' },
    ],
  },
  predicateCalls: 2,
  step: 0,
  mounted: true,
});
test('actual owner identity and balanced independent subscription handles are mandatory', () => {
  assertOwnership(sample());
  for (const mutate of [
    (e) => (e.constructed = 2),
    (e) => (e.observedId = 99),
    (e) => (e.outstanding = 0),
    (e) => (e.cleanups = 0),
    (e) => (e.dispose = 1),
    (e) => (e.set = -1),
    (e) => (e.update = 0.5),
    (e) => (e.notifications = -1),
  ]) {
    const e = sample();
    mutate(e);
    assert.throws(() => assertOwnership(e));
  }
});
test('ready publication requires literal snapshot, exactly one caller batch and notification', () => {
  const before = sample(),
    after = {
      ...sample(),
      update: 1,
      notifications: 1,
      snapshotId: 2,
      observedId: 2,
      step: 1,
      snapshot: { ...sample().snapshot, payload: 'complete', label: 'ready' },
    };
  assertTransition(before, after, 'Ready');
  for (const mutate of [
    (e) => (e.update = 0),
    (e) => (e.set = 1),
    (e) => (e.notifications = 2),
    (e) => (e.snapshot.payload = 'wrong'),
    (e) => (e.snapshotId = 1),
    (e) => (e.constructed = 2),
    (e) => (e.dispose = 1),
  ]) {
    const e = structuredClone(after);
    mutate(e);
    assert.throws(() => assertTransition(before, e, 'Ready'));
  }
});
test('descriptor/lifecycle changes cannot issue owner commands or publish snapshots', () => {
  const before = sample(),
    after = { ...sample(), step: 1 };
  assertTransition(before, after, 'Descriptor only');
  for (const mutate of [
    (e) => e.set++,
    (e) => e.update++,
    (e) => e.dispose++,
    (e) => e.notifications++,
    (e) => e.snapshotId++,
    (e) => (e.snapshot.label = 'wrong'),
  ]) {
    const e = structuredClone(after);
    mutate(e);
    assert.throws(() => assertTransition(before, e, 'Descriptor only'));
  }
});
test('latched later-missing publication skips predicate and preserves literal current state', () => {
  const before = {
      ...sample(),
      snapshot: { ...sample().snapshot, payload: 'complete', label: 'ready' },
    },
    after = {
      ...sample(),
      step: 1,
      update: 1,
      notifications: 1,
      snapshotId: 2,
      observedId: 2,
      snapshot: { ...sample().snapshot, payload: null, label: 'later' },
    };
  assertTransition(before, after, 'Later missing');
  for (const mutate of [
    (e) => e.predicateCalls++,
    (e) => (e.snapshot.label = 'ready'),
    (e) => (e.snapshot.payload = 'complete'),
  ]) {
    const e = structuredClone(after);
    mutate(e);
    assert.throws(() => assertTransition(before, e, 'Later missing'));
  }
});
test('only ESRCH proves a process absent; EPERM is a failure', () => {
  assertProcessAbsent(42, () => {
    const e = new Error('gone');
    e.code = 'ESRCH';
    throw e;
  });
  assert.throws(() => assertProcessAbsent(42, () => {}));
  assert.throws(
    () =>
      assertProcessAbsent(42, () => {
        const e = new Error('denied');
        e.code = 'EPERM';
        throw e;
      }),
    /denied/
  );
});

test('Vite HTML and CommonJS generated inputs retain provenance without masquerading as files', () => {
  const records = [
    { path: '/tmp/consumer/react.tsx', renderedLength: 10 },
    {
      path: '/tmp/consumer/index.html?html-proxy&inline-css&index=0.css',
      renderedLength: 0,
    },
    { path: '\0commonjsHelpers.js', renderedLength: 1 },
  ];
  assert.deepEqual(partitionViteInputs(records), {
    physical: [records[0]],
    virtual: [records[1], records[2]],
  });
});

test('installed file freeze accounts safe npm binary links and rejects escaping links', () => {
  const directory = mkdtempSync(join(tmpdir(), 'readiness-installed-files-'));
  try {
    mkdirSync(join(directory, '.bin'));
    mkdirSync(join(directory, 'pkg'));
    writeFileSync(join(directory, 'pkg/cli.js'), 'actual bytes');
    symlinkSync('../pkg/cli.js', join(directory, '.bin/cli'));
    const records = installedFileRecords(directory);
    assert.equal(records.length, 2);
    assert.equal(records[0].path, '.bin/cli');
    assert.equal(records[0].link, '../pkg/cli.js');
    assert.equal(records[0].sha256, records[1].sha256);
    writeFileSync(join(directory, 'pkg/cli.js'), 'changed actual bytes');
    assert.notDeepEqual(installedFileRecords(directory), records);
    assert.notEqual(
      installedFileRecords(directory)[0].sha256,
      records[0].sha256
    );
    symlinkSync('../pkg', join(directory, '.bin/directory'));
    assert.throws(() => installedFileRecords(directory), /regular file/);
    rmSync(join(directory, '.bin/directory'));
    symlinkSync('cycle', join(directory, '.bin/cycle'));
    assert.throws(() => installedFileRecords(directory), /ELOOP/);
    rmSync(join(directory, '.bin/cycle'));
    symlinkSync('/etc/hosts', join(directory, '.bin/escape'));
    assert.throws(() => installedFileRecords(directory), /escape/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('browser step receipt requires independent literal command counts at each milestone', () => {
  const ready = { set: 0, update: 3, dispose: 0, notifications: 3 };
  assert.deepEqual(assertLiteralCounts(3, ready), ready);
  for (const key of Object.keys(ready)) {
    assert.throws(() =>
      assertLiteralCounts(3, { ...ready, [key]: ready[key] + 1 })
    );
  }
  const final = { set: 3, update: 7, dispose: 1, notifications: 10 };
  assert.deepEqual(assertLiteralCounts(21, final), final);
  assert.throws(() => assertLiteralCounts(21, { ...final, dispose: 0 }));
});
