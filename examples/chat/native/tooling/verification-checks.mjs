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
  const evidence = results.browser.view.evidence;
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
