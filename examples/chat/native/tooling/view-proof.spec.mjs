import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hash } from './retained-build.mjs';
import { readViewProof } from './view-proof.mjs';

function fixture(t, framework) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-view-record-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const angular = framework === 'angular';
  const entry = 'view-proof/entry.' + (angular ? 'ts' : 'tsx');
  const app = angular ? 'angular/src/app.component.ts' : 'react/src/app.tsx';
  const compiler = 'node_modules/typescript/bin/tsc';
  const ngc = 'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js';
  const bundler = angular
    ? 'node_modules/@angular/cli/bin/ng.js'
    : 'node_modules/vite/bin/vite.js';
  const tools = angular
    ? ['typescript', '@angular/compiler-cli', '@angular/cli', '@angular/build']
    : ['typescript', 'vite'];
  const packages = [
    ...tools,
    ...(angular
      ? ['@angular/core', '@angular/platform-browser']
      : ['react', 'react-dom']),
    '@langchain/langgraph-sdk',
    '@threadplane/core',
    '@threadplane/content',
    '@threadplane/langgraph',
    '@threadplane/' + framework,
  ];
  const runtime = [
    entry,
    'view-proof/view-owner.ts',
    app,
    'shared/application.ts',
    'shared/message-content.ts',
    'node_modules/@threadplane/langgraph/runtime/create-session.js',
    'node_modules/@threadplane/content/src/markdown/create-markdown.js',
    ...(angular
      ? [
          'angular/src/application.token.ts',
          ...[
            'threadplane-angular',
            'threadplane-angular-markdown',
            'threadplane-angular-chat',
          ].map(
            (n) => 'node_modules/@threadplane/angular/fesm2022/' + n + '.mjs'
          ),
        ]
      : [
          'use-agent.js',
          'markdown/markdown.js',
          'chat/tool-observation.js',
        ].map((n) => 'node_modules/@threadplane/react/src/' + n)),
  ];
  const types = [
    ...runtime.filter((p) => !p.endsWith('.js') && !p.endsWith('.mjs')),
    'node_modules/@threadplane/langgraph/runtime/create-session.d.ts',
    'node_modules/@threadplane/content/src/markdown/create-markdown.d.ts',
    ...(angular
      ? [
          'threadplane-angular',
          'threadplane-angular-markdown',
          'threadplane-angular-chat',
        ].map((n) => 'node_modules/@threadplane/angular/types/' + n + '.d.ts')
      : []),
  ];
  const configs = ['view-proof/tsconfig.json', framework + '/tsconfig.json'];
  const buildConfig =
    'view-proof/' + (angular ? 'angular.json' : 'vite.config.mjs');
  const bytes = Object.fromEntries(
    [
      ...new Set([
        ...runtime,
        ...types,
        compiler,
        bundler,
        ...(angular ? [ngc] : []),
        ...configs,
        buildConfig,
        'view-proof/index.html',
      ]),
    ].map((p) => [p, p])
  );
  bytes['view-proof/tsconfig.json'] = JSON.stringify({
    extends: '../' + framework + '/tsconfig.json',
    compilerOptions: { noEmit: true },
    files: ['entry.' + (angular ? 'ts' : 'tsx')],
  });
  bytes[framework + '/tsconfig.json'] = readFileSync(
    new URL('../' + framework + '/tsconfig.json', import.meta.url),
    'utf8'
  );
  if (angular)
    bytes[buildConfig] = JSON.stringify({
      version: 1,
      cli: { analytics: false, packageManager: 'npm' },
      projects: {
        'native-view-proof': {
          projectType: 'application',
          root: '',
          architect: {
            build: {
              builder: '@angular/build:application',
              options: {
                browser: 'entry.ts',
                index: 'index.html',
                tsConfig: 'tsconfig.json',
                outputPath: 'output',
                styles: ['../angular/src/styles.css'],
                statsJson: true,
                optimization: true,
                outputHashing: 'all',
                sourceMap: false,
              },
            },
          },
        },
      },
    });
  for (const p of packages)
    bytes['node_modules/' + p + '/package.json'] = JSON.stringify({
      name: p,
      version: '1.0.0',
    });
  const inputs = Object.fromEntries(
    Object.entries(bytes).map(([p, b]) => [p, hash(b)])
  );
  const record = {
    version: 2,
    framework,
    entry,
    source: {
      path:
        'examples/chat/native/tooling/view-entry.' +
        (angular ? 'angular.ts' : 'tsx'),
      sha256: inputs[entry],
    },
    helper: {
      path: 'examples/chat/native/tooling/view-owner.ts',
      sha256: inputs['view-proof/view-owner.ts'],
    },
    compiler: {
      executable: compiler,
      executableSha256: inputs[compiler],
      inputs: types,
      configurations: Object.fromEntries(configs.map((p) => [p, inputs[p]])),
      ...(angular
        ? {
            angular: {
              executable: ngc,
              executableSha256: inputs[ngc],
              strictTemplates: true,
            },
          }
        : {}),
    },
    bundler: {
      executable: bundler,
      executableSha256: inputs[bundler],
      configurations: { [buildConfig]: inputs[buildConfig] },
      ...(angular
        ? {
            virtualInputs: {
              'angular:styles/global:styles': { bytes: 1, imports: [] },
            },
          }
        : {}),
    },
    packages: Object.fromEntries(packages.map((p) => [p, '1.0.0'])),
    tools: Object.fromEntries(
      tools.map((p) => [
        'node_modules/' + p + '/package.json',
        inputs['node_modules/' + p + '/package.json'],
      ])
    ),
    runtime,
    inputs,
    outputs: { 'index.html': hash('checked HTML') },
  };
  for (const [p, b] of Object.entries(bytes)) {
    mkdirSync(dirname(join(root, 'inputs', p)), { recursive: true });
    writeFileSync(join(root, 'inputs', p), b);
  }
  mkdirSync(join(root, 'output'));
  writeFileSync(join(root, 'output/index.html'), 'checked HTML');
  const save = () =>
    writeFileSync(join(root, 'view.json'), JSON.stringify(record));
  save();
  return { root, record, save };
}

