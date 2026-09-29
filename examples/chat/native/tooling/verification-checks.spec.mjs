import assert from 'node:assert/strict';
import { test } from 'node:test';
const module = await import('./verification-checks.mjs').catch(() => ({}));
function fixture(framework = 'angular') {
  const appPath =
    framework === 'angular'
      ? 'angular/src/app.component.ts'
      : 'react/src/app.tsx';
  const source =
    'examples/chat/native/tooling/view-entry.' +
    (framework === 'angular' ? 'angular.ts' : 'tsx');
  const helper = 'examples/chat/native/tooling/view-owner.ts';
  const common = {
    'shared/application.ts': 'owner',
    [appPath]: 'app',
    'node_modules/@threadplane/core/package.json': 'package',
  };
  const toolPaths = [
    'node_modules/typescript/bin/tsc',
    ...(framework === 'angular'
      ? [
          'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js',
          'node_modules/@angular/cli/bin/ng.js',
        ]
      : ['node_modules/vite/bin/vite.js']),
  ];
  const tools = Object.fromEntries(
    toolPaths.map((path) => [path, 'tool bytes: ' + path])
  );
  const app = {
    framework,
    tools,
    provenance: {
      framework,
      inputs: { [source]: 'entry', [helper]: 'helper' },
      compiler: { inputs: common },
      bundler: { inputs: common },
      copied: {},
      installation: { artifacts: {} },
    },
  };
  const view = {
    framework,
    inputs: { ...common, ...tools },
    source: { path: source, sha256: 'entry' },
    helper: { path: helper, sha256: 'helper' },
  };
  const names = [
    'deep link, reload, Back and Forward',
    'bare and query-only browser navigation',
    'history failure and Retry admission',
    'A-B-A lookup race',
    'A-B-A history race',
    'A-B-A stream race',
    'list refresh during selection and creation ambiguity',
    'duplicate submit guard, Stop and canonical correction',
    'canonical approval, repeated pause, preserved draft and uncertain Stop',
    'supplied trip summaries, terminal persistence and observational reload',
    'trip summary persistence failure remains an error without automatic retry',
  ];
  const results = {
    framework,
    installed: {
      target: 'native-conversation-' + framework + ':test',
      passed: true,
    },
    browser: {
      framework,
      production: names.map((name, index) => ({
        name,
        passed: true,
        requests: Array.from(
          { length: index === 9 ? 9 : index >= 8 ? 8 : 1 },
          () => ({})
        ),
        ...(index === 9
          ? {
              evidence: {
                exactRequestCount: 9,
                exactTerminalPersistence: true,
                terminalNoAutoContinue: true,
                nextExplicitSubmit: true,
                cardsRetainedAfterNextTurn: true,
                pendingStatus: true,
                restorationNoReexecute: true,
                literalSummary: true,
                duplicateLabels: true,
                emptyLists: true,
                mobileOverflow: false,
              },
            }
          : index === 10
          ? {
              evidence: {
                exactRequestCount: 8,
                errorStatus: true,
                oneWriteAttempt: true,
                noAutomaticRetry: true,
                restorationNoReexecute: true,
              },
            }
          : {}),
        ...(index === 8
          ? {
              evidence: {
                exactRequestCount: 8,
                literalReason: true,
                keyboardDecisions: true,
                draftPreserved: true,
                repeatPauseAfterSettlement: true,
                physicalCloseBeforeCleanup: true,
                uncertainPauseNotActionable: true,
                mobileOverflow: false,
              },
            }
          : {}),
      })),
      view: {
        name:
          framework === 'angular'
            ? 'actual Angular component destruction/remount and explicit owner disposal'
            : 'actual React unmount/remount and explicit owner disposal',
        passed: true,
        requests: Array.from({ length: 6 }, () => ({})),
        evidence: {
          physicalCloseBeforeCleanup: true,
          exactRequestCount: 6,
          terminalWriteCount: 1,
          tripSummaryIdentity: true,
          [framework === 'angular'
            ? 'actualAngularComponentDestroy'
            : 'actualCreateRootUnmount']: true,
          before: { active: 1, tripSummaryCount: 2 },
          absent: { active: 0, tripSummaryCount: 2 },
          remounted: { active: 1, tripSummaryCount: 2 },
          disposed: { sessionActive: 0, ownerDisposals: 1 },
        },
      },
    },
  };
  return { app, view, results };
}
for (const framework of ['react', 'angular'])
  test(framework + ' matching app/view and selected successful results', () => {
    const f = fixture(framework);
    assert.equal(
      module.assertVerification(f.app, f.view, f.results),
      framework
    );
  });
