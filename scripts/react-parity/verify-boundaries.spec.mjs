import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { verifyBoundaries } from './verify-boundaries.mjs';

const finalOptions = { angularTransitions: [], telemetryBrowserTransition: false };

test('React root retains lexical feature restrictions through filesystem aliases', (t) => {
  const root = fixture(t, {
    'libs/react/src/index.ts': "export * from './chat/linked';",
    'libs/react/src/shared.ts': 'export interface Shared {}',
  });
  mkdirSync(join(root, 'libs/react/src/chat'));
  symlinkSync('../shared.ts', join(root, 'libs/react/src/chat/linked.ts'));
  assert.ok(verifyBoundaries({ root, projects: ['react'], ...finalOptions }).some((error) => error.includes('feature dependency reachable from root')));
});

for (const project of ['langgraph', 'ag-ui']) {
  const sdk = project === 'langgraph' ? '@langchain/langgraph-sdk' : '@ag-ui/client';
  const otherBackend = project === 'langgraph' ? 'ag-ui' : 'langgraph';
  for (const [target, diagnostic] of [
    [`libs/${otherBackend}/src/runtime/private.ts`, 'neutral runtime forbidden dependency'],
    ['libs/core/src/private.ts', 'neutral runtime private/testing dependency'],
    ['libs/core/src/testing/helper.ts', 'neutral runtime private/testing dependency'],
    [`libs/${project}/src/runtime/testing/helper.ts`, 'neutral runtime private/testing dependency'],
  ]) {
    test(`${project} neutral runtime rejects a local symlink to ${target}`, (t) => {
      const root = fixture(t, {
        [`libs/${project}/src/public-api.ts`]: 'export {};',
        [`libs/${project}/src/runtime/owner.ts`]: "export type { Foreign } from './linked';",
        [target]: 'export interface Foreign {}',
      });
      symlinkSync(join(root, target), join(root, `libs/${project}/src/runtime/linked.ts`));
      assert.ok(verifyBoundaries({ root, projects: [project] }).some((error) => error.includes(diagnostic) && error.includes('./linked')));
    });
  }
  for (const entry of ['@threadplane/core', '@threadplane/core/tools']) {
    test(`${project} neutral runtime rejects ${entry} mapped to a private core file`, (t) => {
      const root = fixture(t, {
        'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { [entry]: ['./libs/core/src/private.ts'] } } }),
        [`libs/${project}/src/public-api.ts`]: 'export {};',
        [`libs/${project}/src/runtime/owner.ts`]: `export type { Core } from '${entry}';`,
        'libs/core/src/index.ts': 'export interface Core {}',
        'libs/core/src/tools/index.ts': 'export interface Core {}',
        'libs/core/src/private.ts': 'export interface Core {}',
      });
      assert.ok(verifyBoundaries({ root, projects: [project] }).some((error) => error.includes('neutral runtime private/testing dependency') && error.includes(entry)));
    });
  }
  test(`${project} neutral runtime permits exact core entries and their internal source traversal`, (t) => {
    const root = fixture(t, {
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: {
        '@threadplane/core': ['./libs/core/src/index.ts'],
        '@threadplane/core/tools': ['./libs/core/src/tools/index.ts'],
      } } }),
      [`libs/${project}/src/public-api.ts`]: 'export {};',
      [`libs/${project}/src/runtime/owner.ts`]: "export type { Core } from '@threadplane/core'; export type { Tool } from '@threadplane/core/tools';",
      'libs/core/src/index.ts': "export type { Core } from './private';",
      'libs/core/src/tools/index.ts': "export type { Tool } from '../private';",
      'libs/core/src/private.ts': 'export interface Core {} export interface Tool {}',
    });
    assert.deepEqual(verifyBoundaries({ root, projects: [project] }), []);
  });
  for (const alias of [`@threadplane/${project}`, `@threadplane/${project}/hidden`, '@threadplane/core', '@threadplane/core/tools', sdk]) {
    test(`${project} neutral runtime rejects ${alias} remapped to a private external SDK file`, (t) => {
      const root = fixture(t, {
        'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { [alias]: [`./node_modules/${sdk}/private.ts`] } } }),
        [`libs/${project}/src/public-api.ts`]: 'export {};',
        [`libs/${project}/src/runtime/owner.ts`]: `export type { SDK } from '${alias}';`,
        [`node_modules/${sdk}/package.json`]: JSON.stringify({ name: sdk, types: 'index.d.ts' }),
        [`node_modules/${sdk}/index.d.ts`]: 'export interface SDK {}',
        [`node_modules/${sdk}/private.ts`]: 'export interface SDK {}',
      });
      assert.ok(verifyBoundaries({ root, projects: [project] }).some((error) => error.includes('neutral runtime forbidden dependency') && error.includes(alias)));
    });
  }
  for (const alias of [false, true]) {
    for (const dependency of [`${sdk}/private`, 'rxjs/index']) {
      test(`${project} neutral runtime rejects ${alias ? 'symlinked' : 'relative'} external ${dependency}`, (t) => {
        const edge = alias ? './external-alias' : `../../../../node_modules/${dependency}`;
        const root = fixture(t, {
          [`libs/${project}/src/public-api.ts`]: 'export {};',
          [`libs/${project}/src/runtime/owner.ts`]: `export * from '${edge}';`,
          [`node_modules/${dependency}.ts`]: 'export interface External {}',
        });
        if (alias) symlinkSync(`../../../../node_modules/${dependency}.ts`, join(root, `libs/${project}/src/runtime/external-alias.ts`));
        assert.ok(verifyBoundaries({ root, projects: [project] }).some((error) => error.includes('neutral runtime forbidden dependency') && error.includes(edge)));
      });
    }
  }
  test(`${project} neutral runtime still permits the exact installed SDK root`, (t) => {
    const root = fixture(t, {
      [`libs/${project}/src/public-api.ts`]: 'export {};',
      [`libs/${project}/src/runtime/owner.ts`]: `export type { SDK } from '${sdk}';`,
      [`node_modules/${sdk}/package.json`]: JSON.stringify({ name: sdk, types: 'index.d.ts' }),
      [`node_modules/${sdk}/index.d.ts`]: 'export interface SDK {}',
    });
    assert.deepEqual(verifyBoundaries({ root, projects: [project] }), []);
  });
}

