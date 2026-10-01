import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as presentation from './markdown-presentation-build.mjs';
import {
  selectPresentationLock,
  canonicalVendorGraph,
  derivePresentationConsumer,
  assertPresentationInstallation,
} from './markdown-presentation-build.mjs';

const pkg = (version = '1.0.0', fields = {}) => ({
  version,
  resolved: 'https://registry.npmjs.org/example.tgz',
  integrity: 'sha512-example',
  ...fields,
});
const lock = (packages) => ({
  lockfileVersion: 3,
  packages: { '': {}, ...packages },
});
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value));

test('native presentation uses the installed application builder with strict real templates and TSX', () => {
  assert.equal(typeof presentation.presentationConfiguration, 'function');
  const { workspace, typescript } = presentation.presentationConfiguration();
  const build = workspace.projects.presentation.architect.build;
  assert.equal(build.builder, '@angular/build:application');
  assert.equal(build.options.browser, 'presentation.tsx');
  assert.equal(build.options.deployUrl, '/presentation-assets/');
  assert.equal(build.options.statsJson, true);
  assert.equal(typescript.angularCompilerOptions.strictTemplates, true);
  assert.equal(typescript.compilerOptions.skipLibCheck, false);
  assert.equal(typescript.compilerOptions.paths, undefined);
  assert.equal(typescript.compilerOptions.jsx, 'react-jsx');
});

test('strict template negative proof rejects resolution failures and requires the actual snapshot diagnostics', () => {
  assert.equal(typeof presentation.assertTemplateDiagnostic, 'function');
  presentation.assertTemplateDiagnostic(
    'missing',
    "NG8008: Required input 'snapshot' from component MarkdownComponent must be specified."
  );
  presentation.assertTemplateDiagnostic(
    'wrong',
    "TS2322: Type 'string' is not assignable to type 'MarkdownSnapshot'."
  );
  for (const diagnostic of [
    'Cannot find module @threadplane/angular/markdown',
    'Build failed',
    '',
  ])
    assert.throws(() =>
      presentation.assertTemplateDiagnostic('missing', diagnostic)
    );
});

test('frozen presentation requires all outputs and rejects missing, tampered and traversal records', (t) => {
  assert.equal(typeof presentation.readPresentation, 'function');
  const directory = mkdtempSync(
    join(tmpdir(), 'markdown-frozen-presentation-')
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, 'consumer/presentation-output/browser');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'index.html'), '<html>generated</html>');
  writeFileSync(join(output, 'main.js'), 'export {};');
  const record = (path) => ({
    path: 'presentation-output/browser/' + path,
    sha256: createHash('sha256')
      .update(readFileSync(join(output, path)))
      .digest('hex'),
  });
  const outputs = ['index.html', 'main.js'].map(record);
  const proof = {
    presentation: { shell: outputs[0].path, outputs, assets: [outputs[1]] },
    frozen: outputs.map((r) => ({ ...r, path: 'consumer/' + r.path })),
  };
  assert.equal(
    presentation.readPresentation(directory, proof).shell.toString(),
    '<html>generated</html>'
  );
  const missing = structuredClone(proof);
  missing.frozen.pop();
  assert.throws(
    () => presentation.readPresentation(directory, missing),
    /frozen/
  );
  const omitted = structuredClone(proof);
  omitted.presentation.outputs.pop();
  assert.throws(
    () => presentation.readPresentation(directory, omitted),
    /outputs/
  );
  const traversal = structuredClone(proof);
  traversal.presentation.assets[0].path =
    'presentation-output/browser/../browser/main.js';
  assert.throws(
    () => presentation.readPresentation(directory, traversal),
    /path/
  );
  writeFileSync(join(output, 'main.js'), 'tampered');
  assert.throws(
    () => presentation.readPresentation(directory, proof),
    /outputs|bytes/
  );
});
const fixture = () =>
  lock({
    'node_modules/a': pkg('1.0.0', { dependencies: { b: '^1.0.0' } }),
    'node_modules/b': pkg('1.0.0', { dependencies: { a: '^1.0.0' } }),
  });

test('selects exact root seeds despite earlier nested versions; never mutates root lock', () => {
  const root = lock({
    'node_modules/other/node_modules/a': pkg('2.0.0'),
    ...fixture().packages,
  });
  const before = JSON.stringify(root);
  const selected = selectPresentationLock(root, ['a']);
  assert.deepEqual(Object.keys(selected).sort(), [
    'node_modules/a',
    'node_modules/b',
  ]);
  assert.equal(selected['node_modules/a'].version, '1.0.0');
  assert.equal(JSON.stringify(root), before);
  delete root.packages['node_modules/a'];
  assert.throws(
    () => selectPresentationLock(root, ['a']),
    /Missing.*node_modules\/a/
  );
});