for (const key of [
  'literalReason',
  'keyboardDecisions',
  'draftPreserved',
  'repeatPauseAfterSettlement',
  'physicalCloseBeforeCleanup',
  'uncertainPauseNotActionable',
  'mobileOverflow',
  'exactRequestCount',
]) {
  for (const mutation of ['missing', 'wrong'])
    test(`approval evidence rejects ${mutation} ${key}`, () => {
      const f = fixture();
      const evidence = f.results.browser.production[8].evidence;
      if (mutation === 'missing') delete evidence[key];
      else
        evidence[key] =
          key === 'exactRequestCount' ? 7 : key === 'mobileOverflow';
      assert.throws(() => module.assertVerification(f.app, f.view, f.results));
    });
}
for (const count of [7, 9])
  test(`approval evidence rejects ${count} physical requests`, () => {
    const f = fixture();
    f.results.browser.production[8].requests = Array.from(
      { length: count },
      () => ({})
    );
    assert.throws(() => module.assertVerification(f.app, f.view, f.results));
  });
for (const [index, expected] of [
  [
    9,
    {
      exactRequestCount: 9,
      exactTerminalPersistence: true,
      terminalNoAutoContinue: true,
      nextExplicitSubmit: true,
      cardsRetainedAfterNextTurn: true,
      pendingStatus: true,
      restorationNoReexecute: true,
      literalSummary: true,
      duplicateLabels: true,
      emptyLists: true,
      mobileOverflow: false,
    },
  ],
  [
    10,
    {
      exactRequestCount: 8,
      errorStatus: true,
      oneWriteAttempt: true,
      noAutomaticRetry: true,
      restorationNoReexecute: true,
    },
  ],
]) {
  for (const [key, value] of Object.entries(expected))
    for (const mutation of ['missing', 'wrong'])
      test(`summary case ${index} rejects ${mutation} ${key}`, () => {
        const f = fixture();
        assert.equal(
          module.assertVerification(f.app, f.view, f.results),
          'angular'
        );
        const evidence = f.results.browser.production[index].evidence;
        if (mutation === 'missing') delete evidence[key];
        else evidence[key] = typeof value === 'number' ? value - 1 : !value;
        assert.throws(() =>
          module.assertVerification(f.app, f.view, f.results)
        );
      });
  for (const count of [
    expected.exactRequestCount - 1,
    expected.exactRequestCount + 1,
  ])
    test(`summary case ${index} rejects ${count} physical requests`, () => {
      const f = fixture();
      assert.equal(
        module.assertVerification(f.app, f.view, f.results),
        'angular'
      );
      f.results.browser.production[index].requests = Array.from(
        { length: count },
        () => ({})
      );
      assert.throws(() => module.assertVerification(f.app, f.view, f.results));
    });
}
for (const [key, value] of Object.entries({
  exactRequestCount: 6,
  terminalWriteCount: 1,
  tripSummaryIdentity: true,
}))
  for (const mutation of ['missing', 'wrong'])
    test(`view rejects ${mutation} ${key}`, () => {
      const f = fixture();
      assert.equal(
        module.assertVerification(f.app, f.view, f.results),
        'angular'
      );
      const evidence = f.results.browser.view.evidence;
      if (mutation === 'missing') delete evidence[key];
      else evidence[key] = typeof value === 'number' ? value - 1 : false;
      assert.throws(() => module.assertVerification(f.app, f.view, f.results));
    });