for (const dependency of ['@angular/core', '@threadplane/chat', '@threadplane/langgraph', '@langchain/langgraph-sdk', '@ag-ui/client/private', '@ag-ui/core', 'rxjs', 'unreviewed']) {
  test(`AG-UI neutral runtime rejects transitive ${dependency} despite prior legacy visits`, (t) => {
    const root = fixture(t, {
      'libs/ag-ui/src/public-api.ts': "export * from './lib/shared';",
      'libs/ag-ui/src/lib/shared.ts': `export type { X } from '${dependency}';`,
      'libs/ag-ui/src/runtime/create-http-request.ts': "export * from '../lib/shared';",
    });
    assert.ok(verifyBoundaries({ root, projects: ['ag-ui'] }).some((error) => error.includes('neutral runtime') && error.includes(dependency)));
  });
}

for (const edge of [
  "export * from './runtime/create-http-request';",
  "export type { Request } from './runtime/create-http-request';",
  "export * from './bridge';",
  "export * from '@private-request';",
  "void import('./runtime/create-http-request');",
  "type Request = import('./runtime/create-http-request').Request;",
  "const request = require('./runtime/create-http-request');",
]) {
  test(`AG-UI legacy source rejects private request reachability: ${edge}`, (t) => {
    const root = fixture(t, {
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { '@private-request': ['./libs/ag-ui/src/runtime/create-http-request.ts'] } } }),
      'libs/ag-ui/src/public-api.ts': edge,
      ...(edge.includes('./bridge') ? { 'libs/ag-ui/src/bridge.ts': "export * from './runtime/create-http-request';" } : {}),
      'libs/ag-ui/src/runtime/create-http-request.ts': 'export interface Request {}',
    });
    assert.ok(verifyBoundaries({ root, projects: ['ag-ui'] }).some((error) => error.includes('private runtime reachable from legacy source')));
  });
}

for (const project of ['chat', 'langgraph', 'render', 'angular']) {
  test(`${project} cannot reach AG-UI private runtime through indirection`, (t) => {
    const root = fixture(t, {
      [`libs/${project}/src/public-api.ts`]: "export * from './bridge';",
      [`libs/${project}/src/bridge.ts`]: "export * from '../../ag-ui/src/runtime/create-http-request';",
      'libs/ag-ui/src/runtime/create-http-request.ts': 'export interface Request {}',
    });
    assert.ok(verifyBoundaries({ root, projects: [project] }).some((error) => error.includes('private runtime reachable from legacy source')));
  });
}

test('AG-UI filesystem aliases retain private runtime identity', (t) => {
  const root = fixture(t, {
    'libs/ag-ui/src/public-api.ts': "export * from './linked-request';",
    'libs/ag-ui/src/runtime/create-http-request.ts': 'export interface Request {}',
  });
  symlinkSync('runtime/create-http-request.ts', join(root, 'libs/ag-ui/src/linked-request.ts'));
  assert.ok(verifyBoundaries({ root, projects: ['ag-ui'] }).some((error) => error.includes('private runtime reachable from legacy source')));
  if (existsSync(join(root, 'libs/ag-ui/src/RUNTIME/create-http-request.ts'))) {
    writeFileSync(join(root, 'libs/ag-ui/src/public-api.ts'), "export * from './RUNTIME/create-http-request';");
    assert.ok(verifyBoundaries({ root, projects: ['ag-ui'] }).some((error) => error.includes('private runtime reachable from legacy source')));
  }
});

