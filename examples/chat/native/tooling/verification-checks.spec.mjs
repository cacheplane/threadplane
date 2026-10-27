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
    profile:
      framework === 'react'
        ? 'react-native-a2ui-langgraph'
        : 'angular-langgraph',
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
    profile: app.profile,
    inputs: { ...common, ...tools },
    source: { path: source, sha256: 'entry' },
    helper: { path: helper, sha256: 'helper' },
  };
  if (framework === 'react') {
    for (const path of [
      'react/src/application.ts',
      'react/src/a2ui-message-content.ts',
      'react/src/a2ui-trip-catalog.ts',
    ]) {
      common[path] = path;
      app.provenance.inputs['examples/chat/native/' + path] = path;
      app.provenance.copied[path] = path;
      view.inputs[path] = path;
    }
    for (const path of [
      'node_modules/@threadplane/content/src/a2ui/create-surfaces.d.ts',
      'node_modules/@threadplane/content/src/a2ui/create-surfaces.js',
      'node_modules/@threadplane/a2ui/src/index.d.ts',
    ]) {
      common[path] = path;
      view.inputs[path] = path;
    }
    view.compiler = {
      inputs: Object.keys(common).filter((p) => !p.endsWith('.js')),
    };
    view.runtime = Object.keys(common).filter((p) => !p.endsWith('.d.ts'));
    app.provenance.compiler.inputs = Object.fromEntries(
      Object.entries(common).filter(([p]) => !p.endsWith('.js'))
    );
    app.provenance.bundler.inputs = Object.fromEntries(
      Object.entries(common).filter(([p]) => !p.endsWith('.d.ts'))
    );
    app.provenance.inputs['examples/chat/native/tooling/view-owner.react.ts'] =
      'react helper';
    view.reactHelper = {
      path: 'examples/chat/native/tooling/view-owner.react.ts',
      sha256: 'react helper',
    };
  }
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
  if (framework === 'react') {
    const raw = {
      created: 1,
      applies: 4,
      disposed: 0,
      active: 1,
      disposalCounts: [0],
      titles: ['<img src=x onerror=alert(1)> Supplied recap', 'Empty recap'],
    };
    for (const phase of ['before', 'absent', 'updated', 'remounted']) {
      results.browser.view.evidence[phase] ??= {};
      Object.assign(results.browser.view.evidence[phase], {
        raw,
        preparedCardCount: 2,
      });
    }
    results.browser.view.evidence.disposed.raw = {
      ...raw,
      disposed: 1,
      active: 0,
      disposalCounts: [1],
    };
    results.browser.view.evidence.rawSnapshotIdentity = true;
    results.browser.view.evidence.preparedCardIdentity = true;
    results.browser.view.evidence.rawSnapshotRenderedText = true;
    results.browser.a2ui = {
      name: 'production React A2UI ownership while absent and across navigation',
      passed: true,
      requests: [
        ['POST', '/api/threads/search'],
        ['GET', '/api/threads/a'],
        ['POST', '/api/threads/a/history'],
        ['POST', '/api/threads/a/runs/stream'],
        ['POST', '/api/threads/a/state'],
        ['GET', '/api/threads/b'],
        ['POST', '/api/threads/b/history'],
        ['POST', '/api/threads/b/runs/stream'],
        ['POST', '/api/threads/b/state'],
      ].map(([method, path]) => ({ method, path })),
      evidence: {
        exactRequestCount: 9,
        terminalWriteCount: 2,
        rawSnapshotRenderedText: true,
        preparedCardIdentity: true,
        rawSnapshotIdentity: true,
        retainedSnapshotsReadable: true,
        before: {
          created: 0,
          applies: 0,
          disposed: 0,
          active: 0,
          disposalCounts: [],
          titles: [],
        },
        absent: raw,
        remounted: raw,
        navigated: { ...raw, disposed: 1, active: 0, disposalCounts: [1] },
        second: {
          created: 2,
          applies: 8,
          disposed: 1,
          active: 1,
          disposalCounts: [1, 0],
          titles: [...raw.titles, ...raw.titles],
        },
        disposed: {
          created: 2,
          applies: 8,
          disposed: 2,
          active: 0,
          disposalCounts: [1, 1],
          titles: [...raw.titles, ...raw.titles],
        },
        generations: [
          { id: 'summary-message', generation: 'first-generation' },
          { id: 'summary-message', generation: 'second-generation' },
        ],
        ownerEpochs: [
          { id: 1, disposed: true, surfaces: ['summary-one', 'summary-empty'] },
          {
            id: 2,
            disposed: false,
            surfaces: ['summary-one', 'summary-empty'],
          },
        ],
      },
    };
  }
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

