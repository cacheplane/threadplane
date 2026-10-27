import assert from 'node:assert/strict';
import { selectedFramework } from './commands.mjs';

export const productionCases = [
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
export const lifecycleName = (framework) =>
  selectedFramework(framework) === 'angular'
    ? 'actual Angular component destruction/remount and explicit owner disposal'
    : 'actual React unmount/remount and explicit owner disposal';

// Bound comparisons of already checked records; this is integrity, not signing.
export function assertVerification(app, view, results) {
  const framework = selectedFramework(app.framework);
  assert.ok(app.framework, 'App framework required');
  assert.equal(view.framework, framework, 'App/view framework mismatch');
  const profile =
    framework === 'react' ? 'react-native-a2ui-langgraph' : 'angular-langgraph';
  assert.equal(app.profile, profile, 'Explicit app profile required');
  assert.equal(view.profile, profile, 'App/view profile mismatch');
  assert.equal(app.provenance.framework, framework);
  const common = {
    ...app.tools,
    ...app.provenance.copied,
    ...app.provenance.compiler.inputs,
    ...app.provenance.bundler.inputs,
  };
  for (const [name, files] of Object.entries(
    app.provenance.installation.artifacts
  ))
    for (const { path, sha256 } of files)
      common['node_modules/' + name + '/' + path] = sha256;
  for (const path of [
    'shared/application.ts',
    framework === 'angular'
      ? 'angular/src/app.component.ts'
      : 'react/src/app.tsx',
  ]) {
    assert.ok(
      common[path] && view.inputs[path],
      'Common application input required'
    );
    assert.equal(
      view.inputs[path],
      common[path],
      'App/view source mismatch: ' + path
    );
  }
  for (const [path, digest] of Object.entries(view.inputs))
    if (common[path])
      assert.equal(digest, common[path], 'App/view input mismatch: ' + path);
  if (framework === 'react') {
    for (const path of [
      'react/src/application.ts',
      'react/src/a2ui-message-content.ts',
      'react/src/a2ui-trip-catalog.ts',
    ]) {
      const digest = app.provenance.inputs['examples/chat/native/' + path];
      assert.ok(digest, 'Production React source required: ' + path);
      for (const inputs of [
        app.provenance.copied,
        app.provenance.compiler.inputs,
        app.provenance.bundler.inputs,
        view.inputs,
      ])
        assert.equal(
          inputs[path],
          digest,
          'Production React graph hash required: ' + path
        );
      assert.ok(
        view.compiler.inputs.includes(path),
        'Production React view compiler required: ' + path
      );
      assert.ok(
        view.runtime.includes(path),
        'Production React view runtime required: ' + path
      );
    }
    const raw = 'node_modules/@threadplane/content/src/a2ui/create-surfaces';
    for (const [graph, extension, paths] of [
      ['compiler', '.d.ts', view.compiler.inputs],
      ['bundler', '.js', view.runtime],
    ]) {
      const path = raw + extension;
      assert.ok(
        app.provenance[graph].inputs[path] && paths.includes(path),
        'Installed raw owner graph required'
      );
      assert.equal(
        view.inputs[path],
        app.provenance[graph].inputs[path],
        'Installed raw owner hash required'
      );
    }
    for (const paths of [
      Object.keys(app.provenance.compiler.inputs),
      view.compiler.inputs,
    ])
      assert.ok(
        paths.some(
          (path) =>
            path.startsWith('node_modules/@threadplane/a2ui/') &&
            path.endsWith('.d.ts')
        ),
        'Protocol declarations required'
      );
    for (const paths of [
      Object.keys(app.provenance.bundler.inputs),
      view.runtime,
    ])
      for (const path of paths)
        assert.doesNotMatch(
          path,
          /^node_modules\/@threadplane\/a2ui\//,
          'Protocol runtime forbidden'
        );
    assert.equal(
      view.reactHelper.path,
      'examples/chat/native/tooling/view-owner.react.ts'
    );
  }
  for (const evidence of [
    view.source,
    view.helper,
    ...(framework === 'react' ? [view.reactHelper] : []),
  ])
    assert.equal(
      evidence.sha256,
      app.provenance.inputs[evidence.path],
      'App/view proof source mismatch'
    );
  assert.equal(results.framework, framework);
  assert.equal(
    results.installed.target,
    'native-conversation-' + framework + ':test'
  );
  assert.equal(results.installed.passed, true);
  assert.equal(results.browser.framework, framework);
  assert.deepEqual(
    results.browser.production.map((r) => r.name),
    productionCases
  );
  for (const result of [...results.browser.production, results.browser.view]) {
    assert.equal(result.passed, true, 'Successful browser evidence required');
    assert.ok(
      Array.isArray(result.requests) && result.requests.length,
      'Actual request evidence required'
    );
  }
  assert.equal(results.browser.view.name, lifecycleName(framework));
  const approval = results.browser.production.find(
    (result) =>
      result.name ===
      'canonical approval, repeated pause, preserved draft and uncertain Stop'
  );
  assert.equal(
    approval.requests.length,
    8,
    'Exact approval request evidence required'
  );
  assert.equal(approval.evidence.exactRequestCount, 8);
  for (const key of [
    'literalReason',
    'keyboardDecisions',
    'draftPreserved',
    'repeatPauseAfterSettlement',
    'physicalCloseBeforeCleanup',
    'uncertainPauseNotActionable',
  ])
    assert.equal(
      approval.evidence[key],
      true,
      'Approval evidence required: ' + key
    );
  assert.equal(approval.evidence.mobileOverflow, false);
  const summary = results.browser.production.find(
    (result) =>
      result.name ===
      'supplied trip summaries, terminal persistence and observational reload'
  );
  assert.equal(
    summary.requests.length,
    9,
    'Exact summary request evidence required'
  );
  assert.equal(summary.evidence.exactRequestCount, 9);
  for (const key of [
    'exactTerminalPersistence',
    'terminalNoAutoContinue',
    'nextExplicitSubmit',
    'cardsRetainedAfterNextTurn',
    'pendingStatus',
    'restorationNoReexecute',
    'literalSummary',
    'duplicateLabels',
    'emptyLists',
  ])
    assert.equal(
      summary.evidence[key],
      true,
      'Summary evidence required: ' + key
    );
  assert.equal(summary.evidence.mobileOverflow, false);
  const failure = results.browser.production.find(
    (result) =>
      result.name ===
      'trip summary persistence failure remains an error without automatic retry'
  );
  assert.equal(
    failure.requests.length,
    8,
    'Exact summary failure request evidence required'
  );
  assert.equal(failure.evidence.exactRequestCount, 8);
  for (const key of [
    'errorStatus',
    'oneWriteAttempt',
    'noAutomaticRetry',
    'restorationNoReexecute',
  ])
    assert.equal(
      failure.evidence[key],
      true,
      'Summary failure evidence required: ' + key
    );
  const evidence = results.browser.view.evidence;
  assert.equal(
    results.browser.view.requests.length,
    6,
    'Exact view request evidence required'
  );
  assert.equal(evidence.exactRequestCount, 6);
  assert.equal(evidence.terminalWriteCount, 1);
  assert.equal(evidence.tripSummaryIdentity, true);
  for (const phase of ['before', 'absent', 'remounted'])
    assert.equal(
      evidence[phase].tripSummaryCount,
      2,
      'Nonempty view summary evidence required: ' + phase
    );
  assert.equal(
    evidence[
      framework === 'angular'
        ? 'actualAngularComponentDestroy'
        : 'actualCreateRootUnmount'
    ],
    true
  );
  assert.equal(evidence.physicalCloseBeforeCleanup, true);
  assert.equal(evidence.before.active, 1);
  assert.equal(evidence.absent.active, 0);
  assert.equal(evidence.remounted.active, 1);
  assert.equal(evidence.disposed.sessionActive, 0);
  assert.equal(evidence.disposed.ownerDisposals, 1);
  if (framework === 'react') {
    const titles = [
      '<img src=x onerror=alert(1)> Supplied recap',
      'Empty recap',
    ];
    const first = {
      created: 1,
      applies: 4,
      disposed: 0,
      active: 1,
      disposalCounts: [0],
      titles,
    };
    for (const phase of ['before', 'absent', 'updated', 'remounted']) {
      assert.deepEqual(
        evidence[phase].raw,
        first,
        'Stable production raw owner: ' + phase
      );
      assert.equal(evidence[phase].preparedCardCount, 2);
    }
    assert.deepEqual(evidence.disposed.raw, {
      ...first,
      disposed: 1,
      active: 0,
      disposalCounts: [1],
    });
    for (const key of [
      'rawSnapshotIdentity',
      'preparedCardIdentity',
      'rawSnapshotRenderedText',
    ])
      assert.equal(evidence[key], true);
    const lifecycle = results.browser.a2ui;
    assert.equal(
      lifecycle.name,
      'production React A2UI ownership while absent and across navigation'
    );
    assert.equal(lifecycle.passed, true);
    assert.equal(
      lifecycle.requests.length,
      9,
      'Exact A2UI lifecycle requests required'
    );
    assert.deepEqual(
      lifecycle.requests.map(({ method, path }) => [method, path]),
      [
        ['POST', '/api/threads/search'],
        ['GET', '/api/threads/a'],
        ['POST', '/api/threads/a/history'],
        ['POST', '/api/threads/a/runs/stream'],
        ['POST', '/api/threads/a/state'],
        ['GET', '/api/threads/b'],
        ['POST', '/api/threads/b/history'],
        ['POST', '/api/threads/b/runs/stream'],
        ['POST', '/api/threads/b/state'],
      ],
      'Exact A2UI lifecycle wire sequence required'
    );
    const a = lifecycle.evidence;
    assert.equal(a.exactRequestCount, 9);
    assert.equal(a.terminalWriteCount, 2);
    for (const key of [
      'rawSnapshotRenderedText',
      'preparedCardIdentity',
      'rawSnapshotIdentity',
      'retainedSnapshotsReadable',
    ])
      assert.equal(a[key], true);
    assert.deepEqual(a.before, {
      created: 0,
      applies: 0,
      disposed: 0,
      active: 0,
      disposalCounts: [],
      titles: [],
    });
    assert.deepEqual(a.absent, first);
    assert.deepEqual(a.remounted, first);
    assert.deepEqual(a.navigated, {
      ...first,
      disposed: 1,
      active: 0,
      disposalCounts: [1],
    });
    assert.deepEqual(a.second, {
      created: 2,
      applies: 8,
      disposed: 1,
      active: 1,
      disposalCounts: [1, 0],
      titles: [...titles, ...titles],
    });
    assert.deepEqual(a.disposed, {
      created: 2,
      applies: 8,
      disposed: 2,
      active: 0,
      disposalCounts: [1, 1],
      titles: [...titles, ...titles],
    });
    assert.equal(a.generations.length, 2);
    for (const value of a.generations) {
      assert.equal(value.id, 'summary-message');
      assert.ok(
        typeof value.generation === 'string' && value.generation.length > 0
      );
    }
    assert.notEqual(
      a.generations[0].generation,
      a.generations[1].generation,
      'Navigation must create a new delivery generation'
    );
    assert.deepEqual(a.ownerEpochs, [
      { id: 1, disposed: true, surfaces: ['summary-one', 'summary-empty'] },
      { id: 2, disposed: false, surfaces: ['summary-one', 'summary-empty'] },
    ]);
  }
  return framework;
}
