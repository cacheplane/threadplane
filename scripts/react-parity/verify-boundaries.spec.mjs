import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { verifyBoundaries } from './verify-boundaries.mjs';

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
  ['backend UI import', 'langgraph-core', "export * from '@threadplane/react';"],
  ['AG-UI backend renderer import', 'ag-ui-core', "export * from '@threadplane/react-render';"],
  ['React Angular import', 'react', "export * from '@angular/core';"],
  ['React backend type import', 'react', "type X = import('@threadplane/langgraph-core').X; export type { X };"],
  ['Angular React import', 'chat', "export * from '@threadplane/react';"],
  ['core parser import', 'core', "export * from '@cacheplane/partial-markdown';"],
  ['core RxJS import', 'core', "export * from 'rxjs';"],
];
for (const [label, project, code] of sourceCases) {
  test(`rejects ${label}`, (t) => {
    const root = fixture(t, { [`libs/${project}/src/index.ts`]: code });
    assert.ok(verifyBoundaries({ root, projects: [project] }).length > 0);
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
test('allows optional Zod/testing entries without making them root dependencies', (t) => {
  const root = fixture(t, {
    'libs/core/src/index.ts': 'export {};',
    'libs/core/src/schema/zod/index.ts': "export type { ZodType } from 'zod';",
    'libs/core/src/testing/index.ts': 'export {};',
  });
  assert.deepEqual(verifyBoundaries({ root, projects: ['core'] }), []);
});
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
    'libs/langgraph-core/src/index.ts': 'export {};',
    'libs/langgraph-core/package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }),
  });
  assert.ok(verifyBoundaries({ root, projects: ['langgraph-core'] }).some((error) => error.includes('react')));
});

const builtCases = [
  ['core to Angular', 'core', '@angular/core'],
  ['core to React', 'core', 'react'],
  ['LangGraph backend to UI', 'langgraph-core', '@threadplane/react'],
  ['AG-UI backend to UI', 'ag-ui-core', '@threadplane/react-render'],
  ['backend to Angular UI', 'langgraph-core', '@threadplane/chat'],
  ['React to Angular', 'react', '@angular/core'],
  ['React to backend', 'react', '@threadplane/langgraph-core'],
  ['React renderer to backend', 'react-render', '@threadplane/ag-ui-core'],
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
      const errors = verifyBoundaries({ root, mode: 'built', projects: [project] });
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
      for (const name of ['core', 'content', 'langgraph-core', 'ag-ui-core', 'react-render', 'react', 'chat', 'langgraph', 'ag-ui', 'render']) {
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