test('fails on missing required dependency and peer', () => {
  for (const edge of ['dependencies', 'peerDependencies']) {
    const root = lock({
      'node_modules/a': pkg('1.0.0', { [edge]: { missing: '*' } }),
    });
    assert.throws(
      () => selectPresentationLock(root, ['a']),
      /Missing.*missing/
    );
  }
});

test('does not seed optional peers merely installed elsewhere', () => {
  const root = lock({
    'node_modules/a': pkg('1.0.0', {
      peerDependencies: { optional: '*' },
      peerDependenciesMeta: { optional: { optional: true } },
    }),
    'node_modules/optional': pkg(),
  });
  assert.deepEqual(Object.keys(selectPresentationLock(root, ['a'])), [
    'node_modules/a',
  ]);
});

test('preserves all optional native platform records and their closure verbatim', () => {
  const root = lock({
    'node_modules/a': pkg('1.0.0', {
      optionalDependencies: { linux: '1.0.0', mac: '1.0.0' },
    }),
    'node_modules/linux': pkg('1.0.0', {
      optional: true,
      os: ['linux'],
      cpu: ['x64'],
      libc: ['musl'],
      dependencies: { child: '1.0.0' },
    }),
    'node_modules/mac': pkg('1.0.0', {
      optional: true,
      os: ['darwin'],
      cpu: ['arm64'],
    }),
    'node_modules/child': pkg('1.0.0', { optional: true }),
  });
  assert.deepEqual(
    selectPresentationLock(root, ['a']),
    Object.fromEntries(Object.entries(root.packages).filter(([path]) => path))
  );
});