test('AG-UI public transition remains allowed while its runtime permits only public core and exact SDK', (t) => {
  const root = fixture(t, {
    'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: {
      '@threadplane/core': ['./libs/core/src/index.ts'],
      '@backend-alias': ['./libs/langgraph/src/index.ts'],
    } } }),
    'libs/ag-ui/src/public-api.ts': "export type { Signal } from '@angular/core';",
    'libs/ag-ui/src/runtime/create-http-request.ts': "export type { X } from '@threadplane/core'; export { HttpAgent } from '@ag-ui/client'; export * from './local';",
    'libs/ag-ui/src/runtime/local.ts': 'export interface Local {}',
    'libs/ag-ui/src/runtime/testing/helper.ts': 'export interface Helper {}',
    'libs/ag-ui/src/runtime/create-http-request.spec.ts': "import '@angular/core';",
    'libs/core/src/index.ts': 'export interface X {}',
    'libs/core/src/private.ts': 'export interface X {}',
    'libs/langgraph/src/index.ts': 'export interface X {}',
  });
  assert.deepEqual(verifyBoundaries({ root, projects: ['ag-ui'] }), []);
  for (const dependency of ['@backend-alias', '../../../langgraph/src/index', '../../../core/src/private', './testing/helper']) {
    writeFileSync(join(root, 'libs/ag-ui/src/runtime/create-http-request.ts'), `export * from '${dependency}';`);
    assert.ok(verifyBoundaries({ root, projects: ['ag-ui'] }).some((error) => error.includes('neutral runtime')), dependency);
  }
  assert.ok(verifyBoundaries({ root, projects: ['ag-ui'], finalRelease: true }).some((error) => error.includes('ag-ui: Angular transition remains enabled')));
});

for (const path of ['public-api.ts', 'runtime/create-http-request.ts']) {
  for (const code of ["const target = '@angular/core'; void import(target);", "const target = '@angular/core'; require(target);", 'export const broken = ;']) {
    test(`AG-UI guarded ${path} rejects unsupported dependency analysis: ${code}`, (t) => {
      const root = fixture(t, { [`libs/ag-ui/src/${path}`]: code });
      assert.ok(verifyBoundaries({ root, projects: ['ag-ui'] }).some((error) => error.includes('cannot analyze guarded dependencies')));
    });
  }
}

for (const edge of [
  "export * from './runtime/create-session';",
  "export type { Session } from './runtime/create-session';",
  "export * from './bridge';",
  "export * from '@private-session';",
  "void import('./runtime/create-session');",
]) {
  test(`legacy source rejects private runtime exposure: ${edge}`, (t) => {
    const root = fixture(t, {
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@private-session': ['libs/langgraph/src/runtime/create-session.ts'] } } }),
      'libs/langgraph/src/public-api.ts': edge,
      ...(edge.includes('./bridge') ? { 'libs/langgraph/src/bridge.ts': "export * from './runtime/create-session';" } : {}),
      'libs/langgraph/src/runtime/create-session.ts': 'export interface Session {}',
    });
    assert.ok(verifyBoundaries({ root, projects: ['langgraph'] }).some((error) => error.includes('private runtime reachable from legacy source')));
  });
}

for (const shared of ['transport.types', 'operation-errors']) {
  test(`legacy source may reach exactly shared ${shared}, but not private dependencies`, (t) => {
    const root = fixture(t, {
      'libs/langgraph/src/public-api.ts': `export * from './runtime/${shared}';`,
      [`libs/langgraph/src/runtime/${shared}.ts`]: 'export interface Shared {}',
      'libs/langgraph/src/runtime/create-session.ts': 'export interface Session {}',
    });
    assert.deepEqual(verifyBoundaries({ root, projects: ['langgraph'] }), []);
    writeFileSync(join(root, `libs/langgraph/src/runtime/${shared}.ts`), "export * from './create-session';");
    assert.ok(verifyBoundaries({ root, projects: ['langgraph'] }).some((error) => error.includes('private runtime reachable from legacy source')));
  });
}

test('legacy context revisits a shared module after an earlier permissive runtime visit', (t) => {
  const root = fixture(t, {
    'libs/langgraph/src/public-api.ts': 'export {};',
    'libs/langgraph/src/runtime/operation-errors.ts': "export * from './create-session';",
    'libs/langgraph/src/runtime/create-session.ts': 'export interface Session {}',
    'libs/langgraph/src/z-legacy.ts': "export * from './runtime/operation-errors';",
  });
  const errors = verifyBoundaries({ root, projects: ['langgraph'] });
  assert.ok(errors.some((error) => error.includes('private runtime reachable from legacy source') && error.includes('z-legacy.ts')), errors.join('\n'));
});

test('private neutral modules may depend on each other', (t) => {
  const root = fixture(t, {
    'libs/langgraph/src/public-api.ts': 'export {};',
    'libs/langgraph/src/runtime/create-session.ts': "export * from './ownership';",
    'libs/langgraph/src/runtime/ownership.ts': 'export interface Owned {}',
  });
  assert.deepEqual(verifyBoundaries({ root, projects: ['langgraph'] }), []);
});

