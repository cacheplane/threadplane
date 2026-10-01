import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import {
  captureRetainedBuild,
  readRetainedBuild,
  startRetainedServer,
} from './retained-build.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const negativeDeclarations = [
  'node_modules/@threadplane/angular/types/threadplane-angular-markdown.d.ts',
  'node_modules/@threadplane/content/src/markdown/index.d.ts',
];

test('import performs no build, installation, or server startup', () => {
  assert.equal(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(
          new URL('./retained-build.mjs', import.meta.url).href
        )}); console.log('imported');`,
      ],
      {
        encoding: 'utf8',
        timeout: 5000,
        env: { PATH: process.env.PATH, NATIVE_LANGGRAPH_URL: 'invalid' },
      }
    ).trim(),
    'imported'
  );
});
function put(root, path, bytes) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
  return hash(bytes);
}
function fixture(t, framework = 'react') {
  const base = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-retention-test-'))
  );
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'source'),
    temporary = join(base, 'temporary'),
    buildRoot = join(temporary, 'build'),
    consumer = join(temporary, 'consumer'),
    output = join(consumer, framework + '/dist');
  const entry =
    framework + '/src/main.' + (framework === 'react' ? 'tsx' : 'ts');
  const inputs = {
    ['examples/chat/native/' + entry]: put(
      root,
      'examples/chat/native/' + entry,
      'authored'
    ),
    'package-lock.json': put(root, 'package-lock.json', '{}'),
  };
  const buildInputs = {
    'package-lock.json': put(buildRoot, 'package-lock.json', '{}'),
  };
  const copied = {
    [entry]: put(consumer, entry, 'authored'),
    'shared/browser-config.json': put(
      consumer,
      'shared/browser-config.json',
      '{"assistantId":"","apiBase":"/api"}'
    ),
  };
  for (const name of [
    'tsconfig.json',
    'tsconfig.app.json',
    framework === 'react' ? 'vite.config.mts' : 'angular.json',
  ])
    copied[framework + '/' + name] = put(
      consumer,
      framework + '/' + name,
      '{}'
    );
  const tarballs = {},
    hashes = {},
    artifacts = {},
    dependencies = {},
    lockPackages = {};
  for (const name of ['core', 'content', framework, 'langgraph']) {
    const packageName = '@threadplane/' + name,
      file = join(temporary, name + '.tgz');
    hashes[packageName] = put(temporary, name + '.tgz', 'archive-' + name);
    tarballs[packageName] = 'file:' + file;
    dependencies[packageName] = tarballs[packageName];
    lockPackages['node_modules/' + packageName] = {
      resolved: tarballs[packageName],
    };
    artifacts[packageName] = [
      {
        path: 'index.js',
        sha256: put(
          consumer,
          'node_modules/' + packageName + '/index.js',
          'runtime-' + name
        ),
      },
    ];
  }
  put(consumer, 'package.json', JSON.stringify({ dependencies }));
  const derivedLockSha256 = put(
    consumer,
    'package-lock.json',
    JSON.stringify({ packages: { '': { dependencies }, ...lockPackages } })
  );
  const executable = 'node_modules/typescript/bin/tsc';
  const executableSha256 = put(consumer, executable, 'compiler');
  put(consumer, 'node_modules/typescript/package.json', '{"version":"1"}');
  for (const name of framework === 'react'
    ? ['vite']
    : ['@angular/compiler-cli', '@angular/cli', '@angular/build'])
    put(
      consumer,
      'node_modules/' + name + '/package.json',
      JSON.stringify({ name, version: '1' })
    );
  const bundlerExecutable =
    framework === 'react'
      ? 'node_modules/vite/bin/vite.js'
      : 'node_modules/@angular/cli/bin/ng.js';
  const bundlerHash = put(consumer, bundlerExecutable, 'bundler');
  const compilation = {
    executable,
    executableSha256,
    inputs: {
      [entry]: copied[entry],
      'node_modules/vendor/index.d.ts': put(
        consumer,
        'node_modules/vendor/index.d.ts',
        'type'
      ),
    },
  };
  if (framework === 'angular') {
    const declarations = Object.fromEntries(
      negativeDeclarations.map((path) => {
        const name = path.split('/').slice(1, 3).join('/');
        const sha256 = put(consumer, path, 'installed declaration: ' + path);
        artifacts[name].push({
          path: path.slice(('node_modules/' + name + '/').length),
          sha256,
        });
        return [path, sha256];
      })
    );
    Object.assign(compilation.inputs, declarations);
    const ngc = 'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js';
    compilation.configurations = Object.fromEntries(
      ['tsconfig.json', 'tsconfig.app.json'].map((name) => [
        'angular/' + name,
        copied['angular/' + name],
      ])
    );
    compilation.angular = {
      executable: ngc,
      executableSha256: put(consumer, ngc, 'template compiler'),
      strictTemplates: true,
      negatives: {},
    };
    for (const kind of ['wrong', 'missing']) {
      const source = `import { Component } from '@angular/core';\nimport { MarkdownComponent } from '@threadplane/angular/markdown';\n@Component({selector:'negative-host',standalone:true,imports:[MarkdownComponent],template: \`<threadplane-markdown ${
        kind === 'wrong' ? '[snapshot]="value"' : ''
      } />\`})\nexport class NegativeHost { readonly value = 'not a snapshot'; }\n`;
      const configuration =
        JSON.stringify(
          {
            extends: './tsconfig.json',
            compilerOptions: { noEmit: true },
            files: [`__snapshot-negative-${kind}.ts`],
          },
          null,
          2
        ) + '\n';
      const code = kind === 'wrong' ? 'TS2322' : 'NG8008';
      compilation.angular.negatives[kind] = {
        code,
        expectedType: 'MarkdownSnapshot',
        source,
        sourceSha256: hash(source),
        configuration,
        configurationSha256: hash(configuration),
        inputs: {
          ...declarations,
          [`angular/__snapshot-negative-${kind}.ts`]: hash(source),
          'node_modules/vendor/negative.d.ts': put(
            consumer,
            'node_modules/vendor/negative.d.ts',
            'negative dependency'
          ),
        },
        diagnostic:
          kind === 'wrong'
            ? "__snapshot-negative-wrong.ts: error TS2322: Type 'string' is not assignable to type 'MarkdownSnapshot'."
            : "__snapshot-negative-missing.ts: error NG8008: Required input 'snapshot' from component MarkdownComponent must be specified.",
        restored: true,
      };
    }
  }
  const bundle = {
    output,
    inputs: {
      [entry]: copied[entry],
      'node_modules/vendor/index.js': put(
        consumer,
        'node_modules/vendor/index.js',
        'runtime'
      ),
    },
  };
  for (const [map, extension] of [
    [compilation.inputs, '.d.ts'],
    [bundle.inputs, '.js'],
  ]) {
    const local = 'src/messages/create-message-content' + extension;
    const path = 'node_modules/@threadplane/content/' + local;
    const sha256 = put(consumer, path, 'installed projection: ' + extension);
    map[path] = sha256;
    artifacts['@threadplane/content'].push({ path: local, sha256 });
    if (framework === 'react') {
      const render = 'src/render/render-spec' + extension;
      const renderPath = 'node_modules/@threadplane/react/' + render;
      const renderHash = put(
        consumer,
        renderPath,
        'installed RenderSpec: ' + extension
      );
      map[renderPath] = renderHash;
      artifacts['@threadplane/react'].push({
        path: render,
        sha256: renderHash,
      });
      for (const name of [
        'message-list',
        'reasoning',
        'approval-card',
        'message-actions',
        'citations',
      ]) {
        const local = 'src/chat/' + name + extension;
        const path = 'node_modules/@threadplane/react/' + local;
        const sha256 = put(
          consumer,
          path,
          'installed MessageList: ' + extension
        );
        map[path] = sha256;
        artifacts['@threadplane/react'].push({ path: local, sha256 });
      }
    }
  }
  const outputs = {
    'index.html': put(
      output,
      'index.html',
      '<script src="/assets/main.js"></script>'
    ),
    'assets/main.js': put(output, 'assets/main.js', 'console.log("app")'),
    'build-inputs.json': put(output, 'build-inputs.json', '[]'),
  };
  if (framework === 'angular')
    outputs['stats.json'] = put(output, 'stats.json', '{"inputs":{}}');
  for (const files of Object.values(artifacts))
    files.sort((a, b) => a.path.localeCompare(b.path));
  const installation = { artifacts, derivedLockSha256 };
  const provenance = {
    framework,
    configuration: 'production',
    inputs,
    buildInputs,
    copied,
    packages: hashes,
    installation,
    compiler: compilation,
    bundler: {
      inputs: bundle.inputs,
      ...(framework === 'angular'
        ? {
            executable: bundlerExecutable,
            executableSha256: bundlerHash,
            configuration: {
              'angular/angular.json': copied['angular/angular.json'],
            },
            virtualInputs: { 'angular:styles/global:styles': { bytes: 1 } },
          }
        : {}),
    },
    outputs,
  };
  return {
    framework,
    base,
    directory: join(base, 'retained'),
    root,
    temporary,
    buildRoot,
    consumer,
    compilation,
    bundle,
    installation,
    packages: { tarballs, hashes },
    provenance,
  };
}