test('cycles retain every required edge', () => {
  assert.deepEqual(canonicalVendorGraph(fixture(), ['a']), [
    { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0' } },
    { name: 'b', version: '1.0.0', dependencies: { a: '1.0.0' } },
  ]);
});

test('conflicting owner resolutions survive canonicalization', () => {
  const root = fixture();
  root.packages['node_modules/b/node_modules/a'] = pkg('1.2.0');
  assert.deepEqual(canonicalVendorGraph(root, ['a']), [
    { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0' } },
    { name: 'a', version: '1.2.0', dependencies: {} },
    { name: 'b', version: '1.0.0', dependencies: { a: '1.2.0' } },
  ]);
});

test('canonicalization tolerates duplicate physical records only with all the same edges', () => {
  const root = fixture();
  root.packages['node_modules/b/node_modules/a'] = structuredClone(
    root.packages['node_modules/a']
  );
  assert.equal(canonicalVendorGraph(root, ['a']).length, 2);
  root.packages['node_modules/b/node_modules/a'].dependencies = {};
  assert.equal(canonicalVendorGraph(root, ['a']).length, 3);
});

function consumerFixture(
  t,
  {
    projects = ['content', 'core', 'react', 'angular'],
    manifests = {},
    root = fixture(),
  } = {}
) {
  const temporary = mkdtempSync(join(tmpdir(), 'markdown-install-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  const tarballs = {};
  for (const project of projects) {
    const directory = join(temporary, project, 'package');
    mkdirSync(directory, { recursive: true });
    writeJson(join(directory, 'package.json'), {
      name: '@threadplane/' + project,
      version: '0.0.1',
      dependencies:
        project === 'content'
          ? { a: '^1.0.0' }
          : { '@threadplane/content': '0.0.1' },
      ...manifests[project],
    });
    writeFileSync(join(directory, 'index.js'), 'export {};');
    const tarball = join(temporary, project + '.tgz');
    execFileSync('tar', [
      '-czf',
      tarball,
      '-C',
      join(temporary, project),
      'package',
    ]);
    tarballs['@threadplane/' + project] = 'file:' + tarball;
    const installed = join(consumer, 'node_modules/@threadplane', project);
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      tarball,
      '--strip-components=1',
      '-C',
      installed,
    ]);
  }
  for (const [path, record] of Object.entries(root.packages).filter(
    ([path]) => path
  )) {
    mkdirSync(join(consumer, path), { recursive: true });
    writeJson(join(consumer, path, 'package.json'), {
      ...record,
      name: path.split('node_modules/').at(-1),
    });
  }
  return { root, tarballs, consumer };
}

const reactSeeds = [
  '@cacheplane/json-stream',
  '@cacheplane/partial-markdown',
  '@langchain/langgraph-sdk',
  'react',
  'react-dom',
  '@types/react',
  '@types/react-dom',
  '@types/node',
  'typescript',
  'vite',
];
const reactRoot = () =>
  lock({
    ...fixture().packages,
    ...Object.fromEntries(
      reactSeeds.map((name) => ['node_modules/' + name, pkg()])
    ),
    'node_modules/@langchain/langgraph-sdk': pkg('1.0.0', {
      dependencies: { '@langchain/protocol': '^1.0.0' },
      peerDependencies: { '@langchain/core': '^1.0.0' },
    }),
    'node_modules/@langchain/protocol': pkg(),
    'node_modules/@langchain/core': pkg(),
    'node_modules/vite': pkg('1.0.0', {
      dependencies: { a: '^1.0.0' },
      optionalDependencies: { 'platform-binary': '1.0.0' },
    }),
    'node_modules/platform-binary': pkg('1.0.0', {
      optional: true,
      os: ['linux'],
      cpu: ['x64'],
    }),
    'node_modules/b/node_modules/a': pkg('1.2.0'),
  });
const reactFixture = (t, changes = {}) =>
  consumerFixture(t, {
    projects: ['content', 'core', 'react', 'langgraph'],
    root: reactRoot(),
    manifests: {
      langgraph: {
        dependencies: {
          '@threadplane/core': '0.0.1',
          '@langchain/langgraph-sdk': '^1.0.0',
        },
      },
    },
    ...changes,
  });
const deriveReact = (input) =>
  derivePresentationConsumer(
    input.root,
    input.tarballs,
    reactSeeds,
    'react-langgraph'
  );

const angularSeeds = [
  '@cacheplane/json-stream',
  '@cacheplane/partial-markdown',
  '@angular/core',
  '@angular/common',
  '@angular/compiler',
  '@angular/platform-browser',
  'rxjs',
  'tslib',
  '@types/node',
  'typescript',
  '@angular/cli',
  '@angular/build',
  '@angular/compiler-cli',
  '@langchain/langgraph-sdk',
];
const angularRoot = () => {
  const root = reactRoot();
  for (const name of reactSeeds.filter((name) => !angularSeeds.includes(name)))
    delete root.packages['node_modules/' + name];
  for (const name of angularSeeds)
    root.packages['node_modules/' + name] ??= pkg();
  root.packages['node_modules/@angular/build'] = pkg('1.0.0', {
    dependencies: { a: '^1.0.0' },
    optionalDependencies: { 'platform-binary': '1.0.0' },
    peerDependencies: { '@angular/compiler-cli': '^1.0.0' },
  });
  return root;
};
const angularFixture = (t, changes = {}) =>
  consumerFixture(t, {
    projects: ['content', 'core', 'angular', 'langgraph'],
    root: angularRoot(),
    manifests: {
      angular: {
        dependencies: { '@threadplane/content': '0.0.1' },
        peerDependencies: { '@angular/core': '^1.0.0' },
      },
      langgraph: {
        dependencies: {
          '@threadplane/core': '0.0.1',
          '@langchain/langgraph-sdk': '^1.0.0',
        },
      },
    },
    ...changes,
  });
const deriveAngular = (input) =>
  derivePresentationConsumer(
    input.root,
    input.tarballs,
    angularSeeds,
    'angular-langgraph'
  );

for (const framework of ['react', 'angular']) {
  test(`selected ${framework} consumer retains the current content JSON parser dependency`, (t) => {
    const root = JSON.parse(
      readFileSync(new URL('../../package-lock.json', import.meta.url))
    );
    const content = JSON.parse(
      readFileSync(new URL('../../libs/content/package.json', import.meta.url))
    );
    const input = (framework === 'react' ? reactFixture : angularFixture)(t, {
      manifests: {
        content: { dependencies: content.dependencies },
        [framework]: {
          peerDependencies:
            framework === 'react'
              ? { react: '^19.2.4' }
              : { '@angular/core': '^21.0.0' },
        },
        langgraph: {
          dependencies: {
            '@threadplane/core': '0.0.1',
            '@langchain/langgraph-sdk': '^1.10.0',
          },
        },
      },
    });
    const derived = derivePresentationConsumer(
      root,
      input.tarballs,
      framework === 'react'
        ? presentation.reactLanggraphPresentationSeeds
        : presentation.angularLanggraphPresentationSeeds,
      `${framework}-langgraph`
    );
    assert.deepEqual(
      derived.lock.packages['node_modules/@cacheplane/json-stream'],
      root.packages['node_modules/@cacheplane/json-stream']
    );
    assert.equal(
      derived.graph.find(({ name }) => name === '@threadplane/content')
        .dependencies['@cacheplane/json-stream'],
      '0.1.1'
    );
  });
}

test('selected Angular profile derives the exact local closure, seeds and physical lock records without root mutation', (t) => {
  const input = angularFixture(t);
  const before = JSON.stringify(input.root);
  const derived = deriveAngular(input);
  assert.deepEqual(
    presentation.angularLanggraphPresentationSeeds,
    angularSeeds
  );
  assert.equal(derived.profile, 'angular-langgraph');
  assert.equal(derived.manifest.name, 'owned-angular-langgraph-consumer');
  assert.deepEqual(
    Object.keys(derived.manifest.dependencies).sort(),
    [...angularSeeds, ...Object.keys(input.tarballs)].sort()
  );
  assert.equal(derived.manifest.overrides, undefined);
  for (const [path, record] of Object.entries(
    selectPresentationLock(input.root, angularSeeds)
  ))
    assert.deepEqual(derived.lock.packages[path], record);
  assert.equal(JSON.stringify(input.root), before);
  assert.equal(
    derived.lock.packages['node_modules/@threadplane/react'],
    undefined
  );
  assert.ok(
    derived.graph.some(
      (record) => record.name === 'a' && record.version === '1.2.0'
    )
  );
  assertPresentationInstallation(input.consumer, derived, input.tarballs);
});

test('selected Angular uses the repository-locked Angular toolchain and SDK closure without React', (t) => {
  const bytes = readFileSync(
    new URL('../../package-lock.json', import.meta.url)
  );
  const root = JSON.parse(bytes);
  const input = angularFixture(t, {
    manifests: {
      content: { dependencies: { '@cacheplane/partial-markdown': '0.5.8' } },
      angular: { peerDependencies: { '@angular/core': '^21.0.0' } },
      langgraph: {
        dependencies: {
          '@threadplane/core': '0.0.1',
          '@langchain/langgraph-sdk': '^1.10.0',
        },
      },
    },
  });
  const derived = deriveAngular({ ...input, root });
  for (const name of angularSeeds)
    assert.equal(
      derived.manifest.dependencies[name],
      root.packages['node_modules/' + name].version
    );
  assert.equal(
    Object.keys(selectPresentationLock(root, angularSeeds)).length,
    654
  );
  assert.equal(canonicalVendorGraph(root, angularSeeds).length, 430);
  assert.ok(
    Object.keys(derived.lock.packages).some((path) =>
      path.includes('/node_modules/', 'node_modules/'.length)
    )
  );
  assert.ok(
    !Object.keys(derived.lock.packages).some((path) =>
      /node_modules\/(?:react|react-dom|@types\/react|@types\/react-dom)$/.test(
        path
      )
    )
  );
  for (const name of ['p-queue', 'p-timeout'])
    assert.ok(
      new Set(
        derived.graph
          .filter((record) => record.name === name)
          .map((record) => record.version)
      ).size > 1,
      `Keep SDK's conflicting ${name} versions`
    );
  assert.deepEqual(
    readFileSync(new URL('../../package-lock.json', import.meta.url)),
    bytes
  );
});

for (const name of angularSeeds) {
  test(`selected Angular requires explicit root seed ${name}`, (t) => {
    const input = angularFixture(t);
    assert.throws(
      () =>
        derivePresentationConsumer(
          input.root,
          input.tarballs,
          angularSeeds.filter((seed) => seed !== name),
          'angular-langgraph'
        ),
      /Exactly fourteen selected Angular seeds required/
    );
  });
}

test('selected Angular rejects duplicate and arbitrary seeds', (t) => {
  const input = angularFixture(t);
  assert.throws(
    () =>
      derivePresentationConsumer(
        input.root,
        input.tarballs,
        [...angularSeeds, '@angular/build'],
        'angular-langgraph'
      ),
    /Exactly fourteen selected Angular seeds required/
  );
  input.root.packages['node_modules/unrelated-server-package'] = pkg();
  assert.throws(
    () =>
      derivePresentationConsumer(
        input.root,
        input.tarballs,
        [...angularSeeds, 'unrelated-server-package'],
        'angular-langgraph'
      ),
    /Unexpected selected Angular seed/
  );
});

for (const name of [
  'react',
  'react-dom',
  '@types/react',
  '@types/react-dom',
  '@ag-ui/client',
  '@mastra/client-js',
  '@langchain/langgraph',
  'langchain',
  'openai',
  '@anthropic-ai/sdk',
  '@threadplane/react',
]) {
  test(`selected Angular rejects transitive and installed unrelated package ${name}`, (t) => {
    const input = angularFixture(t);
    const derived = deriveAngular(input);
    const path = 'node_modules/' + name;
    input.root.packages[path] = pkg();
    input.root.packages['node_modules/@angular/build'].dependencies[name] =
      '^1.0.0';
    assert.throws(
      () => deriveAngular(input),
      /Unexpected (?:React|backend SDK|local package)/
    );
    mkdirSync(join(input.consumer, path), { recursive: true });
    writeJson(join(input.consumer, path, 'package.json'), {
      name,
      version: '1.0.0',
    });
    assert.throws(
      () =>
        assertPresentationInstallation(input.consumer, derived, input.tarballs),
      /Unexpected (?:React|backend SDK|local package)/
    );
  });
}

test('selected Angular requires exact local tarballs and compatible required local dependencies and peers', (t) => {
  const input = angularFixture(t);
  for (const name of Object.keys(input.tarballs)) {
    const missing = { ...input.tarballs };
    delete missing[name];
    assert.throws(
      () => deriveAngular({ ...input, tarballs: missing }),
      /tarballs required/
    );
  }
  assert.throws(
    () =>
      deriveAngular({
        ...input,
        tarballs: {
          ...input.tarballs,
          '@threadplane/react': input.tarballs['@threadplane/angular'],
        },
      }),
    /tarballs required/
  );
  assert.throws(
    () => deriveAngular({ ...input, tarballs: reactFixture(t).tarballs }),
    /tarballs required/
  );
  for (const manifests of [
    { angular: { peerDependencies: { '@angular/core': '^2.0.0' } } },
    { langgraph: { dependencies: { '@threadplane/core': '^2.0.0' } } },
    { langgraph: { dependencies: { '@threadplane/missing': '*' } } },
  ])
    assert.throws(
      () => deriveAngular(angularFixture(t, { manifests })),
      /must satisfy|does not satisfy|No local artifact policy/
    );
});

test('selected Angular rejects extra installed records and independent SDK graph drift', (t) => {
  const input = angularFixture(t);
  const derived = deriveAngular(input);
  const path = join(input.consumer, 'node_modules/unselected-vendor');
  mkdirSync(path);
  writeJson(join(path, 'package.json'), {
    name: 'unselected-vendor',
    version: '1.0.0',
  });
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /Unexpected installed record/
  );
  rmSync(path, { recursive: true });
  writeJson(
    join(input.consumer, 'node_modules/@langchain/protocol/package.json'),
    { name: '@langchain/protocol', version: '1.1.0' }
  );
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /installed.*graph/i
  );
});