for (const phase of ['before', 'absent', 'remounted'])
  for (const count of [undefined, 0, 1, 3])
    test(`view rejects ${phase} summary count ${count}`, () => {
      const f = fixture();
      assert.equal(
        module.assertVerification(f.app, f.view, f.results),
        'angular'
      );
      f.results.browser.view.evidence[phase].tripSummaryCount = count;
      assert.throws(() => module.assertVerification(f.app, f.view, f.results));
    });
for (const count of [5, 7])
  test(`view rejects ${count} physical requests`, () => {
    const f = fixture();
    assert.equal(
      module.assertVerification(f.app, f.view, f.results),
      'angular'
    );
    f.results.browser.view.requests = Array.from({ length: count }, () => ({}));
    assert.throws(() => module.assertVerification(f.app, f.view, f.results));
  });
for (const framework of ['react', 'angular'])
  for (const path of Object.keys(fixture(framework).app.tools))
    test(`${framework} rejects different installed tool ${path}`, () => {
      const f = fixture(framework);
      f.view.inputs[path] = 'different tool bytes';
      assert.throws(
        () => module.assertVerification(f.app, f.view, f.results),
        /App\/view input mismatch/
      );
    });
for (const [name, change] of [
  ['opposite view framework', (f) => (f.view.framework = 'react')],
  [
    'swapped shared owner',
    (f) =>
      (f.view.inputs = { ...f.view.inputs, 'shared/application.ts': 'other' }),
  ],
  [
    'swapped app',
    (f) =>
      (f.view.inputs = {
        ...f.view.inputs,
        'angular/src/app.component.ts': 'other',
      }),
  ],
  [
    'swapped installed package',
    (f) =>
      (f.view.inputs = {
        ...f.view.inputs,
        'node_modules/@threadplane/core/package.json': 'other',
      }),
  ],
  [
    'missing common owner',
    (f) => {
      f.view.inputs = { ...f.view.inputs };
      delete f.view.inputs['shared/application.ts'];
    },
  ],
  ['swapped proof source', (f) => (f.view.source.sha256 = 'other')],
  ['swapped helper source', (f) => (f.view.helper.sha256 = 'other')],
  ['failed installed tests', (f) => (f.results.installed.passed = false)],
  [
    'wrong installed target',
    (f) => (f.results.installed.target = 'native-conversation-react:test'),
  ],
  ['wrong browser framework', (f) => (f.results.browser.framework = 'react')],
  ['missing approval case', (f) => f.results.browser.production.splice(8, 1)],
  [
    'missing summary success case',
    (f) => f.results.browser.production.splice(9, 1),
  ],
  ['missing summary failure case', (f) => f.results.browser.production.pop()],
  [
    'swapped summary cases',
    (f) =>
      f.results.browser.production.splice(
        9,
        2,
        f.results.browser.production[10],
        f.results.browser.production[9]
      ),
  ],
  [
    'failed approval case',
    (f) => (f.results.browser.production[8].passed = false),
  ],
  [
    'failed production case',
    (f) => (f.results.browser.production[0].passed = false),
  ],
  [
    'duplicate production case',
    (f) => (f.results.browser.production[1] = f.results.browser.production[0]),
  ],
  ['missing lifecycle', (f) => delete f.results.browser.view],
  [
    'wrong lifecycle evidence',
    (f) =>
      (f.results.browser.view.evidence.actualAngularComponentDestroy = false),
  ],
  [
    'view remained subscribed',
    (f) => (f.results.browser.view.evidence.absent.active = 1),
  ],
])
  test('verification rejects ' + name, () => {
    assert.equal(typeof module.assertVerification, 'function');
    const f = fixture();
    change(f);
    assert.throws(() => module.assertVerification(f.app, f.view, f.results));
  });