test('another legacy library cannot import the private runtime directly', (t) => {
  const root = fixture(t, {
    'libs/chat/src/public-api.ts': "export * from '../../langgraph/src/runtime/create-session';",
    'libs/langgraph/src/runtime/create-session.ts': 'export interface Session {}',
  });
  assert.ok(verifyBoundaries({ root, projects: ['chat'] }).some((error) => error.includes('private runtime reachable from legacy source')));
});

test('case-insensitive filesystem aliases preserve exact runtime sharing policy', (t) => {
  const root = fixture(t, {
    'libs/langgraph/src/public-api.ts': "export * from './RUNTIME/create-session';",
    'libs/langgraph/src/runtime/create-session.ts': 'export interface Session {}',
    'libs/langgraph/src/runtime/transport.types.ts': 'export interface Shared {}',
  });
  if (!existsSync(join(root, 'libs/langgraph/src/RUNTIME/create-session.ts'))) {
    t.skip('Requires a case-insensitive filesystem; literal source checks remain covered.');
    return;
  }
  assert.ok(verifyBoundaries({ root, projects: ['langgraph'] }).some((error) => error.includes('private runtime reachable from legacy source')));
  writeFileSync(join(root, 'libs/langgraph/src/public-api.ts'), "export * from './RUNTIME/TRANSPORT.TYPES';");
  assert.deepEqual(verifyBoundaries({ root, projects: ['langgraph'] }), []);
});

for (const path of ['public-api.ts', 'runtime/create-session.ts']) {
  for (const code of [
    "const target = '@angular/core'; void import(target);",
    "const target = '@angular/core'; require(target);",
    'export const broken = ;',
  ]) {
    test(`guarded ${path} rejects unsupported dependency analysis: ${code}`, (t) => {
      const root = fixture(t, { [`libs/langgraph/src/${path}`]: code });
      assert.ok(verifyBoundaries({ root, projects: ['langgraph'] }).some((error) => error.includes('cannot analyze guarded dependencies')));
    });
  }
}

test('guarded legacy graph rejects unresolved internal sources', (t) => {
  const root = fixture(t, { 'libs/langgraph/src/public-api.ts': "export * from './missing';" });
  assert.ok(verifyBoundaries({ root, projects: ['langgraph'] }).some((error) => error.includes('unresolved dependency')));
});

for (const mode of ['source', 'built']) {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    test(`empty ${mode} core rejects manifest-only ${field}`, (t) => {
      const prefix = mode === 'source' ? 'libs/core' : 'dist/libs/core';
      const root = fixture(t, {
        [`${prefix}/package.json`]: JSON.stringify({ [field]: { lodash: '*' }, exports: { '.': { types: './src/index.d.ts', default: './src/index.js' } } }),
        [`${prefix}/src/index.ts`]: 'export {};',
        [`${prefix}/src/index.js`]: 'export {};',
        [`${prefix}/src/index.d.ts`]: 'export {};',
      });
      assert.ok(verifyBoundaries({ root, mode, projects: ['core'] }).includes(`core: forbidden ${field} entry lodash`));
    });
  }
}
const finalCases = [
  ['react', '@angular/core'], ['react', '@threadplane/langgraph'],
  ['langgraph', '@threadplane/angular'], ['ag-ui', '@threadplane/render'],
  ['core', '@angular/core'], ['core', 'marked'], ['core', 'rxjs'],
  ['content', '@threadplane/ag-ui'], ['render', '@threadplane/content'],
  ['render', '@angular/core'], ['angular', '@threadplane/telemetry'],
  ['angular', 'react'], ['angular', '@threadplane/langgraph'], ['angular', '@ag-ui/client'],
];
for (const variant of ['source', 'built-js', 'built-d.ts']) {
  const mode = variant === 'source' ? 'source' : 'built';
  for (const [project, dependency] of finalCases) {
    test(`final role ${variant} transitively rejects ${project} -> ${dependency}`, (t) => {
      const prefix = mode === 'source' ? 'libs' : 'dist/libs';
      const extension = mode === 'source' ? 'ts' : variant.slice('built-'.length);
      const entry = project === 'angular' ? 'public-api' : 'index';
      const files = {
        [`${prefix}/${project}/package.json`]: JSON.stringify({ exports: { '.': { types: `./src/${entry}.d.ts`, default: `./src/${entry}.js` } } }),
        [`${prefix}/${project}/src/${entry}.js`]: 'export {};',
        [`${prefix}/${project}/src/${entry}.d.ts`]: 'export {};',
        [`${prefix}/${project}/src/${entry}.${extension}`]: extension === 'js' ? "export * from './bridge.js';" : "export type { X } from './bridge.js';",
        [`${prefix}/${project}/src/bridge.${extension}`]: extension === 'js' ? `export * from '${dependency}';` : `export type { X } from '${dependency}';`,
      };
      const errors = verifyBoundaries({ root: fixture(t, files), projects: [project], mode, ...finalOptions });
      assert.ok(errors.some((error) => error.includes('forbidden dependency') && error.includes(dependency)), errors.join('\n'));
    });
  }
}