test('retains actual bytes and original lock, verifies after original temporary cleanup, and returns copy-on-read assets', (t) => {
  const f = fixture(t),
    originalLock = readFileSync(join(f.consumer, 'package-lock.json'));
  captureRetainedBuild(f.directory, f);
  rmSync(f.temporary, { recursive: true });
  rmSync(f.root, { recursive: true });
  const retained = readRetainedBuild(f.directory);
  assert.deepEqual(
    readFileSync(join(f.directory, 'consumer/package-lock.json')),
    originalLock
  );
  assert.equal(
    retained.readOutput('assets/main.js').toString(),
    'console.log("app")'
  );
  retained.readOutput('assets/main.js').fill(0);
  writeFileSync(join(f.directory, 'output/assets/main.js'), 'after validation');
  assert.equal(
    retained.readOutput('assets/main.js').toString(),
    'console.log("app")'
  );
  assert.equal(retained.readOutput('../consumer/package.json'), undefined);
  assert.ok(Object.isFrozen(retained));
});

for (const framework of ['react', 'angular'])
  for (const [graph, extension] of [
    ['compiler', '.d.ts'],
    ['bundler', '.js'],
  ])
    test(`${framework} retention requires installed message projection ${graph}`, (t) => {
      const f = fixture(t, framework);
      delete f.provenance[graph].inputs[
        'node_modules/@threadplane/content/src/messages/create-message-content' +
          extension
      ];
      assert.throws(
        () => captureRetainedBuild(f.directory, f),
        /message projection/i
      );
    });