for (const path of [
  'react/src/application.ts',
  'react/src/a2ui-message-content.ts',
  'react/src/a2ui-trip-catalog.ts',
])
  for (const graph of [
    'compiler',
    'bundler',
    'copied',
    'viewCompiler',
    'viewRuntime',
  ])
    test(`React verification positively requires ${graph} ${path}`, () => {
      const f = fixture('react');
      if (graph === 'viewCompiler')
        f.view.compiler.inputs = f.view.compiler.inputs.filter(
          (p) => p !== path
        );
      else if (graph === 'viewRuntime')
        f.view.runtime = f.view.runtime.filter((p) => p !== path);
      else
        delete (
          graph === 'copied'
            ? f.app.provenance.copied
            : f.app.provenance[graph].inputs
        )[path];
      assert.throws(() => module.assertVerification(f.app, f.view, f.results));
    });
for (const [name, mutate] of [
  ['profile substitution', (f) => (f.view.profile = 'react-langgraph')],
  ['missing React helper', (f) => delete f.view.reactHelper],
  [
    'missing protocol declarations',
    (f) => {
      f.view.compiler.inputs = f.view.compiler.inputs.filter(
        (p) => !p.includes('/a2ui/')
      );
    },
  ],
  [
    'protocol runtime',
    (f) => f.view.runtime.push('node_modules/@threadplane/a2ui/src/index.js'),
  ],
  ['missing lifecycle', (f) => delete f.results.browser.a2ui],
  [
    'forged raw apply count',
    (f) =>
      (f.results.browser.view.evidence.updated.raw = {
        ...f.results.browser.view.evidence.updated.raw,
        applies: 5,
      }),
  ],
  [
    'forged prepared identity',
    (f) => (f.results.browser.view.evidence.preparedCardIdentity = false),
  ],
  [
    'forged absent work',
    (f) =>
      (f.results.browser.a2ui.evidence.absent = {
        ...f.results.browser.a2ui.evidence.absent,
        applies: 0,
      }),
  ],
  [
    'forged navigation disposal',
    (f) =>
      (f.results.browser.a2ui.evidence.navigated = {
        ...f.results.browser.a2ui.evidence.navigated,
        disposed: 0,
      }),
  ],
  [
    'duplicate disposal',
    (f) => (f.results.browser.a2ui.evidence.disposed.disposalCounts = [2, 0]),
  ],
  ['extra lifecycle request', (f) => f.results.browser.a2ui.requests.push({})],
  [
    'substituted lifecycle request',
    (f) => (f.results.browser.a2ui.requests[4].path = '/api/threads/b/state'),
  ],
  [
    'same generation',
    (f) =>
      (f.results.browser.a2ui.evidence.generations[1].generation =
        'first-generation'),
  ],
  [
    'forged owner epoch',
    (f) => (f.results.browser.a2ui.evidence.ownerEpochs[1].id = 1),
  ],
])
  test('React verification rejects ' + name, () => {
    const f = fixture('react');
    mutate(f);
    assert.throws(() => module.assertVerification(f.app, f.view, f.results));
  });