test('selected Angular rejects packed and installed artifact byte drift', (t) => {
  const input = angularFixture(t);
  const derived = deriveAngular(input);
  const tarball = input.tarballs['@threadplane/angular'].slice(5);
  const bytes = readFileSync(tarball);
  writeFileSync(tarball, 'tampered');
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /integrity/
  );
  writeFileSync(tarball, bytes);
  writeFileSync(
    join(input.consumer, 'node_modules/@threadplane/angular/index.js'),
    'tampered'
  );
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /bytes equal/
  );
});

test('unknown profiles are rejected during derivation and installed verification', (t) => {
  const input = angularFixture(t);
  assert.throws(
    () =>
      derivePresentationConsumer(
        input.root,
        input.tarballs,
        angularSeeds,
        'unknown'
      ),
    /Unknown presentation profile/
  );
  const derived = deriveAngular(input);
  assert.throws(
    () =>
      assertPresentationInstallation(
        input.consumer,
        { ...derived, profile: 'unknown' },
        input.tarballs
      ),
    /Unknown presentation profile/
  );
});

test('selected React profile derives only its local closure and preserves locked records, conflicts and root bytes', (t) => {
  const input = reactFixture(t);
  const before = JSON.stringify(input.root);
  const derived = deriveReact(input);
  assert.equal(derived.profile, 'react-langgraph');
  assert.deepEqual(
    Object.keys(derived.manifest.dependencies).sort(),
    [...reactSeeds, ...Object.keys(input.tarballs)].sort()
  );
  assert.equal(derived.manifest.overrides, undefined);
  for (const [path, record] of Object.entries(
    selectPresentationLock(input.root, reactSeeds)
  ))
    assert.deepEqual(derived.lock.packages[path], record);
  assert.equal(JSON.stringify(input.root), before);
  assertPresentationInstallation(input.consumer, derived, input.tarballs);
  assert.equal(
    derived.lock.packages['node_modules/@threadplane/angular'],
    undefined
  );
  assert.ok(
    derived.graph.some(
      (record) => record.name === 'a' && record.version === '1.2.0'
    )
  );
});

