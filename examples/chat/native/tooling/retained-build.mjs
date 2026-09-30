import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assertInstalledArtifacts } from '../../../../scripts/react-parity/langgraph-candidate-package.mjs';
import { assertTemplateDiagnostic } from '../../../../scripts/react-parity/markdown-presentation-build.mjs';
import { mirrorDestination } from './source-policy.mjs';
import { startProxy } from './proxy.mjs';

export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function selection(framework) {
  assert.ok(
    framework === 'react' || framework === 'angular',
    'Unknown retained framework'
  );
  return {
    framework,
    opposite: framework === 'react' ? 'angular' : 'react',
    locals: ['content', 'core', 'langgraph', framework]
      .map((name) => '@threadplane/' + name)
      .sort(),
    tools:
      framework === 'react'
        ? ['typescript', 'vite']
        : [
            'typescript',
            '@angular/compiler-cli',
            '@angular/cli',
            '@angular/build',
          ],
    entry: framework + '/src/main.' + (framework === 'react' ? 'tsx' : 'ts'),
    configs: [
      framework + '/tsconfig.json',
      framework + '/tsconfig.app.json',
      framework +
        (framework === 'react' ? '/vite.config.mts' : '/angular.json'),
    ],
  };
}
function localPath(path) {
  assert.ok(
    typeof path === 'string' &&
      path.length &&
      !isAbsolute(path) &&
      !/[\\\x00-\x20\x7f?#%]/.test(path) &&
      path.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Unsafe retained path'
  );
  return path;
}
export function noLinks(path) {
  const absolute = resolve(path);
  if (dirname(absolute) !== absolute) noLinks(dirname(absolute));
  assert.ok(
    !lstatSync(absolute).isSymbolicLink(),
    'Retained paths cannot contain symlinks'
  );
  return absolute;
}
export function file(root, local) {
  const path = noLinks(join(root, localPath(local)));
  assert.ok(lstatSync(path).isFile(), 'Retained inputs must be regular files');
  return readFileSync(path);
}
export function inventory(root, local = '') {
  const directory = noLinks(local ? join(root, localPath(local)) : root);
  const result = Object.create(null);
  for (const name of readdirSync(directory).sort()) {
    const path = local ? local + '/' + name : name;
    localPath(path);
    const info = lstatSync(join(root, path));
    assert.ok(!info.isSymbolicLink(), 'Retained paths cannot contain symlinks');
    if (info.isDirectory()) Object.assign(result, inventory(root, path));
    else result[path] = hash(file(root, path));
  }
  return { ...result };
}
// npm places separately installed dependencies and their .bin links here.
// Retain this explicit tool package's own files; actual compiler/runtime input
// maps separately retain used dependency files. Generic inventory stays strict.
export function toolInventory(root) {
  const result = Object.create(null);
  for (const name of readdirSync(noLinks(root)).sort()) {
    if (name === 'node_modules') continue;
    localPath(name);
    if (lstatSync(join(root, name)).isDirectory())
      Object.assign(result, inventory(root, name));
    else result[name] = hash(file(root, name));
  }
  return { ...result };
}
function recordMap(value) {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    'Expected hash inventory'
  );
  for (const [path, digest] of Object.entries(value)) {
    localPath(path);
    assert.match(digest, /^[a-f0-9]{64}$/, 'Invalid inventory hash');
  }
  return value;
}
function merge(...maps) {
  const result = Object.create(null);
  for (const map of maps)
    for (const [path, digest] of Object.entries(recordMap(map))) {
      assert.ok(
        result[path] === undefined || result[path] === digest,
        'Conflicting inventory hashes'
      );
      result[path] = digest;
    }
  return { ...result };
}
function selectedInputs(p, selected) {
  const { framework, opposite, entry, configs } = selected;
  const sourcePath = (path, buildOnly) => {
    localPath(path);
    const foundation =
      /^(?:package(?:-lock)?\.json|nx\.json|tsconfig[^/]*\.json)$/.test(path) ||
      [
        'libs/core/',
        'libs/content/',
        `libs/${framework}/`,
        'libs/langgraph/',
        'scripts/react-parity/',
      ].some((prefix) => path.startsWith(prefix)) ||
      path === 'libs/telemetry/project.json' ||
      path === 'fixtures/react-parity/traces/langgraph-text-state.sse';
    const authored =
      [
        'examples/chat/native/' + framework + '/',
        'examples/chat/native/shared/',
        'examples/chat/native/tooling/',
      ].some((prefix) => path.startsWith(prefix)) ||
      path === 'examples/chat/native/tsconfig.test.json' ||
      path === 'libs/design-tokens/src/lib/tokens.css';
    assert.ok(
      foundation || (!buildOnly && authored),
      'Input outside selected source framework: ' + path
    );
  };
  for (const path of Object.keys(recordMap(p.inputs))) sourcePath(path, false);
  for (const path of Object.keys(recordMap(p.buildInputs)))
    sourcePath(path, true);
  assert.ok(
    p.inputs['examples/chat/native/' + entry],
    'Selected source entry required'
  );
  assert.ok(
    p.inputs['package-lock.json'] && p.buildInputs['package-lock.json'],
    'Selected source root lock required'
  );
  for (const path of Object.keys(recordMap(p.copied)))
    assert.ok(
      configs.includes(path) ||
        ['shared/browser-config.json', 'shared/tokens.css'].includes(path) ||
        mirrorDestination('examples/chat/native/' + path, framework) === path,
      'Input outside selected copied framework: ' + path
    );
  for (const path of [entry, ...configs, 'shared/browser-config.json'])
    assert.ok(p.copied[path], 'Selected entry/config required: ' + path);
  const consumerPath = (path) => {
    localPath(path);
    assert.ok(
      p.copied[path] || path.startsWith('node_modules/'),
      'Input outside selected consumer framework: ' + path
    );
    if (path.startsWith('node_modules/@threadplane/'))
      assert.ok(
        selected.locals.some((name) =>
          path.startsWith('node_modules/' + name + '/')
        ),
        'Unknown selected local package input: ' + path
      );
    const forbidden =
      framework === 'angular'
        ? /^node_modules\/(?:react(?:-dom)?\/|@types\/react(?:-dom)?\/|@threadplane\/(?:react|chat|telemetry|render|a2ui|ag-ui)\/|@threadplane\/langgraph\/(?:fesm\d*|esm\d*|types)\/)/
        : /^node_modules\/(?:@angular\/|@threadplane\/(?:angular|chat|telemetry|render|a2ui|ag-ui)\/|@threadplane\/langgraph\/(?:fesm\d*|esm\d*|types)\/)/;
    assert.doesNotMatch(
      path,
      forbidden,
      'Forbidden selected framework input: ' + opposite
    );
  };
  for (const map of [p.compiler.inputs, p.bundler.inputs])
    for (const path of Object.keys(recordMap(map))) consumerPath(path);
  assert.ok(p.compiler.inputs[entry], 'Selected compiler entry required');
  assert.ok(p.bundler.inputs[entry], 'Selected runtime entry required');
  const projection =
    'node_modules/@threadplane/content/src/messages/create-message-content';
  assert.ok(
    p.compiler.inputs[projection + '.d.ts'],
    'Installed message projection declarations required'
  );
  assert.ok(
    p.bundler.inputs[projection + '.js'],
    'Installed message projection runtime required'
  );
  if (framework === 'react') {
    const list = 'node_modules/@threadplane/react/src/chat/message-list';
    assert.ok(
      p.compiler.inputs[list + '.d.ts'],
      'Installed MessageList declarations required'
    );
    assert.ok(
      p.bundler.inputs[list + '.js'],
      'Installed MessageList runtime required'
    );
  }
  return consumerPath;
}

