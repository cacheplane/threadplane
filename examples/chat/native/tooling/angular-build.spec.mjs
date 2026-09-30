import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import * as angular from './angular-build.mjs';

test('Angular composition requires real shared owner and selected installed types and runtime', () => {
  assert.equal(typeof angular.assertAngularComposition, 'function');
  const sources = [
    'angular/src/main.ts',
    'angular/src/app.component.ts',
    'shared/application.ts',
    'shared/message-content.ts',
  ];
  const modules = [
    '@threadplane/langgraph/runtime/create-session',
    '@threadplane/content/src/markdown/create-markdown',
    '@threadplane/content/src/messages/create-message-content',
  ];
  const entries = [
    'threadplane-angular',
    'threadplane-angular-markdown',
    'threadplane-angular-chat',
  ];
  const types = Object.fromEntries(
    [
      ...sources,
      ...modules.map((p) => 'node_modules/' + p + '.d.ts'),
      ...entries.map(
        (p) => 'node_modules/@threadplane/angular/types/' + p + '.d.ts'
      ),
    ].map((p) => [p, 'hash'])
  );
  const runtime = Object.fromEntries(
    [
      ...sources,
      ...modules.map((p) => 'node_modules/' + p + '.js'),
      ...entries.map(
        (p) => 'node_modules/@threadplane/angular/fesm2022/' + p + '.mjs'
      ),
    ].map((p) => [p, 'hash'])
  );
  angular.assertAngularComposition(types, runtime);
  for (const graph of ['types', 'runtime']) {
    const original = graph === 'types' ? types : runtime;
    for (const missing of Object.keys(original)) {
      const reduced = { ...original };
      delete reduced[missing];
      assert.throws(
        () =>
          angular.assertAngularComposition(
            graph === 'types' ? reduced : types,
            graph === 'runtime' ? reduced : runtime
          ),
        /required/i,
        missing
      );
    }
  }
});

test('only the exact Angular global style entry is classified as synthetic metadata', () => {
  assert.equal(typeof angular.angularStatsInputs, 'function');
  const entry = {
    bytes: 25,
    imports: [{ path: 'src/styles.css', kind: 'import-rule' }],
  };
  assert.deepEqual(
    angular.angularStatsInputs({
      inputs: { 'src/styles.css': {}, 'angular:styles/global:styles': entry },
    }),
    {
      files: ['src/styles.css'],
      virtual: { 'angular:styles/global:styles': entry },
    }
  );
  assert.deepEqual(
    angular.angularStatsInputs({
      inputs: { 'angular:styles/global:unknown': {} },
    }).files,
    ['angular:styles/global:unknown']
  );
});

test('Angular stats normalize workspace-relative inputs within the physical consumer', (t) => {
  assert.equal(typeof angular.angularInputHashes, 'function');
  const consumer = mkdtempSync(join(tmpdir(), 'angular-inputs-'));
  t.after(() => rmSync(consumer, { recursive: true, force: true }));
  for (const path of [
    'angular/src/main.ts',
    'shared/tokens.css',
    'node_modules/@angular/core/fesm2022/core.mjs',
  ]) {
    mkdirSync(dirname(join(consumer, path)), { recursive: true });
    writeFileSync(join(consumer, path), 'input');
  }
  const hashes = angular.angularInputHashes(
    consumer,
    join(consumer, 'angular'),
    [
      'src/main.ts',
      '../shared/tokens.css',
      '../node_modules/@angular/core/fesm2022/core.mjs',
    ]
  );
  assert.deepEqual(Object.keys(hashes), [
    'angular/src/main.ts',
    'shared/tokens.css',
    'node_modules/@angular/core/fesm2022/core.mjs',
  ]);
  assert.throws(
    () => angular.angularInputHashes(consumer, consumer, ['../escape.ts']),
    /outside consumer/i
  );
  symlinkSync(join(consumer, '..'), join(consumer, 'angular/escape'));
  assert.throws(
    () =>
      angular.angularInputHashes(consumer, join(consumer, 'angular'), [
        'escape',
      ]),
    /outside consumer/i
  );
  for (const path of [
    'react/src/app.tsx',
    'libs/angular/src/index.ts',
    'node_modules/react/index.js',
    'node_modules/@threadplane/chat/index.js',
    'node_modules/@threadplane/telemetry/index.js',
    'node_modules/@threadplane/render/index.js',
    'node_modules/@threadplane/langgraph/fesm2022/threadplane-langgraph.mjs',
    'node_modules/@threadplane/langgraph/types/threadplane-langgraph.d.ts',
    'node_modules/@threadplane/ag-ui/index.js',
  ])
    assert.throws(
      () => angular.angularInputHashes(consumer, consumer, [path]),
      /Forbidden Angular input/
    );
});
