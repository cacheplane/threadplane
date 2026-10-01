import assert from 'node:assert/strict';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  hash,
  file,
  inventory,
  noLinks,
  toolInventory,
} from './retained-build.mjs';
import { preparationEnvironment, selectedFramework } from './commands.mjs';
import { angularInputHashes, angularStatsInputs } from './angular-build.mjs';

function selection(framework) {
  selectedFramework(framework);
  assert.ok(framework, 'View framework required');
  const angular = framework === 'angular';
  const tools = angular
    ? ['typescript', '@angular/compiler-cli', '@angular/cli', '@angular/build']
    : ['typescript', 'vite'];
  return {
    framework,
    angular,
    tools,
    entry: 'view-proof/entry.' + (angular ? 'ts' : 'tsx'),
    source:
      'examples/chat/native/tooling/view-entry.' +
      (angular ? 'angular.ts' : 'tsx'),
    app: angular ? 'angular/src/app.component.ts' : 'react/src/app.tsx',
    main: framework + '/src/main.' + (angular ? 'ts' : 'tsx'),
    config: 'view-proof/' + (angular ? 'angular.json' : 'vite.config.mjs'),
    compiler: 'node_modules/typescript/bin/tsc',
    ngc: 'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js',
    bundler: angular
      ? 'node_modules/@angular/cli/bin/ng.js'
      : 'node_modules/vite/bin/vite.js',
    packages: [
      ...tools,
      ...(angular
        ? ['@angular/core', '@angular/platform-browser']
        : ['react', 'react-dom']),
      '@langchain/langgraph-sdk',
      '@threadplane/core',
      '@threadplane/content',
      '@threadplane/langgraph',
      '@threadplane/' + framework,
    ].sort(),
  };
}
const helper = 'view-proof/view-owner.ts';
const helperSource = 'examples/chat/native/tooling/view-owner.ts';
const keys = (value) => Object.keys(value).sort();
function composition(selected, types, runtime) {
  for (const p of [
    selected.entry,
    helper,
    selected.app,
    'shared/application.ts',
    'shared/message-content.ts',
    ...(selected.angular ? ['angular/src/application.token.ts'] : []),
  ]) {
    assert.ok(types.includes(p), 'View compiler composition missing: ' + p);
    assert.ok(runtime.includes(p), 'View runtime composition missing: ' + p);
  }
  for (const p of [
    '@threadplane/langgraph/runtime/create-session',
    '@threadplane/content/src/markdown/create-markdown',
    '@threadplane/content/src/messages/create-message-content',
    ...(!selected.angular ? ['@threadplane/react/src/render/render-spec'] : []),
    ...(!selected.angular ? ['@threadplane/react/src/chat/citations'] : []),
    ...(!selected.angular
      ? ['@threadplane/react/src/chat/text-transcript']
      : []),
  ]) {
    assert.ok(
      types.includes('node_modules/' + p + '.d.ts'),
      'Installed view declarations missing: ' + p
    );
    assert.ok(
      runtime.includes('node_modules/' + p + '.js'),
      'Installed view runtime missing: ' + p
    );
  }
  if (selected.angular)
    for (const p of [
      'threadplane-angular',
      'threadplane-angular-markdown',
      'threadplane-angular-chat',
    ]) {
      assert.ok(
        types.includes(
          'node_modules/@threadplane/angular/types/' + p + '.d.ts'
        ),
        'Installed view APF declarations missing'
      );
      assert.ok(
        runtime.includes(
          'node_modules/@threadplane/angular/fesm2022/' + p + '.mjs'
        ),
        'Installed view APF runtime missing'
      );
    }
  else
    for (const p of [
      'use-agent.js',
      'markdown/markdown.js',
      'chat/tool-observation.js',
      'chat/message-list.js',
      'chat/reasoning.js',
      'chat/approval-card.js',
      'chat/message-actions.js',
    ])
      assert.ok(
        runtime.includes('node_modules/@threadplane/react/src/' + p),
        'Installed React view runtime missing: ' + p
      );
}
function checkPath(path, selected) {
  assert.ok(
    typeof path === 'string' &&
      path &&
      !isAbsolute(path) &&
      !/[\\\x00-\x20\x7f?#%]/.test(path) &&
      path.split('/').every((p) => p && p !== '.' && p !== '..'),
    'Unsafe view path'
  );
  const proof = [
    selected.entry,
    helper,
    'view-proof/index.html',
    'view-proof/tsconfig.json',
    selected.config,
  ];
  assert.ok(
    path.startsWith('node_modules/') ||
      path.startsWith('shared/') ||
      path.startsWith(selected.framework + '/src/') ||
      path === selected.framework + '/tsconfig.json' ||
      proof.includes(path),
    'Unexpected view input'
  );
  assert.notEqual(
    path,
    selected.main,
    'Production bootstrap must not enter view proof'
  );
  assert.doesNotMatch(
    path,
    /(?:^|\/)(?:libs|fixtures|runtime-entry)\/|node_modules\/@threadplane\/(?:chat|telemetry|render|a2ui|ag-ui)\/|node_modules\/@threadplane\/langgraph\/(?:fesm\d*|esm\d*|types)\//,
    'Forbidden view input'
  );
  const local = path.match(/^node_modules\/@threadplane\/([^/]+)\//);
  if (local)
    assert.ok(
      ['core', 'content', 'langgraph', selected.framework].includes(local[1]),
      'Unknown view local package'
    );
  if (selected.angular)
    assert.doesNotMatch(
      path,
      /node_modules\/(?:react(?:-dom)?\/|@types\/react(?:-dom)?\/)/,
      'React input in Angular view'
    );
  else
    assert.doesNotMatch(
      path,
      /node_modules\/@angular\//,
      'Angular input in React view'
    );
}
function map(value) {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    'Expected view hash map'
  );
  for (const digest of Object.values(value))
    assert.match(digest, /^[a-f0-9]{64}$/);
  return value;
}
function configs(selected) {
  const tsconfig = {
    extends: '../' + selected.framework + '/tsconfig.json',
    compilerOptions: { noEmit: true },
    files: ['entry.' + (selected.angular ? 'ts' : 'tsx')],
  };
  if (!selected.angular) return { tsconfig };
  const angular = {
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
  };
  return { tsconfig, angular };
}

// Compile a separate real entry against the same still-live installed consumer.
export function captureViewProof(
  directory,
  { root, consumer, framework = 'react' }
) {
  const selected = selection(framework);
  noLinks(dirname(directory));
  mkdirSync(directory); // Exclusive ownership; never discard a caller's existing directory.
  try {
    const cwd = join(consumer, 'view-proof');
    mkdirSync(cwd);
    writeFileSync(
      join(consumer, selected.entry),
      readFileSync(join(root, selected.source))
    );
    writeFileSync(
      join(consumer, helper),
      readFileSync(join(root, helperSource))
    );
    writeFileSync(
      join(cwd, 'index.html'),
      '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div>' +
        (selected.angular
          ? ''
          : '<script type="module" src="/entry.tsx"></script>') +
        '</body></html>'
    );
    const configuration = configs(selected);
    writeFileSync(
      join(cwd, 'tsconfig.json'),
      JSON.stringify(configuration.tsconfig, null, 2) + '\n'
    );
    if (selected.angular)
      writeFileSync(
        join(cwd, 'angular.json'),
        JSON.stringify(configuration.angular, null, 2) + '\n'
      );
    else
      writeFileSync(
        join(cwd, 'vite.config.mjs'),
        `import { defineConfig } from 'vite';
import { relative } from 'node:path';
export default defineConfig({root:import.meta.dirname,envDir:false,esbuild:{jsx:'automatic'},build:{outDir:'output',emptyOutDir:true},plugins:[{name:'proof-inputs',generateBundle(){this.emitFile({type:'asset',fileName:'build-inputs.json',source:JSON.stringify([...new Set([...this.getModuleIds()].filter(id=>!id.startsWith('\\0')).map(id=>relative(import.meta.dirname+'/..',id.split('?')[0])))].sort())});}}]});\n`
      );
    const execute = (tool, args) => {
      const result = spawnSync(
        process.execPath,
        [join(consumer, tool), ...args],
        {
          cwd,
          env: preparationEnvironment(),
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
        }
      );
      if (result.error) throw result.error;
      process.stderr.write(result.stderr ?? '');
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return result.stdout;
    };
    const listed = execute(selected.compiler, [
      '--project',
      'tsconfig.json',
      '--noEmit',
      '--listFiles',
      '--pretty',
      'false',
    ])
      .split(/\r?\n/)
      .filter(isAbsolute);
    const typePaths = selected.angular
      ? keys(angularInputHashes(consumer, cwd, listed))
      : listed.map((path) => {
          assert.ok(
            realpathSync(path).startsWith(realpathSync(consumer) + sep),
            'View compiler input escapes consumer'
          );
          return relative(consumer, path).replaceAll('\\', '/');
        });
    let runtimePaths, virtualInputs, output;
    if (selected.angular) {
      execute(selected.ngc, ['-p', 'tsconfig.json', '--noEmit']);
      process.stdout.write(
        execute(selected.bundler, ['build', 'native-view-proof'])
      );
      const stats = angularStatsInputs(
        JSON.parse(file(consumer, 'view-proof/output/stats.json'))
      );
      runtimePaths = keys(angularInputHashes(consumer, cwd, stats.files));
      virtualInputs = stats.virtual;
      output = 'view-proof/output/browser';
      writeFileSync(
        join(consumer, output, 'stats.json'),
        file(consumer, 'view-proof/output/stats.json')
      );
      writeFileSync(
        join(consumer, output, 'build-inputs.json'),
        JSON.stringify(runtimePaths, null, 2) + '\n'
      );
    } else {
      process.stdout.write(
        execute(selected.bundler, ['build', '--config', 'vite.config.mjs'])
      );
      output = 'view-proof/output';
      runtimePaths = JSON.parse(file(consumer, output + '/build-inputs.json'));
    }
    composition(selected, typePaths, runtimePaths);
    const tools = Object.fromEntries(
      selected.tools.flatMap((name) =>
        Object.entries(toolInventory(join(consumer, 'node_modules', name))).map(
          ([p, h]) => ['node_modules/' + name + '/' + p, h]
        )
      )
    );
    const paths = [
      ...new Set([
        ...typePaths,
        ...runtimePaths,
        ...keys(tools),
        selected.compiler,
        selected.bundler,
        ...(selected.angular ? [selected.ngc] : []),
        'view-proof/tsconfig.json',
        framework + '/tsconfig.json',
        'view-proof/index.html',
        selected.config,
        ...selected.packages.map((p) => 'node_modules/' + p + '/package.json'),
      ]),
    ].sort();
    const inputs = Object.create(null);
    for (const p of paths) {
      checkPath(p, selected);
      const bytes = file(consumer, p);
      inputs[p] = hash(bytes);
      mkdirSync(dirname(join(directory, 'inputs', p)), { recursive: true });
      writeFileSync(join(directory, 'inputs', p), bytes);
    }
    const outputs = inventory(join(consumer, output));
    for (const p of keys(outputs)) {
      mkdirSync(dirname(join(directory, 'output', p)), { recursive: true });
      writeFileSync(
        join(directory, 'output', p),
        file(consumer, output + '/' + p)
      );
    }
    const record = {
      version: 2,
      framework,
      entry: selected.entry,
      source: { path: selected.source, sha256: inputs[selected.entry] },
      helper: { path: helperSource, sha256: inputs[helper] },
      compiler: {
        executable: selected.compiler,
        executableSha256: inputs[selected.compiler],
        inputs: typePaths,
        configurations: Object.fromEntries(
          ['view-proof/tsconfig.json', framework + '/tsconfig.json'].map(
            (p) => [p, inputs[p]]
          )
        ),
        ...(selected.angular
          ? {
              angular: {
                executable: selected.ngc,
                executableSha256: inputs[selected.ngc],
                strictTemplates: true,
              },
            }
          : {}),
      },
      bundler: {
        executable: selected.bundler,
        executableSha256: inputs[selected.bundler],
        configurations: { [selected.config]: inputs[selected.config] },
        ...(selected.angular ? { virtualInputs } : {}),
      },
      packages: Object.fromEntries(
        selected.packages.map((p) => [
          p,
          JSON.parse(file(consumer, 'node_modules/' + p + '/package.json'))
            .version,
        ])
      ),
      tools,
      runtime: runtimePaths,
      inputs,
      outputs,
    };
    writeFileSync(
      join(directory, 'view.json'),
      JSON.stringify(record, null, 2) + '\n'
    );
    return readViewProof(directory);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function readViewProof(directory) {
  const r = JSON.parse(file(directory, 'view.json'));
  assert.equal(r.version, 2);
  const selected = selection(r.framework);
  assert.equal(r.entry, selected.entry);
  assert.equal(r.source.path, selected.source);
  assert.equal(r.source.sha256, r.inputs[r.entry]);
  assert.equal(r.helper.path, helperSource);
  assert.equal(r.helper.sha256, r.inputs[helper]);
  for (const p of keys(map(r.inputs))) checkPath(p, selected);
  assert.ok(r.inputs[helper], 'Proof owner helper required');
  for (const p of [
    selected.compiler,
    selected.bundler,
    'view-proof/index.html',
    ...(selected.angular ? [selected.ngc] : []),
  ])
    assert.ok(r.inputs[p], 'Required view input: ' + p);
  assert.equal(r.compiler.executable, selected.compiler);
  assert.equal(r.compiler.executableSha256, r.inputs[selected.compiler]);
  assert.equal(r.bundler.executable, selected.bundler);
  assert.equal(r.bundler.executableSha256, r.inputs[selected.bundler]);
  assert.deepEqual(
    keys(map(r.compiler.configurations)),
    ['view-proof/tsconfig.json', r.framework + '/tsconfig.json'].sort()
  );
  assert.deepEqual(keys(map(r.bundler.configurations)), [selected.config]);
  for (const [p, h] of Object.entries({
    ...r.compiler.configurations,
    ...r.bundler.configurations,
  }))
    assert.equal(r.inputs[p], h, 'View config hash mismatch');
  assert.deepEqual(
    JSON.parse(file(directory, 'inputs/view-proof/tsconfig.json')),
    configs(selected).tsconfig,
    'Exact proof compiler configuration'
  );
  const authored = JSON.parse(
    file(directory, 'inputs/' + r.framework + '/tsconfig.json')
  );
  assert.equal(
    authored.compilerOptions.strict,
    true,
    'Strict view types required'
  );
  assert.equal(
    authored.compilerOptions.skipLibCheck,
    false,
    'Installed library type checks required'
  );
  assert.equal(authored.compilerOptions.paths, undefined, 'No source aliases');
  if (selected.angular) {
    assert.equal(r.compiler.angular.executable, selected.ngc);
    assert.equal(r.compiler.angular.executableSha256, r.inputs[selected.ngc]);
    assert.equal(r.compiler.angular.strictTemplates, true);
    assert.deepEqual(keys(r.bundler.virtualInputs), [
      'angular:styles/global:styles',
    ]);
    assert.equal(
      authored.angularCompilerOptions.strictTemplates,
      true,
      'Strict authored templates required'
    );
    assert.deepEqual(
      JSON.parse(file(directory, 'inputs/' + selected.config)),
      configs(selected).angular,
      'Exact Angular application builder configuration'
    );
  } else {
    assert.equal(r.compiler.angular, undefined);
    assert.equal(r.bundler.virtualInputs, undefined);
  }
  assert.deepEqual(keys(r.packages), selected.packages);
  for (const name of selected.packages) {
    const p = 'node_modules/' + name + '/package.json';
    assert.ok(r.inputs[p], 'View package manifest required');
    assert.equal(
      JSON.parse(file(directory, 'inputs/' + p)).version,
      r.packages[name]
    );
  }
  for (const [p, h] of Object.entries(map(r.tools))) {
    const prefix = selected.tools.find((name) =>
      p.startsWith('node_modules/' + name + '/')
    );
    assert.ok(prefix, 'Unknown view tool');
    assert.ok(
      !p
        .slice(('node_modules/' + prefix + '/').length)
        .startsWith('node_modules/'),
      'Tool inventory excludes nested dependencies'
    );
    assert.equal(r.inputs[p], h, 'Tool input mismatch');
  }
  for (const name of selected.tools)
    assert.ok(
      r.tools['node_modules/' + name + '/package.json'],
      'Missing view tool'
    );
  composition(selected, r.compiler.inputs, r.runtime);
  for (const p of [...r.compiler.inputs, ...r.runtime])
    assert.ok(r.inputs[p], 'Recorded input missing: ' + p);
  assert.deepEqual(
    keys(r.inputs),
    [
      ...new Set([
        ...r.compiler.inputs,
        ...r.runtime,
        ...keys(r.tools),
        selected.compiler,
        selected.bundler,
        ...(selected.angular ? [selected.ngc] : []),
        ...keys(r.compiler.configurations),
        ...keys(r.bundler.configurations),
        'view-proof/index.html',
        ...selected.packages.map(
          (name) => 'node_modules/' + name + '/package.json'
        ),
      ]),
    ].sort(),
    'Complete declared view input inventory must match'
  );
  const expected = Object.fromEntries([
    ...Object.entries(r.inputs).map(([p, h]) => ['inputs/' + p, h]),
    ...Object.entries(map(r.outputs)).map(([p, h]) => ['output/' + p, h]),
  ]);
  const actual = inventory(directory);
  delete actual['view.json'];
  assert.deepEqual(
    actual,
    expected,
    'Complete view proof inventory must match'
  );
  const buffers = new Map(
    Object.entries(r.outputs).map(([p, h]) => {
      const bytes = file(directory, 'output/' + p);
      assert.equal(hash(bytes), h);
      return [p, bytes];
    })
  );
  assert.ok(buffers.has('index.html'), 'View browser entry required');
  return Object.freeze({
    framework: r.framework,
    outputs: Object.freeze([...buffers.keys()]),
    readOutput(path) {
      const bytes = buffers.get(path);
      return bytes && Buffer.from(bytes);
    },
  });
}
