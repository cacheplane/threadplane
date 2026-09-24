import assert from 'node:assert/strict';
import test from 'node:test';
import * as policy from './package-policy.mjs';

for (const root of ['/repo', '/repo/', 'C:\\repo', 'C:/repo/']) {
  test(`runtime source policy normalizes path separators for ${root}`, () => {
    const prefix = `${root.replace(/[/\\]$/, '')}/libs/langgraph/`;
    for (const path of [
      `${prefix}src/runtime/create-session.ts`,
      `${prefix}src/runtime/transport.types.ts`,
      `${prefix}src/runtime/operation-errors.ts`,
      `${prefix}src/runtime/transport.types.ts/bridge.ts`,
      `${prefix}src/runtime-copy/create-session.ts`,
    ]) {
      const expected = path.endsWith('/transport.types.ts') || path.endsWith('/operation-errors.ts') ? 'shared' : path.includes('/runtime/') ? 'private' : undefined;
      assert.equal(policy.backendRuntimeSourceKind(root, path), expected);
      assert.equal(policy.backendRuntimeSourceKind(root, path.replaceAll('/', '\\')), expected);
    }
  });
}

test('final internal dependencies follow the approved package roles', () => {
  const expected = { core: [], langgraph: ['core'], 'ag-ui': ['core'], render: ['core'], a2ui: [], content: ['core', 'render', 'a2ui'], angular: ['core', 'content', 'render', 'a2ui'], react: ['core', 'content', 'render', 'a2ui'], telemetry: ['core'] };
  for (const [project, allowed] of Object.entries(expected)) {
    for (const dependency of Object.keys(expected).filter((name) => name !== project)) {
      assert.equal(policy.forbiddenDependency(project, `@threadplane/${dependency}`), !allowed.includes(dependency), `${project} -> ${dependency}`);
    }
  }
});

for (const project of ['langgraph', 'ag-ui']) {
  test(`${project} neutral dependency policy admits only its own backend and exact SDK`, () => {
    const sdk = project === 'langgraph' ? '@langchain/langgraph-sdk' : '@ag-ui/client';
    const policyOptions = { neutralRuntime: true, angularTransitions: [project] };
    for (const allowed of [sdk, `@threadplane/${project}`, '@threadplane/core', './local']) {
      assert.equal(policy.forbiddenDependency(project, allowed, policyOptions), false, allowed);
    }
    for (const denied of ['@angular/core', '@threadplane/chat', '@threadplane/angular', 'rxjs', 'zod', 'unreviewed', `${sdk}/private`,
      ...(project === 'ag-ui' ? ['@threadplane/langgraph', '@langchain/langgraph-sdk', '@ag-ui/core'] : ['@threadplane/ag-ui', '@ag-ui/client'])]) {
      assert.equal(policy.forbiddenDependency(project, denied, policyOptions), true, denied);
    }
  });
}

test('AG-UI runtime has no shared source exceptions', () => {
  for (const filename of ['create-http-request.ts', 'transport.types.ts', 'operation-errors.ts']) {
    assert.equal(policy.backendRuntimeSourceKind('/repo', `/repo/libs/ag-ui/src/runtime/${filename}`), 'private');
    assert.equal(policy.backendRuntimeSourceKind('C:\\repo', `C:\\repo\\libs\\ag-ui\\src\\runtime\\${filename}`), 'private');
  }
  assert.equal(policy.backendRuntimeSourceKind('/repo', '/repo/libs/ag-ui/src/runtime-copy/owner.ts'), undefined);
});

test('private scaffolds and temporary Angular exceptions are separate inventories', () => {
  assert.deepEqual(policy.privateScaffoldProjects, ['core', 'content', 'angular', 'react']);
  for (const retired of ['langgraph-core', 'ag-ui-core', 'react-render']) assert.ok(!policy.scanProjects.includes(retired));
  assert.deepEqual(policy.angularTransitionProjects, ['chat', 'langgraph', 'ag-ui', 'render']);
  assert.ok(policy.scanProjects.includes('telemetry'));
  assert.equal(policy.sourceEntry('angular'), 'src/public-api.ts');
  assert.equal(policy.sourceEntry('react'), 'src/index.ts');
});