for (const [graph, extension] of [
  ['compiler', '.d.ts'],
  ['bundler', '.js'],
])
  test(`React retention requires installed MessageList ${graph}`, (t) => {
    const f = fixture(t, 'react');
    delete f.provenance[graph].inputs[
      'node_modules/@threadplane/react/src/chat/message-list' + extension
    ];
    assert.throws(() => captureRetainedBuild(f.directory, f), /MessageList/);
  });

for (const [graph, extension] of [
  ['compiler', '.d.ts'],
  ['bundler', '.js'],
])
  test(`React retention requires installed ApprovalCard ${graph}`, (t) => {
    const f = fixture(t, 'react');
    delete f.provenance[graph].inputs[
      'node_modules/@threadplane/react/src/chat/approval-card' + extension
    ];
    assert.throws(() => captureRetainedBuild(f.directory, f), /ApprovalCard/);
  });

for (const [graph, extension] of [
  ['compiler', '.d.ts'],
  ['bundler', '.js'],
])
  test(`React retention requires installed MessageActions ${graph}`, (t) => {
    const f = fixture(t, 'react');
    delete f.provenance[graph].inputs[
      'node_modules/@threadplane/react/src/chat/message-actions' + extension
    ];
    assert.throws(() => captureRetainedBuild(f.directory, f), /MessageActions/);
  });

