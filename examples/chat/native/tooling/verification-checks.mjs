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
  for (const evidence of [view.source, view.helper])
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
  return framework;
}