for (const mode of ['source', 'built']) {
  for (const entry of ['index', 'shared/public-api', 'node/index']) {
    test(`telemetry ${mode} ${entry} cannot reach Angular through browser`, (t) => {
      const prefix = mode === 'source' ? 'libs/telemetry/src' : 'dist/libs/telemetry';
      const extension = mode === 'source' ? 'ts' : 'd.ts';
      const browser = mode === 'source' ? 'browser/public-api' : 'browser/index';
      const files = {
        [`${prefix}/index.${extension}`]: 'export {};',
        [`${prefix}/${entry}.${extension}`]: `export * from '${entry.includes('/') ? '../' : './'}${browser}.js';`,
        [`${prefix}/${browser}.${extension}`]: "export type { Signal } from '@angular/core';",
      };
      if (mode === 'built') files['dist/libs/telemetry/package.json'] = JSON.stringify({ exports: { '.': { types: './index.d.ts' }, './browser': { types: './browser/index.d.ts' } } });
      const errors = verifyBoundaries({ root: fixture(t, files), projects: ['telemetry'], mode });
      assert.ok(errors.some((error) => error.includes('forbidden dependency') && error.includes('@angular/core')), errors.join('\n'));
    });
  }
  test(`telemetry ${mode} browser transition allows Angular but never React`, (t) => {
    const prefix = mode === 'source' ? 'libs/telemetry/src' : 'dist/libs/telemetry';
    const extension = mode === 'source' ? 'ts' : 'd.ts';
    const browser = mode === 'source' ? 'browser/public-api' : 'browser/index';
    const files = {
      [`${prefix}/index.${extension}`]: 'export {};',
      [`${prefix}/${browser}.${extension}`]: "export type { Signal } from '@angular/core';",
    };
    if (mode === 'built') files['dist/libs/telemetry/package.json'] = JSON.stringify({ exports: { '.': { types: './index.d.ts' }, './browser': { types: './browser/index.d.ts' } } });
    const root = fixture(t, files);
    assert.deepEqual(verifyBoundaries({ root, projects: ['telemetry'], mode }), []);
    writeFileSync(join(root, prefix, `${browser}.${extension}`), "export type { ReactNode } from 'react';");
    assert.ok(verifyBoundaries({ root, projects: ['telemetry'], mode }).some((error) => error.includes('forbidden dependency') && error.includes('react')));
  });
}

test('default source scan always includes telemetry', (t) => {
  const errors = verifyBoundaries({ root: fixture(t, { 'libs/telemetry/src/index.ts': "export * from '@angular/core';" }) });
  assert.ok(errors.some((error) => error.startsWith('telemetry: forbidden dependency')));
});

test('new Angular facade uses its public-api source entry', (t) => {
  const root = fixture(t, { 'libs/angular/src/public-api.ts': 'export {};' });
  assert.deepEqual(verifyBoundaries({ root, projects: ['angular'], ...finalOptions }), []);
});

test('new Angular facade requires its declared public-api source entry', (t) => {
  const root = fixture(t, { 'libs/angular/src/index.ts': 'export {};' });
  assert.ok(verifyBoundaries({ root, projects: ['angular'], ...finalOptions }).some((error) => error.includes('public-api.ts')));
});

test('final-release assertion is opt-in and fails while transitions remain', (t) => {
  const root = fixture(t, { 'libs/react/src/index.ts': 'export {};' });
  assert.deepEqual(verifyBoundaries({ root, projects: ['react'] }), []);
  assert.ok(verifyBoundaries({ root, projects: ['react'], finalRelease: true }).some((error) => error.includes('transition remains enabled')));
});