for (const [graph, extension] of [
  ['compiler', '.d.ts'],
  ['bundler', '.js'],
])
  test(`React retention requires installed RenderSpec ${graph}`, (t) => {
    const f = fixture(t, 'react');
    delete f.provenance[graph].inputs[
      'node_modules/@threadplane/react/src/render/render-spec' + extension
    ];
    assert.throws(() => captureRetainedBuild(f.directory, f), /RenderSpec/);
  });

for (const [graph, extension] of [
  ['compiler', '.d.ts'],
  ['bundler', '.js'],
])
  test(`React retention requires installed Citations ${graph}`, (t) => {
    const f = fixture(t, 'react');
    delete f.provenance[graph].inputs[
      'node_modules/@threadplane/react/src/chat/citations' + extension
    ];
    assert.throws(() => captureRetainedBuild(f.directory, f), /Citations/);
  });

for (const framework of ['react', 'angular']) {
  if (framework === 'react')
    for (const [graph, extension] of [
      ['compiler', '.d.ts'],
      ['bundler', '.js'],
    ]) {
      test(`React retention requires installed Reasoning ${graph}`, (t) => {
        const f = fixture(t, 'react');
        delete f.provenance[graph].inputs[
          'node_modules/@threadplane/react/src/chat/reasoning' + extension
        ];
        assert.throws(() => captureRetainedBuild(f.directory, f), /Reasoning/);
      });
    }
  test(`retains closed ${framework} tool/configuration graph and embedded negative evidence after source cleanup`, (t) => {
    const f = fixture(t, framework);
    captureRetainedBuild(f.directory, f);
    const record = JSON.parse(readFileSync(join(f.directory, 'retained.json')));
    assert.equal(record.version, 2);
    assert.equal(record.framework, framework);
    const selected =
      framework === 'angular'
        ? [
            'typescript',
            '@angular/compiler-cli',
            '@angular/cli',
            '@angular/build',
          ]
        : ['typescript', 'vite'];
    for (const name of selected)
      assert.ok(record.tools['node_modules/' + name + '/package.json']);
    if (framework === 'angular') {
      assert.ok(
        existsSync(
          join(f.directory, 'consumer/node_modules/vendor/negative.d.ts')
        )
      );
      for (const kind of ['wrong', 'missing']) {
        assert.equal(
          existsSync(
            join(f.directory, `consumer/angular/__snapshot-negative-${kind}.ts`)
          ),
          false
        );
        assert.equal(
          existsSync(
            join(f.directory, `consumer/angular/tsconfig.negative-${kind}.json`)
          ),
          false
        );
        assert.equal(
          record.provenance.compiler.angular.negatives[kind].sourceSha256,
          hash(record.provenance.compiler.angular.negatives[kind].source)
        );
      }
    }
    rmSync(f.temporary, { recursive: true });
    rmSync(f.root, { recursive: true });
    const retained = readRetainedBuild(f.directory);
    assert.equal(retained.framework, framework);
    assert.ok(Object.isFrozen(retained));
    assert.equal(
      retained.readOutput('index.html').toString(),
      '<script src="/assets/main.js"></script>'
    );
  });

  for (const mutation of [
    'unknown framework',
    'mismatched framework',
    'missing framework',
    'opposite source',
    'opposite copied',
    'opposite runtime',
    'wrong compiler',
    'opposite tool',
    'missing tool',
    'wrong config',
    'wrong locals',
    'missing runtime entry',
    'opposite compiler config',
  ])
    test(`${framework} refuses selected-record mismatch: ${mutation}`, (t) => {
      const f = fixture(t, framework);
      captureRetainedBuild(f.directory, f);
      const path = join(f.directory, 'retained.json');
      const record = JSON.parse(readFileSync(path));
      const opposite = framework === 'angular' ? 'react' : 'angular';
      if (mutation === 'unknown framework') record.framework = 'vue';
      if (mutation === 'mismatched framework')
        record.provenance.framework = opposite;
      if (mutation === 'missing framework') delete record.provenance.framework;
      if (mutation === 'opposite source')
        record.provenance.inputs[`libs/${opposite}/src/index.ts`] = put(
          f.directory,
          `source/libs/${opposite}/src/index.ts`,
          'wrong'
        );
      if (mutation === 'opposite copied')
        record.provenance.copied[`${opposite}/src/main.ts`] = put(
          f.directory,
          `consumer/${opposite}/src/main.ts`,
          'wrong'
        );
      if (mutation === 'opposite runtime')
        record.provenance.bundler.inputs[
          `node_modules/@threadplane/${opposite}/index.js`
        ] = put(
          f.directory,
          `consumer/node_modules/@threadplane/${opposite}/index.js`,
          'wrong'
        );
      if (mutation === 'wrong compiler') {
        const key = 'node_modules/typescript/bin/not-tsc';
        record.provenance.compiler.executable = key;
        record.provenance.compiler.executableSha256 = put(
          f.directory,
          'consumer/' + key,
          'compiler'
        );
      }
      if (mutation === 'opposite tool') {
        const key =
          framework === 'angular'
            ? 'node_modules/vite/package.json'
            : 'node_modules/@angular/cli/package.json';
        record.tools[key] = put(f.directory, 'consumer/' + key, '{}');
      }
      if (mutation === 'missing tool') {
        const key = 'node_modules/typescript/package.json';
        delete record.tools[key];
        rmSync(join(f.directory, 'consumer', key));
      }
      if (mutation === 'wrong config') {
        const key = framework + '/tsconfig.app.json';
        delete record.provenance.copied[key];
        rmSync(join(f.directory, 'consumer', key));
        if (record.provenance.compiler.configurations)
          delete record.provenance.compiler.configurations[key];
      }
      if (mutation === 'wrong locals') {
        record.provenance.packages['@threadplane/' + opposite] =
          record.provenance.packages['@threadplane/' + framework];
        delete record.provenance.packages['@threadplane/' + framework];
      }
      if (mutation === 'missing runtime entry')
        delete record.provenance.bundler.inputs[
          framework + '/src/main.' + (framework === 'react' ? 'tsx' : 'ts')
        ];
      if (mutation === 'opposite compiler config')
        record.provenance.compiler.configurations = {
          [opposite + '/tsconfig.app.json']: hash('{}'),
        };
      writeFileSync(path, JSON.stringify(record));
      assert.throws(
        () => readRetainedBuild(f.directory),
        /framework|selected|compiler|tool|config|local|artifact/i
      );
    });
}