// Transient decorated hosts are deliberately removed after ngc restoration.
// Their text/configuration are embedded evidence, not retained on-disk inputs.
function angularEvidence(p, consumerPath) {
  const a = p.compiler.angular;
  assert.equal(
    a.executable,
    'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js',
    'Selected Angular compiler executable'
  );
  assert.equal(a.strictTemplates, true, 'Strict Angular compiler required');
  assert.equal(
    p.bundler.executable,
    'node_modules/@angular/cli/bin/ng.js',
    'Selected Angular CLI executable'
  );
  assert.deepEqual(
    Object.keys(p.compiler.configurations).sort(),
    ['angular/tsconfig.app.json', 'angular/tsconfig.json'],
    'Selected compiler configs'
  );
  assert.deepEqual(
    Object.keys(p.bundler.configuration),
    ['angular/angular.json'],
    'Selected CLI config'
  );
  for (const map of [p.compiler.configurations, p.bundler.configuration])
    for (const [path, digest] of Object.entries(recordMap(map)))
      assert.equal(digest, p.copied[path], 'Selected config hash');
  assert.deepEqual(
    Object.keys(p.bundler.virtualInputs),
    ['angular:styles/global:styles'],
    'Only known Angular virtual input'
  );
  assert.deepEqual(
    Object.keys(a.negatives).sort(),
    ['missing', 'wrong'],
    'Exactly known Angular negatives'
  );
  const dependencies = [];
  for (const kind of ['wrong', 'missing']) {
    const n = a.negatives[kind];
    const host = `__snapshot-negative-${kind}.ts`;
    const source = `import { Component } from '@angular/core';\nimport { MarkdownComponent } from '@threadplane/angular/markdown';\n@Component({selector:'negative-host',standalone:true,imports:[MarkdownComponent],template: \`<threadplane-markdown ${
      kind === 'wrong' ? '[snapshot]="value"' : ''
    } />\`})\nexport class NegativeHost { readonly value = 'not a snapshot'; }\n`;
    assert.equal(n.source, source, 'Known negative decorated source');
    assert.equal(n.sourceSha256, hash(n.source), 'Negative source hash');
    assert.equal(
      n.configurationSha256,
      hash(n.configuration),
      'Negative config hash'
    );
    assert.deepEqual(
      JSON.parse(n.configuration),
      {
        extends: './tsconfig.json',
        compilerOptions: { noEmit: true },
        files: [host],
      },
      'Known negative config'
    );
    assert.equal(
      n.code,
      kind === 'wrong' ? 'TS2322' : 'NG8008',
      'Negative diagnostic code'
    );
    assert.equal(n.expectedType, 'MarkdownSnapshot');
    assert.equal(n.restored, true, 'Negative must restore green');
    assertTemplateDiagnostic(kind, n.diagnostic);
    const inputs = { ...recordMap(n.inputs) };
    for (const path of [
      'node_modules/@threadplane/angular/types/threadplane-angular-markdown.d.ts',
      'node_modules/@threadplane/content/src/markdown/index.d.ts',
    ])
      assert.ok(
        inputs[path],
        `${kind} negative installed declaration required: ${path}`
      );
    assert.equal(
      inputs['angular/' + host],
      n.sourceSha256,
      'Negative host input hash'
    );
    delete inputs['angular/' + host];
    for (const path of Object.keys(inputs)) {
      assert.ok(
        path.startsWith('node_modules/'),
        'Negative inputs must be installed dependencies'
      );
      consumerPath(path);
    }
    dependencies.push(inputs);
  }
  return merge(
    ...dependencies,
    p.compiler.configurations,
    p.bundler.configuration,
    {
      [a.executable]: a.executableSha256,
      [p.bundler.executable]: p.bundler.executableSha256,
    }
  );
}
function expectedConsumer(record) {
  const p = record.provenance;
  const selected = selection(record.framework);
  const consumerPath = selectedInputs(p, selected);
  assert.deepEqual(
    Object.keys(p.installation.artifacts).sort(),
    selected.locals,
    'Exactly four local artifacts required'
  );
  const artifacts = {};
  for (const [name, files] of Object.entries(p.installation.artifacts)) {
    assert.ok(Array.isArray(files));
    const seen = new Set();
    for (const { path, sha256 } of files) {
      localPath(path);
      assert.ok(!seen.has(path), 'Duplicate artifact path');
      seen.add(path);
      artifacts['node_modules/' + name + '/' + path] = sha256;
    }
  }
  return merge(
    p.copied,
    p.compiler.inputs,
    p.bundler.inputs,
    artifacts,
    record.tools,
    record.derived,
    selected.framework === 'angular' ? angularEvidence(p, consumerPath) : {},
    { [localPath(p.compiler.executable)]: p.compiler.executableSha256 }
  );
}
function expectedFiles(record) {
  assert.equal(record.version, 2, 'Unsupported retained build');
  const selected = selection(record.framework),
    { locals, tools } = selected;
  const p = record.provenance;
  assert.equal(p.framework, record.framework, 'Retained framework mismatch');
  assert.equal(
    p.configuration,
    'production',
    'Only production builds can be retained'
  );
  assert.deepEqual(
    Object.keys(p.packages).sort(),
    locals,
    'Selected local packages'
  );
  assert.deepEqual(
    Object.keys(record.archives).sort(),
    locals,
    'Selected local archives'
  );
  assert.equal(
    p.compiler.executable,
    'node_modules/typescript/bin/tsc',
    'Selected TypeScript compiler executable'
  );
  if (selected.framework === 'react') {
    assert.equal(p.compiler.angular, undefined, 'Wrong framework compiler');
    assert.equal(
      p.compiler.configurations,
      undefined,
      'Wrong framework compiler configs'
    );
    assert.equal(p.bundler.executable, undefined, 'Wrong framework bundler');
    assert.equal(p.bundler.configuration, undefined, 'Wrong framework config');
    assert.equal(
      p.bundler.virtualInputs,
      undefined,
      'Wrong framework virtual inputs'
    );
  }
  const archives = {};
  for (const name of locals) {
    const entry = record.archives[name];
    assert.equal(
      entry.path,
      'archives/' + name.slice('@threadplane/'.length) + '.tgz'
    );
    assert.ok(
      typeof entry.original === 'string' &&
        /^file:.*\.tgz$/.test(entry.original)
    );
    archives[entry.path.slice('archives/'.length)] = p.packages[name];
  }
  assert.equal(
    record.derived['package-lock.json'],
    p.installation.derivedLockSha256,
    'Derived lock hash'
  );
  assert.deepEqual(Object.keys(record.derived).sort(), [
    'package-lock.json',
    'package.json',
  ]);
  for (const path of Object.keys(recordMap(record.tools)))
    assert.ok(
      tools.some((name) => path.startsWith('node_modules/' + name + '/')),
      'Tool outside selected framework: ' + path
    );
  for (const name of tools)
    assert.ok(
      !Object.keys(record.tools).some((path) =>
        path.startsWith('node_modules/' + name + '/node_modules/')
      ),
      'Nested dependencies are not package-owned tool files'
    );
  for (const path of [
    ...tools.map((name) => 'node_modules/' + name + '/package.json'),
    p.compiler.executable,
    ...(selected.framework === 'angular'
      ? [p.compiler.angular.executable, p.bundler.executable]
      : ['node_modules/vite/bin/vite.js']),
  ])
    assert.ok(record.tools[path], 'Selected tool required: ' + path);
  const groups = {
    source: p.inputs,
    'build-inputs': p.buildInputs,
    consumer: expectedConsumer(record),
    archives,
    output: p.outputs,
  };
  const expected = {};
  for (const [group, files] of Object.entries(groups))
    for (const [path, digest] of Object.entries(recordMap(files)))
      expected[group + '/' + path] = digest;
  return expected;
}