test('default built scan never omits telemetry', (t) => {
  const root = fixture(t, { 'dist/libs/telemetry/package.json': JSON.stringify({ exports: { '.': { types: './index.d.ts' } } }), 'dist/libs/telemetry/index.d.ts': "export type { Signal } from '@angular/core';" });
  assert.ok(verifyBoundaries({ root, mode: 'built' }).some((error) => error.startsWith('telemetry: forbidden dependency')));
});

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'threadplane-boundaries-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const sourceCases = [
  ['core type-only React import', 'core', "import type { ReactNode } from 'react'; export type X = ReactNode;"],
  ['core Angular re-export', 'core', "export type { Signal } from '@angular/core';"],
  ['backend UI import', 'langgraph', "export * from '@threadplane/react';"],
  ['AG-UI backend renderer import', 'ag-ui', "export * from '@threadplane/render';"],
  ['React Angular import', 'react', "export * from '@angular/core';"],
  ['React backend type import', 'react', "type X = import('@threadplane/langgraph').X; export type { X };"],
  ['Angular React import', 'chat', "export * from '@threadplane/react';"],
  ['core parser import', 'core', "export * from '@cacheplane/partial-markdown';"],
  ['core RxJS import', 'core', "export * from 'rxjs';"],
];
for (const [label, project, code] of sourceCases) {
  test(`rejects ${label}`, (t) => {
    const root = fixture(t, { [`libs/${project}/src/index.ts`]: code });
    assert.ok(verifyBoundaries({ root, projects: [project], ...finalOptions }).some((error) => error.includes('forbidden dependency')));
  });
}
test('follows TS aliases and relative re-exports transitively, including types', (t) => {
  const root = fixture(t, {
    'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { '@shared': ['./shared/index.ts'] } } }),
    'libs/core/src/index.ts': "export type { X } from '@shared';",
    'shared/index.ts': "export type { X } from './hidden.js';",
    'shared/hidden.ts': "export type { ReactNode as X } from 'react';",
  });
  assert.ok(verifyBoundaries({ root, projects: ['core'] }).some((error) => error.includes('react')));
});
test('rejects cross-package relative imports', (t) => {
  const root = fixture(t, {
    'libs/core/src/index.ts': "export * from '../../react/src/index.js';",
    'libs/react/src/index.ts': 'export {};',
  });
  assert.ok(verifyBoundaries({ root, projects: ['core'] }).length > 0);
});
for (const optional of ['testing', 'schema/zod', 'math']) {
  test(`isolates ${optional} from root transitive declarations`, (t) => {
    const root = fixture(t, {
      'libs/core/src/index.ts': "export type { X } from './bridge.js';",
      'libs/core/src/bridge.ts': `export type { X } from './${optional}/index.js';`,
      [`libs/core/src/${optional}/index.ts`]: 'export type X = string;',
    });
    assert.ok(verifyBoundaries({ root, projects: ['core'] }).length > 0);
  });
}
test('allows isolated testing entries without making them root dependencies', (t) => {
  const root = fixture(t, {
    'libs/core/src/index.ts': 'export {};',
    'libs/core/src/testing/index.ts': 'export {};',
  });
  assert.deepEqual(verifyBoundaries({ root, projects: ['core'] }), []);
});
test('rejects core validation dependencies outside the root graph', (t) => {
  const root = fixture(t, {
    'libs/core/src/index.ts': 'export {};',
    'libs/core/src/tools/index.ts': "export type { ZodType } from 'zod';",
  });
  assert.ok(verifyBoundaries({ root, projects: ['core'] }).some((error) => error.includes('forbidden dependency') && error.includes('zod')));
});
for (const extension of ['ts', 'js', 'd.ts']) {
  for (const dependency of ['some-validator', 'zod', 'tslib']) {
    test(`rejects off-root core ${extension} dependency on ${dependency}`, (t) => {
      const mode = extension === 'ts' ? 'source' : 'built';
      const prefix = mode === 'source' ? 'libs/core' : 'dist/libs/core';
      const root = fixture(t, {
        [`${prefix}/package.json`]: JSON.stringify({ exports: { '.': { types: './src/index.d.ts', import: './src/index.js' } } }),
        [`${prefix}/src/index.ts`]: 'export {};',
        [`${prefix}/src/index.js`]: 'export {};',
        [`${prefix}/src/index.d.ts`]: 'export {};',
        [`${prefix}/src/tools/index.${extension}`]: `export * from '${dependency}';`,
      });
      assert.ok(verifyBoundaries({ root, mode, projects: ['core'] }).some((error) => error.includes('unreviewed') && error.includes(dependency)));
    });
  }
}
for (const extension of ['js', 'd.ts']) {
  test(`inspects built ${extension} imports`, (t) => {
    const root = fixture(t, {
      'dist/libs/core/package.json': JSON.stringify({ name: '@threadplane/core', exports: { '.': { import: './src/index.js', types: './src/index.d.ts' } } }),
      'dist/libs/core/src/index.js': 'export {};',
      'dist/libs/core/src/index.d.ts': 'export {};',
      [`dist/libs/core/src/index.${extension}`]: "export * from './bridge.js';",
      [`dist/libs/core/src/bridge.${extension}`]: "export * from 'react';",
    });
    assert.ok(verifyBoundaries({ root, mode: 'built', projects: ['core'] }).length > 0);
  });
}
test('does not mistake comments or ordinary strings for imports', (t) => {
  const root = fixture(t, { 'libs/core/src/index.ts': "// import 'react';\nexport const example = \"import 'react'\";" });
  assert.deepEqual(verifyBoundaries({ root, projects: ['core'] }), []);
});
test('fails closed for unresolved local imports', (t) => {
  const root = fixture(t, { 'libs/core/src/index.ts': "export * from './missing.js';" });
  assert.ok(verifyBoundaries({ root, projects: ['core'] }).some((error) => error.includes('unresolved')));
});
test('rejects unreviewed external dependencies from the core root', (t) => {
  const root = fixture(t, { 'libs/core/src/index.ts': "export * from 'some-parser';" });
  assert.ok(verifyBoundaries({ root, projects: ['core'] }).some((error) => error.includes('some-parser')));
});
test('keeps optional math dependencies out of content root declarations', (t) => {
  const root = fixture(t, { 'libs/content/src/index.ts': "export type { KatexOptions } from 'katex';" });
  assert.ok(verifyBoundaries({ root, projects: ['content'] }).some((error) => error.includes('katex')));
});
test('rejects a missing foundation root entry', (t) => {
  const root = fixture(t, { 'libs/core/src/other.ts': 'export {};' });
  assert.ok(verifyBoundaries({ root, projects: ['core'] }).length > 0);
});
test('checks declared dependencies even when no source imports them yet', (t) => {
  const root = fixture(t, {
    'libs/langgraph/src/index.ts': 'export {};',
    'libs/langgraph/package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }),
  });
  assert.ok(verifyBoundaries({ root, projects: ['langgraph'], ...finalOptions }).some((error) => error.includes('react')));
});