for (const kind of ['wrong', 'missing'])
  for (const declaration of negativeDeclarations)
    test(`Angular ${kind} negative requires its own declaration evidence: ${declaration}`, (t) => {
      const f = fixture(t, 'angular');
      captureRetainedBuild(f.directory, f);
      const path = join(f.directory, 'retained.json');
      const record = JSON.parse(readFileSync(path));
      assert.ok(record.provenance.compiler.inputs[declaration]);
      assert.ok(existsSync(join(f.directory, 'consumer', declaration)));
      delete record.provenance.compiler.angular.negatives[kind].inputs[
        declaration
      ];
      writeFileSync(path, JSON.stringify(record));
      assert.throws(
        () => readRetainedBuild(f.directory),
        /negative.*declaration/i
      );
    });

for (const mutation of [
  'ngc executable',
  'CLI executable',
  'compiler config',
  'CLI config',
  'unknown virtual',
  'negative source',
  'negative config',
  'negative input',
  'negative code',
  'negative restored',
  'negative diagnostic',
  'negative extra kind',
  'unknown local dependency',
])
  test(`Angular rejects inconsistent compiler evidence: ${mutation}`, (t) => {
    const f = fixture(t, 'angular');
    captureRetainedBuild(f.directory, f);
    const path = join(f.directory, 'retained.json'),
      record = JSON.parse(readFileSync(path)),
      p = record.provenance,
      n = p.compiler.angular.negatives.wrong;
    if (mutation === 'ngc executable')
      p.compiler.angular.executable = 'node_modules/typescript/bin/tsc';
    if (mutation === 'CLI executable')
      p.bundler.executable = 'node_modules/@angular/build/package.json';
    if (mutation === 'compiler config')
      p.compiler.configurations = { 'angular/tsconfig.other.json': hash('{}') };
    if (mutation === 'CLI config')
      p.bundler.configuration = { 'angular/tsconfig.json': hash('{}') };
    if (mutation === 'unknown virtual')
      p.bundler.virtualInputs['angular:unknown'] = {};
    if (mutation === 'negative source') {
      n.source = 'not a decorated host';
      n.sourceSha256 = hash(n.source);
      n.inputs['angular/__snapshot-negative-wrong.ts'] = n.sourceSha256;
    }
    if (mutation === 'negative config') {
      n.configuration = '{}';
      n.configurationSha256 = hash(n.configuration);
    }
    if (mutation === 'negative input') {
      delete n.inputs['angular/__snapshot-negative-wrong.ts'];
      n.inputs['angular/other-removed.ts'] = hash('missing');
    }
    if (mutation === 'negative code') n.code = 'TS2307';
    if (mutation === 'negative restored') n.restored = false;
    if (mutation === 'negative diagnostic')
      n.diagnostic = 'Cannot find module TS2307';
    if (mutation === 'negative extra kind')
      p.compiler.angular.negatives.other = n;
    if (mutation === 'unknown local dependency') {
      const key = 'node_modules/@threadplane/unknown/index.js';
      p.bundler.inputs[key] = put(f.directory, 'consumer/' + key, 'unknown');
    }
    writeFileSync(path, JSON.stringify(record));
    assert.throws(() => readRetainedBuild(f.directory));
  });