// Synchronous capture runs inside buildConsumer's awaited hook. The returned
// discard is used only if the enclosing build fails after this capture succeeds.
export function captureRetainedBuild(directory, context) {
  directory = resolve(directory);
  noLinks(dirname(directory));
  mkdirSync(directory); // Exclusive ownership; an existing target is never touched.
  try {
    const {
      root,
      buildRoot,
      temporary,
      consumer,
      packages,
      provenance,
      bundle,
    } = context;
    assert.deepEqual(provenance.installation, context.installation);
    assert.deepEqual(provenance.compiler, context.compilation);
    assert.deepEqual(provenance.bundler.inputs, bundle.inputs);
    assert.deepEqual(provenance.packages, packages.hashes);
    const selected = selection(provenance.framework),
      { locals } = selected;
    assert.equal(
      context.framework,
      selected.framework,
      'Capture framework mismatch'
    );
    const record = {
      version: 2,
      framework: selected.framework,
      provenance: structuredClone(provenance),
      archives: {},
      tools: merge(
        ...selected.tools.map((name) =>
          Object.fromEntries(
            Object.entries(
              toolInventory(join(consumer, 'node_modules', name))
            ).map(([path, digest]) => [
              'node_modules/' + name + '/' + path,
              digest,
            ])
          )
        )
      ),
      derived: Object.fromEntries(
        ['package.json', 'package-lock.json'].map((path) => [
          path,
          hash(file(consumer, path)),
        ])
      ),
    };
    assert.deepEqual(Object.keys(packages.tarballs).sort(), locals);
    for (const name of locals)
      record.archives[name] = {
        original: packages.tarballs[name],
        path: 'archives/' + name.slice('@threadplane/'.length) + '.tgz',
      };
    const expected = expectedFiles(record);
    assert.deepEqual(
      inventory(bundle.output),
      provenance.outputs,
      'Complete emitted output inventory'
    );
    assertInstalledArtifacts(consumer, provenance.installation.artifacts);
    const roots = {
      source: root,
      'build-inputs': buildRoot,
      consumer,
      output: bundle.output,
    };
    for (const [path, digest] of Object.entries(expected)) {
      const slash = path.indexOf('/'),
        group = path.slice(0, slash),
        local = path.slice(slash + 1);
      let bytes;
      if (group === 'archives') {
        const entry = Object.values(record.archives).find(
          (entry) => entry.path === path
        );
        const archive = entry.original.slice(5);
        const confined = relative(noLinks(temporary), resolve(archive));
        assert.ok(
          confined &&
            !confined.startsWith('..' + sep) &&
            confined !== '..' &&
            !isAbsolute(confined),
          'Archive outside owned preparation'
        );
        bytes = file(temporary, confined.replaceAll(sep, '/'));
      } else bytes = file(roots[group], local);
      assert.equal(hash(bytes), digest, `Capture bytes changed: ${path}`);
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), bytes);
    }
    writeFileSync(
      join(directory, 'retained.json'),
      JSON.stringify(record, null, 2) + '\n'
    );
    readRetainedBuild(directory);
    return {
      directory,
      discard() {
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

// Hashes provide local integrity evidence, not cryptographic authenticity.
// No original source, installation, or archive path is dereferenced on review.
export function readRetainedBuild(directory) {
  noLinks(directory);
  const record = JSON.parse(file(directory, 'retained.json'));
  const expected = expectedFiles(record),
    actual = inventory(directory);
  delete actual['retained.json'];
  assert.deepEqual(
    actual,
    expected,
    'Retained byte hashes and complete inventory must match'
  );
  const consumer = join(directory, 'consumer');
  assertInstalledArtifacts(consumer, record.provenance.installation.artifacts);
  const lock = JSON.parse(file(consumer, 'package-lock.json'));
  const manifest = JSON.parse(file(consumer, 'package.json'));
  const { locals } = selection(record.framework);
  assert.deepEqual(
    Object.keys(manifest.dependencies)
      .filter((name) => name.startsWith('@threadplane/'))
      .sort(),
    locals,
    'Selected manifest local packages'
  );
  assert.deepEqual(
    Object.keys(lock.packages)
      .filter((name) => name.startsWith('node_modules/@threadplane/'))
      .sort(),
    locals.map((name) => 'node_modules/' + name),
    'Selected lock local packages'
  );
  for (const name of locals) {
    const original = record.archives[name].original;
    assert.equal(
      manifest.dependencies[name],
      original,
      'Original manifest archive mapping'
    );
    assert.equal(
      lock.packages[''].dependencies[name],
      original,
      'Original lock archive mapping'
    );
    assert.equal(
      lock.packages['node_modules/' + name].resolved,
      original,
      'Original lock resolution'
    );
  }
  const buffers = new Map(
    Object.entries(record.provenance.outputs).map(([path, digest]) => {
      const bytes = file(directory, 'output/' + path);
      assert.equal(hash(bytes), digest, 'Output hash changed while reading');
      return [path, bytes];
    })
  );
  const outputs = Object.freeze([...buffers.keys()]);
  return Object.freeze({
    framework: record.framework,
    outputs,
    readOutput(path) {
      const bytes = buffers.get(path);
      return bytes && Buffer.from(bytes);
    },
  });
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
export async function startRetainedServer({
  directory,
  target,
  apiKey = '',
  port = 0,
}) {
  const retained = readRetainedBuild(directory);
  return startCheckedServer({ retained, target, apiKey, port });
}

export async function startCheckedServer({
  retained,
  target,
  apiKey = '',
  port = 0,
}) {
  const assets = new Map();
  for (const path of retained.outputs) {
    // Build diagnostics are retained for review but never exposed to the browser.
    if (['build-inputs.json', 'provenance.json', 'stats.json'].includes(path))
      continue;
    assert.ok(
      path !== 'api' && !path.startsWith('api/'),
      'Output cannot shadow API'
    );
    const extension = path.slice(path.lastIndexOf('.'));
    assets.set('/' + path, {
      bytes: retained.readOutput(path),
      contentType: contentTypes[extension] ?? 'application/octet-stream',
    });
  }
  assert.ok(assets.has('/index.html'), 'Retained application needs index.html');
  assets.set('/', assets.get('/index.html'));
  return startProxy({ target, apiKey, port, assets });
}