for (const [name, path, change] of [
  [
    'non-strict authored types',
    'angular/tsconfig.json',
    (c) => (c.compilerOptions.strict = false),
  ],
  [
    'skipped library checks',
    'angular/tsconfig.json',
    (c) => (c.compilerOptions.skipLibCheck = true),
  ],
  [
    'non-strict templates',
    'angular/tsconfig.json',
    (c) => (c.angularCompilerOptions.strictTemplates = false),
  ],
  [
    'production proof entry',
    'view-proof/tsconfig.json',
    (c) => (c.files = ['../angular/src/main.ts']),
  ],
  [
    'uncompiled builder',
    'view-proof/angular.json',
    (c) =>
      (c.projects['native-view-proof'].architect.build.builder = 'vite:build'),
  ],
])
  test('Angular rejects ' + name + ' with self-consistent byte hashes', (t) => {
    const f = fixture(t, 'angular');
    const p = join(f.root, 'inputs', path),
      c = JSON.parse(readFileSync(p));
    change(c);
    const bytes = JSON.stringify(c);
    writeFileSync(p, bytes);
    f.record.inputs[path] = hash(bytes);
    for (const mapping of [
      f.record.compiler.configurations,
      f.record.bundler.configurations,
    ])
      if (mapping[path]) mapping[path] = hash(bytes);
    f.save();
    assert.throws(() => readViewProof(f.root));
  });

for (const framework of ['react', 'angular']) {
  test(`${framework} rejects an unclaimed input even with matching retained bytes`, (t) => {
    const f = fixture(t, framework),
      path = 'shared/unclaimed.ts',
      bytes = 'unclaimed source';
    writeFileSync(join(f.root, 'inputs', path), bytes);
    f.record.inputs[path] = hash(bytes);
    f.save();
    assert.throws(() => readViewProof(f.root), /input inventory/);
  });
  test(`${framework} selected view reads immutable checked buffers`, (t) => {
    const f = fixture(t, framework);
    const checked = readViewProof(f.root);
    assert.equal(checked.framework, framework);
    checked.readOutput('index.html').fill(0);
    assert.equal(checked.readOutput('index.html').toString(), 'checked HTML');
    writeFileSync(join(f.root, 'output/index.html'), 'changed');
    assert.equal(checked.readOutput('index.html').toString(), 'checked HTML');
    assert.throws(() => readViewProof(f.root), /inventory/);
  });
  for (const [name, mutate] of [
    ['unknown framework', (r) => (r.framework = 'vue')],
    ['missing framework', (r) => delete r.framework],
    [
      'opposite framework',
      (r) => (r.framework = framework === 'react' ? 'angular' : 'react'),
    ],
    [
      'wrong compiler',
      (r) => (r.compiler.executable = 'node_modules/fake/tsc'),
    ],
    ['missing compiler config', (r) => (r.compiler.configurations = {})],
    ['missing builder config', (r) => (r.bundler.configurations = {})],
    [
      'wrong builder',
      (r) => (r.bundler.executable = 'node_modules/fake/build'),
    ],
    [
      'missing installed package',
      (r) => delete r.packages['@threadplane/content'],
    ],
    [
      'opposite local package',
      (r) =>
        (r.packages[
          '@threadplane/' + (framework === 'react' ? 'angular' : 'react')
        ] = '1'),
    ],
    [
      'missing owner runtime',
      (r) =>
        (r.runtime = r.runtime.filter((p) => p !== 'shared/application.ts')),
    ],
    [
      'missing SDK runtime',
      (r) =>
        (r.runtime = r.runtime.filter(
          (p) => !p.endsWith('runtime/create-session.js')
        )),
    ],
    [
      'production bootstrap',
      (r) =>
        r.runtime.push(
          framework + '/src/main.' + (framework === 'react' ? 'tsx' : 'ts')
        ),
    ],
    ['unsafe input', (r) => (r.inputs['../escape'] = hash('x'))],
    [
      'unknown proof input',
      (r) => (r.inputs['view-proof/unknown.ts'] = hash('x')),
    ],
    [
      'wrong source',
      (r) => (r.source.path = 'examples/chat/native/tooling/other.ts'),
    ],
    ['missing helper', (r) => delete r.inputs['view-proof/view-owner.ts']],
  ])
    test(`${framework} rejects ${name}`, (t) => {
      const f = fixture(t, framework);
      mutate(f.record);
      f.save();
      assert.throws(() => readViewProof(f.root));
    });
}
for (const [name, mutate] of [
  [
    'wrong ngc',
    (r) => (r.compiler.angular.executable = 'node_modules/typescript/bin/tsc'),
  ],
  ['no strict templates', (r) => (r.compiler.angular.strictTemplates = false)],
  [
    'unknown virtual input',
    (r) => (r.bundler.virtualInputs['angular:other'] = {}),
  ],
  [
    'missing APF composition',
    (r) =>
      (r.runtime = r.runtime.filter(
        (p) => !p.endsWith('threadplane-angular-markdown.mjs')
      )),
  ],
])
  test('Angular rejects ' + name, (t) => {
    const f = fixture(t, 'angular');
    mutate(f.record);
    f.save();
    assert.throws(() => readViewProof(f.root));
  });