for (const path of [
  'consumer/node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js',
  'consumer/node_modules/@angular/cli/bin/ng.js',
  'consumer/node_modules/@angular/build/package.json',
  'consumer/angular/angular.json',
  'consumer/node_modules/vendor/negative.d.ts',
  'archives/angular.tgz',
  'output/stats.json',
])
  test(`Angular rejects retained byte drift: ${path}`, (t) => {
    const f = fixture(t, 'angular');
    captureRetainedBuild(f.directory, f);
    writeFileSync(join(f.directory, path), 'drift');
    assert.throws(
      () => readRetainedBuild(f.directory),
      /hash|bytes|inventory/i
    );
  });

test('capture rejects framework/context disagreement and discards only its new directory', (t) => {
  const f = fixture(t);
  f.framework = 'angular';
  assert.throws(() => captureRetainedBuild(f.directory, f), /framework/i);
  assert.equal(existsSync(f.directory), false);
});

test('Angular tool capture inventories package-owned files without following nested npm dependency bins', (t) => {
  const f = fixture(t, 'angular');
  const dependency = 'node_modules/@angular/cli/node_modules/nested/index.js';
  put(f.consumer, dependency, 'nested dependency');
  const bin = join(f.consumer, 'node_modules/@angular/cli/node_modules/.bin');
  mkdirSync(bin);
  symlinkSync('../nested/index.js', join(bin, 'nested'));
  captureRetainedBuild(f.directory, f);
  const record = JSON.parse(readFileSync(join(f.directory, 'retained.json')));
  assert.equal(
    Object.keys(record.tools).some(
      (path) => path.includes('/node_modules/.bin/') || path === dependency
    ),
    false
  );
  assert.equal(existsSync(join(f.directory, 'consumer', dependency)), false);
  assert.equal(readRetainedBuild(f.directory).framework, 'angular');
});