test('selected React profile uses actual repository-locked Vite and SDK closure without Angular', (t) => {
  const root = JSON.parse(
    readFileSync(new URL('../../package-lock.json', import.meta.url))
  );
  const input = reactFixture(t, {
    manifests: {
      content: { dependencies: { '@cacheplane/partial-markdown': '0.5.8' } },
      langgraph: {
        dependencies: {
          '@threadplane/core': '0.0.1',
          '@langchain/langgraph-sdk': '^1.10.0',
        },
      },
    },
  });
  input.root = root;
  const derived = deriveReact(input);
  for (const name of reactSeeds)
    assert.equal(
      derived.manifest.dependencies[name],
      root.packages['node_modules/' + name].version
    );
  assert.ok(
    Object.keys(derived.lock.packages).some((path) =>
      path.includes('@esbuild/')
    )
  );
  assert.ok(
    Object.keys(derived.lock.packages).some((path) => path.includes('@rollup/'))
  );
  assert.ok(
    !Object.keys(derived.lock.packages).some((path) =>
      path.includes('@angular/')
    )
  );
  for (const name of ['p-queue', 'p-timeout']) {
    assert.ok(
      new Set(
        derived.graph
          .filter((record) => record.name === name)
          .map((record) => record.version)
      ).size > 1,
      `Keep SDK's conflicting ${name} versions`
    );
  }
});