test('Angular facade allows Angular peers without a transition exception', () => {
  assert.deepEqual(policy.manifestViolations('angular', { peerDependencies: { '@angular/core': '*', '@angular/common': '*' } }), []);
  for (const dependency of ['react', 'react-dom', '@langchain/core', '@ag-ui/client', '@threadplane/langgraph', '@threadplane/ag-ui', '@threadplane/telemetry']) {
    assert.equal(policy.forbiddenDependency('angular', dependency, { angularTransitions: ['angular'] }), true, dependency);
  }
});

test('retired backend scaffolds do not inherit final backend roles', () => {
  for (const project of ['langgraph-core', 'ag-ui-core']) {
    assert.equal(policy.forbiddenDependency(project, '@threadplane/core'), true);
    assert.equal(policy.forbiddenDependency(project, '@langchain/core'), true);
  }
});

test('core does not reserve an optional Zod validation integration', () => {
  assert.equal(policy.forbiddenDependency('core', 'zod'), true);
});

test('final release rejects retained transition packages and exceptions', () => {
  assert.ok(policy.assertFinalRelease().length > 0);
  assert.deepEqual(policy.assertFinalRelease({ projects: Object.keys(policy.finalPackageDependencies), angularTransitions: [], telemetryBrowserTransition: false }), []);
  assert.ok(policy.assertFinalRelease({ projects: ['langgraph-core'], angularTransitions: [], telemetryBrowserTransition: false }).some((error) => error.includes('langgraph-core')));
  assert.ok(policy.assertFinalRelease({ projects: ['react-render'], angularTransitions: [], telemetryBrowserTransition: false }).some((error) => error.includes('react-render')));
});

test('manifest policy rejects dependency edges without needing imports', () => {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [project, dependency] of [['render', 'content'], ['angular', 'telemetry'], ['react', 'telemetry'], ['langgraph', 'angular'], ['ag-ui', 'render'], ['content', 'langgraph'], ['core', 'content']]) {
      assert.ok(policy.manifestViolations(project, { [field]: { [`@threadplane/${dependency}`]: '*' } }).length > 0, `${project} ${field} ${dependency}`);
    }
  }
});

for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  test(`core rejects arbitrary manifest-only ${field}`, () => {
    assert.deepEqual(policy.manifestViolations('core', { [field]: { lodash: '*' } }), [`core: forbidden ${field} entry lodash`]);
  });
}

test('emitted entries follow APF and legacy manifests without inventing exports', () => {
  assert.deepEqual(policy.emittedEntries({ exports: { '.': { types: './types/index.d.ts', default: './fesm2022/index.mjs' } } }), ['./types/index.d.ts', './fesm2022/index.mjs']);
  assert.deepEqual(policy.emittedEntries({ types: './index.d.ts', module: './index.js', main: './index.js' }), ['./index.d.ts', './index.js']);
  assert.deepEqual(policy.emittedEntries({ exports: { './browser': './browser.js' }, main: './index.js' }), []);
  assert.deepEqual(policy.emittedEntries({ types: './index.d.ts', main: './index.js' }, './missing'), []);
});

test('telemetry optional Angular peer requires the browser transition', () => {
  const manifest = { peerDependencies: { '@angular/core': '*' }, peerDependenciesMeta: { '@angular/core': { optional: true } } };
  assert.deepEqual(policy.manifestViolations('telemetry', manifest, { telemetryBrowserTransition: true }), []);
  assert.ok(policy.manifestViolations('telemetry', manifest).length > 0);
  assert.ok(policy.manifestViolations('telemetry', { peerDependencies: manifest.peerDependencies }, { telemetryBrowserTransition: true }).length > 0);
  assert.ok(policy.manifestViolations('telemetry', { ...manifest, dependencies: { '@angular/core': '*' } }, { telemetryBrowserTransition: true }).length > 0);
});