test('Angular tool capture still rejects symlinks in package-owned files and cleans its target', (t) => {
  const f = fixture(t, 'angular');
  symlinkSync(
    join(f.consumer, 'node_modules/typescript/bin/tsc'),
    join(f.consumer, 'node_modules/@angular/cli/owned-link')
  );
  assert.throws(() => captureRetainedBuild(f.directory, f), /symlink/i);
  assert.equal(existsSync(f.directory), false);
});

test('tool package inventory preserves regular files with object-property names', (t) => {
  const f = fixture(t, 'angular');
  const key = 'node_modules/@angular/cli/__proto__';
  const digest = put(f.consumer, key, 'regular package file');
  captureRetainedBuild(f.directory, f);
  const record = JSON.parse(readFileSync(join(f.directory, 'retained.json')));
  assert.equal(record.tools[key], digest);
  assert.equal(
    readFileSync(join(f.directory, 'consumer', key), 'utf8'),
    'regular package file'
  );
});

for (const path of [
  'source/examples/chat/native/react/src/main.tsx',
  'source/package-lock.json',
  'build-inputs/package-lock.json',
  'consumer/shared/browser-config.json',
  'archives/core.tgz',
  'consumer/node_modules/vendor/index.d.ts',
  'consumer/node_modules/@threadplane/react/index.js',
  'consumer/package-lock.json',
  'output/assets/main.js',
])
  test(`rejects retained byte drift: ${path}`, (t) => {
    const f = fixture(t);
    captureRetainedBuild(f.directory, f);
    writeFileSync(join(f.directory, path), 'tampered');
    assert.throws(
      () => readRetainedBuild(f.directory),
      /hash|bytes|inventory/i
    );
  });

for (const mutation of [
  'missing chunk',
  'unexpected output',
  'unexpected source',
  'unexpected root property',
  'symlink file',
  'symlink parent',
  'unsafe record',
  'output hash mismatch',
])
  test(`rejects ${mutation} before exposing any retained output`, (t) => {
    const f = fixture(t);
    captureRetainedBuild(f.directory, f);
    if (mutation === 'missing chunk')
      rmSync(join(f.directory, 'output/assets/main.js'));
    if (mutation === 'unexpected output')
      put(f.directory, 'output/secret.txt', 'secret');
    if (mutation === 'unexpected source')
      put(f.directory, 'source/new.ts', 'new');
    if (mutation === 'unexpected root property')
      put(f.directory, '__proto__', 'unexpected');
    if (mutation === 'symlink file') {
      rmSync(join(f.directory, 'output/assets/main.js'));
      symlinkSync(
        join(f.root, 'examples/chat/native/react/src/main.tsx'),
        join(f.directory, 'output/assets/main.js')
      );
    }
    if (mutation === 'symlink parent') {
      rmSync(join(f.directory, 'output/assets'), { recursive: true });
      symlinkSync(f.root, join(f.directory, 'output/assets'));
    }
    if (mutation === 'unsafe record' || mutation === 'output hash mismatch') {
      const path = join(f.directory, 'retained.json'),
        record = JSON.parse(readFileSync(path));
      record.provenance.outputs[
        mutation === 'unsafe record' ? '../outside' : 'assets/main.js'
      ] = hash('bad');
      writeFileSync(path, JSON.stringify(record));
    }
    assert.throws(() => readRetainedBuild(f.directory));
  });