test('selected React rejects an extra installed package outside every selected locked record', (t) => {
  const input = reactFixture(t);
  const derived = deriveReact(input);
  const path = join(input.consumer, 'node_modules/unselected-vendor');
  mkdirSync(path);
  writeJson(join(path, 'package.json'), {
    name: 'unselected-vendor',
    version: '1.0.0',
  });
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /Unexpected installed record/
  );
});

for (const name of reactSeeds) {
  test(`selected React requires explicit root seed ${name}`, (t) => {
    const input = reactFixture(t);
    assert.throws(
      () =>
        derivePresentationConsumer(
          input.root,
          input.tarballs,
          reactSeeds.filter((seed) => seed !== name),
          'react-langgraph'
        ),
      /Exactly ten selected React seeds required/
    );
  });
}

test('selected React rejects duplicate root seeds', (t) => {
  const input = reactFixture(t);
  assert.throws(
    () =>
      derivePresentationConsumer(
        input.root,
        input.tarballs,
        [...reactSeeds, 'vite'],
        'react-langgraph'
      ),
    /Exactly ten selected React seeds required/
  );
});

for (const name of ['@mastra/core', 'unrelated-server-package']) {
  test(`selected React cannot admit arbitrary external root seed ${name}`, (t) => {
    const input = reactFixture(t);
    input.root.packages['node_modules/' + name] = pkg();
    assert.throws(
      () =>
        derivePresentationConsumer(
          input.root,
          input.tarballs,
          [...reactSeeds, name],
          'react-langgraph'
        ),
      /Unexpected selected React seed/
    );
  });
}

for (const name of [
  '@angular/core',
  '@angular/build',
  '@angular/compiler-cli',
  '@angular-devkit/core',
  '@schematics/angular',
  '@analogjs/vite-plugin-angular',
  'ng-packagr',
  '@ag-ui/client',
  '@mastra/client-js',
  '@langchain/langgraph',
  'langchain',
  'openai',
  '@anthropic-ai/sdk',
  '@threadplane/unknown',
]) {
  test(`selected React profile rejects unrelated selected and installed package ${name}`, (t) => {
    const input = reactFixture(t);
    const derived = deriveReact(input);
    const path = 'node_modules/' + name;
    input.root.packages[path] = pkg();
    assert.throws(
      () =>
        derivePresentationConsumer(
          input.root,
          input.tarballs,
          [...reactSeeds, name],
          'react-langgraph'
        ),
      /Unexpected (?:Angular|backend SDK|local package)/
    );
    mkdirSync(join(input.consumer, path), { recursive: true });
    writeJson(join(input.consumer, path, 'package.json'), {
      name,
      version: '1.0.0',
    });
    assert.throws(
      () =>
        assertPresentationInstallation(input.consumer, derived, input.tarballs),
      /Unexpected (?:Angular|backend SDK|local package)/
    );
  });
}