const builtCases = [
  ['core to Angular', 'core', '@angular/core'],
  ['core to React', 'core', 'react'],
  ['LangGraph backend to UI', 'langgraph', '@threadplane/react'],
  ['AG-UI backend to UI', 'ag-ui', '@threadplane/render'],
  ['backend to Angular UI', 'langgraph', '@threadplane/angular'],
  ['React to Angular', 'react', '@angular/core'],
  ['React to backend', 'react', '@threadplane/langgraph'],
  ['React to retired renderer', 'react', '@threadplane/react-render'],
];
for (const extension of ['js', 'd.ts']) {
  for (const [label, project, dependency] of builtCases) {
    test(`rejects built ${extension} ${label}`, (t) => {
      const root = fixture(t, {
        [`dist/libs/${project}/package.json`]: JSON.stringify({ name: `@threadplane/${project}`, exports: { '.': { import: './src/index.js', types: './src/index.d.ts' } } }),
        [`dist/libs/${project}/src/index.js`]: 'export {};',
        [`dist/libs/${project}/src/index.d.ts`]: 'export {};',
        [`dist/libs/${project}/src/index.${extension}`]: extension === 'd.ts' ? `export type X = import('${dependency}').X;` : `export * from '${dependency}';`,
      });
      const errors = verifyBoundaries({ root, mode: 'built', projects: [project], ...finalOptions });
      assert.ok(errors.some((error) => error.includes('forbidden dependency') && error.includes(dependency)), errors.join('\n'));
    });
  }
}

// Exercise the default CLI project selection as well as Angular's actual APF
// layout: .mjs in fesm2022 and declarations under types, with a default export
// condition rather than an import condition.
for (const project of ['chat', 'langgraph', 'ag-ui', 'render']) {
  for (const extension of ['mjs', 'd.ts']) {
    test(`default built scan rejects ${project} ${extension} importing React`, (t) => {
      const files = {};
      for (const name of ['core', 'content', 'angular', 'react', 'chat', 'langgraph', 'ag-ui', 'render', 'a2ui', 'telemetry']) {
        files[`dist/libs/${name}/package.json`] = JSON.stringify({ name: `@threadplane/${name}`, exports: { '.': { types: `./types/${name}.d.ts`, default: `./fesm2022/${name}.mjs` } } });
        files[`dist/libs/${name}/fesm2022/${name}.mjs`] = 'export {};';
        files[`dist/libs/${name}/types/${name}.d.ts`] = 'export {};';
      }
      const directory = extension === 'mjs' ? 'fesm2022' : 'types';
      files[`dist/libs/${project}/${directory}/${project}.${extension}`] = extension === 'd.ts' ? "export type X = import('react').ReactNode;" : "export * from '@threadplane/react';";
      const errors = verifyBoundaries({ root: fixture(t, files), mode: 'built' });
      assert.ok(errors.some((error) => error.startsWith(`${project}: forbidden dependency`) && error.includes('react')), errors.join('\n'));
    });
  }
}

for (const extension of ['ts', 'js', 'd.ts']) {
  for (const feature of ['chat', 'markdown', 'a2ui', 'debug', 'tools', 'testing', 'render', 'render/types']) {
    test(`React root excludes ${feature} from transitive ${extension} exports`, (t) => {
      const mode = extension === 'ts' ? 'source' : 'built';
      const prefix = mode === 'source' ? 'libs/react' : 'dist/libs/react';
      const root = fixture(t, {
        [`${prefix}/package.json`]: JSON.stringify({ exports: { '.': { types: './src/index.d.ts', import: './src/index.js' } } }),
        [`${prefix}/src/index.js`]: 'export {};',
        [`${prefix}/src/index.d.ts`]: 'export {};',
        [`${prefix}/src/index.${extension}`]: "export * from './bridge.js';",
        [`${prefix}/src/bridge.${extension}`]: `export * from './${feature}/index.js';`,
        [`${prefix}/src/${feature}/index.${extension}`]: 'export {};',
      });
      assert.ok(verifyBoundaries({ root, mode, projects: ['react'] }).some((error) => error.includes('reachable from root') && error.includes(feature)));
    });
  }
}

