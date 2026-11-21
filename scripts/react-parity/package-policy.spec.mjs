import assert from 'node:assert/strict';
import test from 'node:test';
import * as policy from './package-policy.mjs';

test('JSON kernel stays out of core while content can own it', () => {
  assert.equal(policy.forbiddenDependency('core', '@cacheplane/json-stream'), true);
  assert.equal(policy.forbiddenDependency('content', '@cacheplane/json-stream'), false);
});
test('render engine stays out of dependency-free core while native React can use it', () => {
  assert.equal(policy.forbiddenDependency('core', '@json-render/core'), true);
  assert.equal(policy.forbiddenDependency('react', '@json-render/core'), false);
});

for (const root of ['/repo', '/repo/', 'C:\\repo', 'C:/repo/']) {
  test(`runtime source policy normalizes path separators for ${root}`, () => {
    const prefix = `${root.replace(/[/\\]$/, '')}/libs/langgraph/`;
    for (const path of [
      `${prefix}src/runtime/create-session.ts`,
      `${prefix}src/runtime/transport.types.ts`,
      `${prefix}src/runtime/operation-errors.ts`,
      `${prefix}src/runtime/transport.types.ts/bridge.ts`,
      `${prefix}src/public-api.ts`,
      `${prefix}live/backend.ts`,
      `${prefix}package.json`,
    ]) {
      // Every source file of a backend package is backend source: no file is shared with an Angular package.
      const expected = path.includes('/src/') ? 'private' : undefined;
      assert.equal(policy.backendRuntimeSourceKind(root, path), expected);
      assert.equal(policy.backendRuntimeSourceKind(root, path.replaceAll('/', '\\')), expected);
    }
  });
}

test('final internal dependencies follow the approved package roles', () => {
  const expected = { core: [], langgraph: ['core'], 'ag-ui': ['core'], a2ui: [], content: ['core', 'a2ui'], angular: ['core', 'content', 'a2ui', 'telemetry'], react: ['core', 'content', 'a2ui'], telemetry: ['core'] };
  for (const [project, allowed] of Object.entries(expected)) {
    for (const dependency of Object.keys(expected).filter((name) => name !== project)) {
      assert.equal(policy.forbiddenDependency(project, `@threadplane/${dependency}`), !allowed.includes(dependency), `${project} -> ${dependency}`);
    }
  }
});

for (const project of ['langgraph', 'ag-ui']) {
  test(`${project} neutral dependency policy admits only its own backend and exact SDK`, () => {
    const sdk = project === 'langgraph' ? '@langchain/langgraph-sdk' : '@ag-ui/client';
    const policyOptions = { neutralRuntime: true };
    for (const allowed of [sdk, `@threadplane/${project}`, '@threadplane/core', './local', ...(project === 'ag-ui' ? ['rxjs'] : [])]) {
      assert.equal(policy.forbiddenDependency(project, allowed, policyOptions), false, allowed);
    }
    for (const denied of ['@angular/core', '@threadplane/angular/chat', '@threadplane/angular', 'zod', 'unreviewed', `${sdk}/private`,
      ...(project === 'ag-ui' ? ['@threadplane/langgraph', '@langchain/langgraph-sdk', '@ag-ui/core', 'rxjs/operators'] : ['@threadplane/ag-ui', '@ag-ui/client', 'rxjs'])]) {
      assert.equal(policy.forbiddenDependency(project, denied, policyOptions), true, denied);
    }
  });
}

test('AG-UI runtime has no shared source exceptions', () => {
  for (const filename of ['create-http-request.ts', 'transport.types.ts', 'operation-errors.ts']) {
    assert.equal(policy.backendRuntimeSourceKind('/repo', `/repo/libs/ag-ui/src/runtime/${filename}`), 'private');
    assert.equal(policy.backendRuntimeSourceKind('C:\\repo', `C:\\repo\\libs\\ag-ui\\src\\runtime\\${filename}`), 'private');
  }
  assert.equal(policy.backendRuntimeSourceKind('/repo', '/repo/libs/ag-ui/src/public-api.ts'), 'private');
  assert.equal(policy.backendRuntimeSourceKind('/repo', '/repo/libs/ag-ui/fixtures/owner.ts'), undefined);
  assert.equal(policy.backendRuntimeSourceKind('/repo', '/repo/libs/chat/src/runtime/owner.ts'), undefined);
});