test('selected React requires exact local tarballs and compatible required local ranges', (t) => {
  const input = reactFixture(t);
  for (const name of Object.keys(input.tarballs)) {
    const missing = { ...input.tarballs };
    delete missing[name];
    assert.throws(
      () => deriveReact({ ...input, tarballs: missing }),
      /tarballs required/
    );
  }
  assert.throws(
    () =>
      deriveReact({
        ...input,
        tarballs: {
          ...input.tarballs,
          '@threadplane/angular': input.tarballs['@threadplane/react'],
        },
      }),
    /tarballs required/
  );
  for (const dependencies of [
    { '@threadplane/core': '^2.0.0' },
    { '@threadplane/missing': '*' },
  ]) {
    const bad = reactFixture(t, { manifests: { langgraph: { dependencies } } });
    assert.throws(
      () => deriveReact(bad),
      /does not satisfy|No local artifact policy/
    );
  }
});

test('default Markdown profile still requires Angular and denies backend SDKs', (t) => {
  const input = consumerFixture(t);
  const derived = derivePresentationConsumer(input.root, input.tarballs, ['a']);
  assertPresentationInstallation(input.consumer, derived, input.tarballs);
  const path = join(input.consumer, 'node_modules/@langchain/langgraph-sdk');
  mkdirSync(path, { recursive: true });
  writeJson(join(path, 'package.json'), {
    name: '@langchain/langgraph-sdk',
    version: '1.0.0',
  });
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /Unexpected backend SDK/
  );
  assert.throws(
    () =>
      derivePresentationConsumer(input.root, reactFixture(t).tarballs, ['a']),
    /four Markdown foundation tarballs/
  );
});

test('selected React retains independent installed bytes and range-satisfying graph drift checks', (t) => {
  const input = reactFixture(t);
  const derived = deriveReact(input);
  const file = join(
    input.consumer,
    'node_modules/@threadplane/langgraph/index.js'
  );
  writeFileSync(file, 'tampered');
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /bytes equal/
  );
  writeFileSync(file, 'export {};');
  writeJson(
    join(input.consumer, 'node_modules/b/node_modules/a/package.json'),
    { name: 'a', version: '1.3.0' }
  );
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /installed.*graph/i
  );
});

// A real child executable exercises the install boundary without downloading
// vendors. It reproduces only npm's filesystem result; real npm ci proof is separate.
function installerFixture(t, mutateLock = false, createInput = reactFixture) {
  const input = createInput(t);
  const prepared = join(input.consumer, 'prepared');
  cpSync(join(input.consumer, 'node_modules'), prepared, { recursive: true });
  rmSync(join(input.consumer, 'node_modules'), { recursive: true });
  const bin = join(input.consumer, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'npm'),
    `#!${process.execPath}\n` +
      `
import fs from 'node:fs';
import assert from 'node:assert/strict';
assert.deepEqual(process.argv.slice(2), ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
assert.equal(process.env.NATIVE_LANGGRAPH_API_KEY, undefined);
assert.equal(process.env.EXAMPLE_INSTALL_MARKER, 'selected-example');
assert.equal(process.env.npm_config_legacy_peer_deps, 'false');
fs.cpSync('prepared', 'node_modules', { recursive: true });
${mutateLock ? "fs.appendFileSync('package-lock.json', '\\n');" : ''}
`
  );
  chmodSync(join(bin, 'npm'), 0o755);
  return {
    ...input,
    env: {
      PATH: bin + ':' + process.env.PATH,
      EXAMPLE_INSTALL_MARKER: 'selected-example',
    },
  };
}

test('installer forwards selected seeds/profile and explicit sanitized environment through a child process', (t) => {
  const input = installerFixture(t);
  const proof = presentation.installPresentationConsumer(
    input.consumer,
    input.root,
    input.tarballs,
    {
      seeds: reactSeeds,
      profile: 'react-langgraph',
      env: input.env,
    }
  );
  assert.deepEqual(proof.seeds, reactSeeds);
  assert.equal(proof.profile, 'react-langgraph');
  for (const file of ['package.json', 'package-lock.json']) {
    const bytes = readFileSync(join(input.consumer, file), 'utf8');
    assert.doesNotMatch(
      bytes,
      /EXAMPLE_INSTALL_MARKER|selected-example|NATIVE_LANGGRAPH_API_KEY/
    );
  }
  assert.doesNotMatch(
    JSON.stringify(proof),
    /EXAMPLE_INSTALL_MARKER|selected-example|NATIVE_LANGGRAPH_API_KEY/
  );
});