test('requires a new target and failed capture cleans only its own new target', (t) => {
  const f = fixture(t);
  mkdirSync(f.directory);
  put(f.directory, 'keep', 'owner');
  assert.throws(() => captureRetainedBuild(f.directory, f), /exist/i);
  assert.equal(readFileSync(join(f.directory, 'keep'), 'utf8'), 'owner');
  const failed = join(f.base, 'failed');
  writeFileSync(
    join(f.consumer, 'node_modules/@threadplane/react/index.js'),
    'drift'
  );
  assert.throws(() => captureRetainedBuild(failed, f));
  assert.equal(existsSync(failed), false);
});

test('capture rejects symlink target ancestors and archive paths outside the owned preparation', (t) => {
  const f = fixture(t);
  symlinkSync(f.base, join(f.base, 'alias'));
  assert.throws(
    () => captureRetainedBuild(join(f.base, 'alias/retained'), f),
    /link/i
  );
  const outside = join(f.base, 'outside.tgz');
  writeFileSync(outside, 'archive-core');
  f.packages.tarballs['@threadplane/core'] = 'file:' + outside;
  assert.throws(
    () => captureRetainedBuild(f.directory, f),
    /outside|escape|confined/i
  );
  assert.equal(existsSync(f.directory), false);
});

function request(url, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { path, method }, (res) => {
      const bytes = [];
      res.on('data', (b) => bytes.push(b));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          bytes: Buffer.concat(bytes),
          headers: res.headers,
        })
      );
    });
    req.on('error', reject);
    req.end();
  });
}
for (const framework of ['react', 'angular'])
  test(`${framework} HTTP serves only validated exact output routes and owns API forwarding; disk edits cannot affect running assets`, async (t) => {
    const f = fixture(t, framework);
    captureRetainedBuild(f.directory, f);
    let calls = 0;
    const backend = http.createServer((req, res) => {
      calls++;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(req.url);
    });
    await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
    t.after(
      () =>
        new Promise((resolve) => {
          backend.close(resolve);
          backend.closeAllConnections();
        })
    );
    const server = await startRetainedServer({
      directory: f.directory,
      target: `http://127.0.0.1:${backend.address().port}`,
    });
    t.after(() => server.close());
    assert.equal((await request(server.url, '/')).status, 200);
    assert.equal(
      (await request(server.url, '/?thread=garden&unrelated=kept')).status,
      200
    );
    assert.equal(
      (await request(server.url, '/assets/main.js?revision=1')).status,
      200
    );
    const before = await request(server.url, '/assets/main.js');
    assert.match(before.headers['content-type'], /javascript/);
    writeFileSync(join(f.directory, 'output/assets/main.js'), 'changed');
    assert.deepEqual(
      (await request(server.url, '/assets/main.js')).bytes,
      before.bytes
    );
    assert.equal(
      (await request(server.url, '/assets/main.js', 'HEAD')).bytes.length,
      0
    );
    for (const path of [
      '/consumer/package-lock.json',
      '/archives/core.tgz',
      '/source/react/src/main.tsx',
      '/retained.json',
      '/provenance.json',
      '/build-inputs.json',
      '/stats.json',
      '/missing',
      '/assets/%6dain.js',
      '/assets/../index.html',
      '/assets/%2e%2e/index.html',
      '//index.html',
      '/api-other',
    ])
      assert.ok(
        [400, 404].includes((await request(server.url, path)).status),
        path
      );
    assert.equal(
      (await request(server.url, '/assets/main.js', 'POST')).status,
      405
    );
    assert.equal(calls, 0);
    const forwarded = await request(server.url, '/api/threads?limit=1');
    assert.equal(forwarded.status, 200);
    assert.equal(
      forwarded.headers['content-type'],
      'text/plain; charset=utf-8'
    );
    assert.equal(forwarded.bytes.toString(), '/threads?limit=1');
    assert.equal(calls, 1);
  });