test('React root permits binding implementation and core contracts', (t) => {
  const root = fixture(t, {
    'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { '@threadplane/core': ['./libs/core/src/index.ts'] } } }),
    'libs/react/src/index.ts': "'use client'; export * from './use-agent.js';",
    'libs/react/src/use-agent.ts': "export type { Agent } from '@threadplane/core';",
    'libs/core/src/index.ts': 'export interface Agent {}',
  });
  assert.deepEqual(verifyBoundaries({ root, projects: ['react'] }), []);
});

for (const extension of ['mjs', 'd.ts']) {
  test(`resolves legacy built main/module/types for Angular ${extension} dependencies`, (t) => {
    const files = {
      'dist/libs/chat/package.json': JSON.stringify({ name: '@threadplane/chat', exports: { '.': { types: './index.d.ts', default: './index.mjs' } } }),
      'dist/libs/chat/index.mjs': 'export {};',
      'dist/libs/chat/index.d.ts': 'export {};',
      [`dist/libs/chat/index.${extension}`]: "export * from '@threadplane/a2ui';",
      'dist/libs/a2ui/package.json': JSON.stringify({ name: '@threadplane/a2ui', types: './src/index.d.ts', module: './src/index.js', main: './src/index.js' }),
      'dist/libs/a2ui/src/index.js': 'export {};',
      'dist/libs/a2ui/src/index.d.ts': 'export {};',
    };
    const root = fixture(t, files);
    assert.deepEqual(verifyBoundaries({ root, mode: 'built', projects: ['chat'] }), []);
    // Following the legacy entry is mandatory, not just accepting the package
    // name: an indirect React edge must still fail in either output format.
    const entry = extension === 'd.ts' ? 'index.d.ts' : 'index.js';
    writeFileSync(join(root, 'dist/libs/a2ui/src', entry), "export * from 'react';");
    assert.ok(verifyBoundaries({ root, mode: 'built', projects: ['chat'] }).some((error) => error.includes('forbidden dependency') && error.includes('react')));
  });
}

for (const dependency of ['@angular/core', '@threadplane/chat', '@threadplane/telemetry', '@threadplane/render', 'react']) {
  test(`neutral runtime rejects transitive ${dependency} despite legacy visits`, (t) => {
    const root = fixture(t, {
      'libs/langgraph/src/public-api.ts': "export * from './lib/shared.js';",
      'libs/langgraph/src/lib/shared.ts': `export type { X } from '${dependency}';`,
      'libs/langgraph/src/runtime/transport.ts': "export type { X } from '../lib/shared.js';",
    });
    assert.ok(verifyBoundaries({ root, projects: ['langgraph'] }).some((error) => error.includes('neutral runtime') && error.includes(dependency)));
  });
}

test('neutral runtime permits public core and SDK but excludes private core and testing edges', (t) => {
  const root = fixture(t, {
    'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { '@threadplane/core': ['./libs/core/src/index.ts'] } } }),
    'libs/langgraph/src/public-api.ts': "export type { Signal } from '@angular/core';",
    'libs/langgraph/src/runtime/transport.ts': "export type { X } from '@threadplane/core'; export type { Client } from '@langchain/langgraph-sdk';",
    'libs/langgraph/src/runtime/testing/controlled.ts': 'export type T = string;',
    'libs/langgraph/src/runtime/transport.spec.ts': "import '@angular/core'; import './testing/controlled';",
    'libs/core/src/index.ts': 'export type X = string;',
    'libs/core/src/private.ts': 'export type X = string;',
  });
  assert.deepEqual(verifyBoundaries({ root, projects: ['langgraph'] }), []);
  for (const edge of ['../../../core/src/private.js', './testing/controlled.js', '@threadplane/core/private']) {
    writeFileSync(join(root, 'libs/langgraph/src/runtime/transport.ts'), `export type { X } from '${edge}';`);
    assert.ok(verifyBoundaries({ root, projects: ['langgraph'] }).some((error) => error.includes('neutral runtime') && error.includes(edge)));
  }
});

for (const dependency of ['@langchain/langgraph-sdk/react', '@langchain/langgraph-sdk/react-ui', '@langchain/langgraph-sdk/react-ui/server']) {
  test(`strict transport source root rejects ${dependency}`, (t) => {
    const root = fixture(t, {
      'libs/langgraph/src/public-api.ts': "export * from './lib/transport/fetch-stream.transport.js';",
      'libs/langgraph/src/lib/transport/fetch-stream.transport.ts': `export type { X } from '${dependency}';`,
    });
    assert.ok(verifyBoundaries({ root, projects: ['langgraph'] }).some((error) => error.includes('neutral runtime') && error.includes(dependency)));
  });
}