test('selected installer rejects child-process lock mutation', (t) => {
  const input = installerFixture(t, true);
  assert.throws(
    () =>
      presentation.installPresentationConsumer(
        input.consumer,
        input.root,
        input.tarballs,
        {
          seeds: reactSeeds,
          profile: 'react-langgraph',
          env: input.env,
        }
      ),
    /preserves derived lock bytes/
  );
});

test('installer forwards the Angular profile and seeds through the existing child-process boundary', (t) => {
  const input = installerFixture(t, false, angularFixture);
  const proof = presentation.installPresentationConsumer(
    input.consumer,
    input.root,
    input.tarballs,
    { seeds: angularSeeds, profile: 'angular-langgraph', env: input.env }
  );
  assert.deepEqual(proof.seeds, angularSeeds);
  assert.equal(proof.profile, 'angular-langgraph');
});

test('selected Angular installer rejects child-process lock mutation', (t) => {
  const input = installerFixture(t, true, angularFixture);
  assert.throws(
    () =>
      presentation.installPresentationConsumer(
        input.consumer,
        input.root,
        input.tarballs,
        { seeds: angularSeeds, profile: 'angular-langgraph', env: input.env }
      ),
    /preserves derived lock bytes/
  );
});

test('derives local records from packed manifests and byte integrity with exact seeds and no overrides', (t) => {
  const { root, tarballs } = consumerFixture(t);
  const derived = derivePresentationConsumer(root, tarballs, ['a']);
  assert.ok(
    derived.manifest && derived.lock,
    'Derived consumer manifest and lock required'
  );
  assert.equal(derived.manifest.dependencies.a, '1.0.0');
  assert.equal(derived.manifest.overrides, undefined);
  assert.deepEqual(derived.lock.packages[''], derived.manifest);
  assert.deepEqual(
    derived.lock.packages['node_modules/a'],
    root.packages['node_modules/a']
  );
  const record = derived.lock.packages['node_modules/@threadplane/content'];
  assert.deepEqual(record.dependencies, { a: '^1.0.0' });
  assert.equal(record.resolved, tarballs['@threadplane/content']);
  assert.equal(
    record.integrity,
    'sha512-' +
      createHash('sha512')
        .update(readFileSync(record.resolved.slice(5)))
        .digest('base64')
  );
});

test('independently rejects actual installed rangesatisfying drift with unchanged lock', (t) => {
  const input = consumerFixture(t);
  const derived = derivePresentationConsumer(input.root, input.tarballs, ['a']);
  assertPresentationInstallation(input.consumer, derived, input.tarballs);
  writeJson(join(input.consumer, 'node_modules/b/package.json'), {
    name: 'b',
    version: '1.1.0',
    dependencies: { a: '^1.0.0' },
  });
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /installed.*graph/i
  );
});

test('independently rejects installed seed drift even when a matching record exists nested', (t) => {
  const input = consumerFixture(t);
  const derived = derivePresentationConsumer(input.root, input.tarballs, ['a']);
  writeJson(join(input.consumer, 'node_modules/a/package.json'), {
    name: 'a',
    version: '1.1.0',
    dependencies: { b: '^1.0.0' },
  });
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /root selection/i
  );
});

test('rejects tarball resolution, integrity, archive byte and installed byte tampering', (t) => {
  const input = consumerFixture(t);
  const derived = derivePresentationConsumer(input.root, input.tarballs, ['a']);
  const path = 'node_modules/@threadplane/content';
  assert.ok(derived.lock, 'Derived consumer lock required');
  const wrongPath = structuredClone(derived);
  wrongPath.lock.packages[path].resolved = input.tarballs['@threadplane/react'];
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, wrongPath, input.tarballs),
    /selected tarball/
  );
  const wrongIntegrity = structuredClone(derived);
  wrongIntegrity.lock.packages[path].integrity = 'sha512-tampered';
  assert.throws(
    () =>
      assertPresentationInstallation(
        input.consumer,
        wrongIntegrity,
        input.tarballs
      ),
    /integrity/
  );
  const tarball = input.tarballs['@threadplane/content'].slice(5),
    bytes = readFileSync(tarball);
  writeFileSync(tarball, 'tampered');
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /integrity/
  );
  writeFileSync(tarball, bytes);
  writeFileSync(join(input.consumer, path, 'index.js'), 'tampered');
  assert.throws(
    () =>
      assertPresentationInstallation(input.consumer, derived, input.tarballs),
    /bytes equal/
  );
});
