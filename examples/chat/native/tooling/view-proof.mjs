import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hash, file, inventory } from './retained-build.mjs';
import { preparationEnvironment } from './commands.mjs';

// Compile a distinct test entry while the selected, installed consumer lives.
export function captureViewProof(directory, { root, consumer }) {
  const entry = 'view-proof';
  mkdirSync(join(consumer, entry));
  writeFileSync(
    join(consumer, entry, 'entry.tsx'),
    readFileSync(join(root, 'examples/chat/native/tooling/view-entry.tsx'))
  );
  writeFileSync(
    join(consumer, entry, 'index.html'),
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>'
  );
  writeFileSync(
    join(consumer, entry, 'tsconfig.json'),
    JSON.stringify({
      extends: '../react/tsconfig.json',
      include: ['entry.tsx'],
    })
  );
  writeFileSync(
    join(consumer, entry, 'vite.config.mjs'),
    `import { defineConfig } from 'vite';\nimport { relative } from 'node:path';\nexport default defineConfig({ root: import.meta.dirname, envDir: false, esbuild: { jsx: 'automatic' }, build: { outDir: 'output', emptyOutDir: true }, plugins: [{ name: 'proof-inputs', generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-inputs.json', source: JSON.stringify([...new Set([...this.getModuleIds()].filter(id => !id.startsWith('\\0')).map(id => relative(import.meta.dirname + '/..', id.split('?')[0])))].sort()) }); } }] });\n`
  );
  const execute = (tool, args) => {
    const result = spawnSync(
      process.execPath,
      [join(consumer, tool), ...args],
      {
        cwd: join(consumer, entry),
        env: preparationEnvironment(),
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      }
    );
    process.stderr.write(result.stderr ?? '');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  const compiler = 'node_modules/typescript/bin/tsc';
  const compiled = execute(compiler, [
    '--project',
    'tsconfig.json',
    '--listFiles',
    '--pretty',
    'false',
  ]);
  const typePaths = compiled
    .split(/\r?\n/)
    .filter(isAbsolute)
    .map((path) => {
      assert.ok(
        realpathSync(path).startsWith(realpathSync(consumer) + sep),
        'View compiler input escapes consumer'
      );
      return relative(consumer, path).replaceAll('\\', '/');
    });
  process.stdout.write(
    execute('node_modules/vite/bin/vite.js', [
      'build',
      '--config',
      'vite.config.mjs',
    ])
  );
  const runtimePaths = JSON.parse(
    file(consumer, 'view-proof/output/build-inputs.json')
  );
  assert.ok(runtimePaths.includes('react/src/app.tsx'));
  assert.ok(!runtimePaths.includes('react/src/main.tsx'));
  for (const path of [
    '@threadplane/langgraph/runtime/create-session.js',
    '@threadplane/content/src/markdown/create-markdown.js',
    '@threadplane/react/src/use-agent.js',
    '@threadplane/react/src/markdown/markdown.js',
  ])
    assert.ok(
      runtimePaths.includes('node_modules/' + path),
      `Actual installed runtime: ${path}`
    );
  const packages = [
    'typescript',
    'vite',
    'react',
    'react-dom',
    '@langchain/langgraph-sdk',
    '@threadplane/core',
    '@threadplane/content',
    '@threadplane/react',
    '@threadplane/langgraph',
  ];
  const inputs = [
    ...new Set([
      ...typePaths,
      ...runtimePaths,
      compiler,
      'view-proof/tsconfig.json',
      'react/tsconfig.json',
      'view-proof/index.html',
      'view-proof/vite.config.mjs',
      'node_modules/vite/bin/vite.js',
      ...packages.map((name) => 'node_modules/' + name + '/package.json'),
    ]),
  ].sort();
  mkdirSync(directory);
  const inputHashes = {};
  for (const path of inputs) {
    const bytes = file(consumer, path);
    inputHashes[path] = hash(bytes);
    mkdirSync(dirname(join(directory, 'inputs', path)), { recursive: true });
    writeFileSync(join(directory, 'inputs', path), bytes);
  }
  const outputs = inventory(join(consumer, entry, 'output'));
  for (const path of Object.keys(outputs)) {
    mkdirSync(dirname(join(directory, 'output', path)), { recursive: true });
    writeFileSync(
      join(directory, 'output', path),
      file(consumer, entry + '/output/' + path)
    );
  }
  writeFileSync(
    join(directory, 'view.json'),
    JSON.stringify(
      {
        version: 1,
        entry: 'view-proof/entry.tsx',
        source: {
          path: 'examples/chat/native/tooling/view-entry.tsx',
          sha256: inputHashes['view-proof/entry.tsx'],
        },
        compiler: {
          executable: compiler,
          executableSha256: inputHashes[compiler],
          inputs: typePaths,
        },
        packages: Object.fromEntries(
          packages.map((name) => [
            name,
            JSON.parse(file(consumer, 'node_modules/' + name + '/package.json'))
              .version,
          ])
        ),
        runtime: runtimePaths,
        inputs: inputHashes,
        outputs,
      },
      null,
      2
    ) + '\n'
  );
  readViewProof(directory);
}

export function readViewProof(directory) {
  const record = JSON.parse(file(directory, 'view.json'));
  assert.equal(record.version, 1);
  assert.equal(record.entry, 'view-proof/entry.tsx');
  assert.equal(
    record.source.path,
    'examples/chat/native/tooling/view-entry.tsx'
  );
  assert.equal(record.source.sha256, record.inputs[record.entry]);
  assert.equal(
    record.compiler.executableSha256,
    record.inputs[record.compiler.executable]
  );
  assert.ok(record.runtime.includes('react/src/app.tsx'));
  assert.ok(!record.runtime.includes('react/src/main.tsx'));
  for (const path of [...record.compiler.inputs, ...record.runtime])
    assert.ok(record.inputs[path], `Recorded input missing: ${path}`);
  const expected = Object.fromEntries([
    ...Object.entries(record.inputs).map(([p, h]) => ['inputs/' + p, h]),
    ...Object.entries(record.outputs).map(([p, h]) => ['output/' + p, h]),
  ]);
  const actual = inventory(directory);
  delete actual['view.json'];
  assert.deepEqual(
    actual,
    expected,
    'Complete view proof inventory must match'
  );
  const buffers = new Map(
    Object.entries(record.outputs).map(([path, digest]) => {
      const bytes = file(directory, 'output/' + path);
      assert.equal(hash(bytes), digest, 'View output changed while reading');
      return [path, bytes];
    })
  );
  return Object.freeze({
    outputs: Object.freeze([...buffers.keys()]),
    readOutput(path) {
      const bytes = buffers.get(path);
      return bytes && Buffer.from(bytes);
    },
  });
}