test('foundations, published packages and the remaining Angular exception are separate inventories', () => {
  assert.deepEqual(policy.foundationProjects, ['core', 'content', 'angular', 'react']);
  for (const retired of ['langgraph-core', 'ag-ui-core', 'react-render']) assert.ok(!policy.scanProjects.includes(retired));
  // The backend packages left the transition list at the cutover, and the
  // render engine when it became an entry point of `angular`.
  assert.deepEqual(policy.angularTransitionProjects, []);
  assert.deepEqual(policy.backendProjects, ['langgraph', 'ag-ui']);
  // Chat and render are entry points of the one Angular package.
  assert.deepEqual(policy.angularProjects, ['angular']);
  assert.deepEqual(policy.privateProjects, ['react']);
  assert.deepEqual(policy.publishableProjects, ['core', 'content', 'angular', 'langgraph', 'ag-ui', 'a2ui', 'telemetry']);
  for (const retired of ['chat', 'render']) assert.ok(!policy.scanProjects.includes(retired), retired);
  for (const project of [...policy.publishableProjects, ...policy.privateProjects]) assert.ok(policy.scanProjects.includes(project), project);
  assert.equal(policy.sourceEntry('angular'), 'src/public-api.ts');
  assert.equal(policy.sourceEntry('langgraph'), 'src/public-api.ts');
  assert.equal(policy.sourceEntry('ag-ui'), 'src/public-api.ts');
  assert.ok(policy.scanProjects.includes('telemetry'));
  assert.equal(policy.sourceEntry('angular'), 'src/public-api.ts');
  assert.equal(policy.sourceEntry('react'), 'src/index.ts');
});

test('Angular facade allows Angular peers without a transition exception', () => {
  assert.deepEqual(policy.manifestViolations('angular', { peerDependencies: { '@angular/core': '*', '@angular/common': '*' } }), []);
  for (const dependency of ['react', 'react-dom', '@langchain/core', '@ag-ui/client', '@threadplane/langgraph', '@threadplane/ag-ui', '@threadplane/react']) {
    assert.equal(policy.forbiddenDependency('angular', dependency, { angularTransitions: ['angular'] }), true, dependency);
  }
  // The chat UI hands the development collector to the agent layer.
  assert.equal(policy.forbiddenDependency('angular', '@threadplane/telemetry'), false);
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
    for (const [project, dependency] of [['telemetry', 'angular'], ['content', 'telemetry'], ['react', 'telemetry'], ['langgraph', 'angular'], ['ag-ui', 'content'], ['content', 'langgraph'], ['core', 'content']]) {
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

test('backend packages reject Angular and chat in source and in their manifests', () => {
  for (const project of ['langgraph', 'ag-ui']) {
    for (const dependency of ['@angular/core', '@threadplane/angular/chat', '@threadplane/angular', '@threadplane/react', 'react']) {
      assert.equal(policy.forbiddenDependency(project, dependency), true, `${project} ${dependency}`);
      assert.ok(policy.manifestViolations(project, { peerDependencies: { [dependency]: '*' } }).length > 0, `${project} manifest ${dependency}`);
    }
    assert.deepEqual(policy.manifestViolations(project, { peerDependencies: { '@threadplane/core': '*' } }), []);
  }
});

test('angular, with its chat UI, may use telemetry and parsers but not React or a backend', () => {
  assert.deepEqual(policy.manifestViolations('angular', { dependencies: { '@cacheplane/partial-markdown': '*' }, peerDependencies: { '@angular/core': '*', '@angular/router': '*', '@threadplane/core': '*', '@threadplane/telemetry': '*', '@json-render/core': '*', rxjs: '*', zod: '*', marked: '*' } }), []);
  for (const dependency of ['react', '@threadplane/react', '@threadplane/langgraph', '@threadplane/ag-ui', '@langchain/core', '@ag-ui/client']) {
    assert.equal(policy.forbiddenDependency('angular', dependency), true, dependency);
  }
  assert.ok(!policy.assertFinalRelease({ projects: ['angular'], angularTransitions: [], telemetryBrowserTransition: false }).length);
});
