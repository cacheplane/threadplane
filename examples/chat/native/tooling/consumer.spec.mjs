import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  lstatSync,
  cpSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  inputFingerprint,
  copyApplication,
  buildConsumer,
  prepareConsumer,
} from './consumer.mjs';
import { prepareDevelopment } from './serve-worker.mjs';
import { frozenInputFingerprint } from './source-mirror.mjs';
import { selectedBuildInputRoots } from './build-workspace.mjs';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'native-contract-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const path of [
    'libs/core/src/index.ts',
    'libs/content/src/index.ts',
    'libs/react/src/index.ts',
    'libs/angular/src/index.ts',
    'libs/langgraph/src/runtime/create-session.ts',
    'libs/langgraph/src/lib/transport/fetch.ts',
    'libs/design-tokens/src/lib/tokens.css',
    'libs/telemetry/project.json',
    'fixtures/react-parity/traces/langgraph-text-state.sse',
    'scripts/react-parity/build.mjs',
    'package.json',
    'package-lock.json',
    'nx.json',
    'tsconfig.base.json',
  ]) {
    mkdirSync(join(directory, path, '..'), { recursive: true });
    writeFileSync(
      join(directory, path),
      path.endsWith('.json') ? '{}' : 'original'
    );
  }
  mkdirSync(join(directory, 'node_modules'));
  const app = join(repository, 'examples/chat/native');
  if (existsSync(join(app, 'react/index.html')))
    cpSync(app, join(directory, 'examples/chat/native'), { recursive: true });
  return directory;
}

test('Angular copy admits only selected authored shell with strict independent configuration', (t) => {
  const root = fixture(t),
    consumer = join(root, 'consumer');
  const copied = copyApplication(root, consumer, {
    framework: 'angular',
    assistantId: 'configured',
  });
  assert.ok(
    copied['angular/src/app.component.ts'],
    'Authored Angular shell required'
  );
  assert.equal(existsSync(join(consumer, 'react')), false);
  const config = JSON.parse(
    readFileSync(join(consumer, 'angular/tsconfig.json'))
  );
  assert.equal(config.extends, undefined);
  assert.equal(config.compilerOptions.paths, undefined);
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.skipLibCheck, false);
  assert.equal(config.angularCompilerOptions.strictTemplates, true);
  assert.equal(
    JSON.parse(readFileSync(join(consumer, 'shared/browser-config.json')))
      .assistantId,
    'configured'
  );
  assert.throws(
    () => copyApplication(root, join(root, 'bad'), { framework: 'vue' }),
    /framework/i
  );
});

for (const outcome of [
  'success',
  'compile-failure',
  'source-drift',
  'owned-drift',
])
  test(`Angular selected preparation preserves atomic ownership: ${outcome}`, async (t) => {
    const root = fixture(t),
      temporaryParent = join(root, 'temporaries');
    const output = join(root, 'dist/examples/chat/native/angular');
    mkdirSync(temporaryParent);
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'index.html'), 'previous');
    const stages = {
      build(context) {
        assert.equal(context.framework, 'angular');
        assert.ok(
          existsSync(join(context.buildRoot, 'libs/angular/src/index.ts'))
        );
        assert.equal(existsSync(join(context.buildRoot, 'libs/react')), false);
        assert.equal(existsSync(join(context.consumer, 'react')), false);
        if (outcome === 'owned-drift')
          writeFileSync(
            join(context.buildRoot, 'libs/angular/src/index.ts'),
            'drift'
          );
      },
      pack() {
        return { tarballs: {}, hashes: {}, emission: {} };
      },
      install() {
        return {};
      },
      compile() {
        if (outcome === 'compile-failure') throw new Error('template failed');
        if (outcome === 'source-drift')
          writeFileSync(
            join(root, 'examples/chat/native/angular/src/app.component.ts'),
            'drift'
          );
        return { inputs: {} };
      },
      bundle({ consumer }) {
        const output = join(consumer, 'angular/dist/browser');
        mkdirSync(output, { recursive: true });
        writeFileSync(join(output, 'index.html'), 'new');
        return { output, inputs: {} };
      },
    };
    const result = buildConsumer({
      root,
      framework: 'angular',
      temporaryParent,
      operations: stages,
    });
    if (outcome === 'success') {
      const built = await result;
      assert.equal(built.output, output);
      assert.equal(built.provenance.framework, 'angular');
      assert.ok(built.provenance.inputs['libs/angular/src/index.ts']);
      assert.equal(
        Object.keys(built.provenance.inputs).some(
          (path) =>
            path.startsWith('libs/react/') ||
            path.startsWith('examples/chat/native/react/')
        ),
        false
      );
    } else await assert.rejects(result, /template failed|inputs changed/i);
    assert.equal(
      readFileSync(join(output, 'index.html'), 'utf8'),
      outcome === 'success' ? 'new' : 'previous'
    );
    assert.deepEqual(readdirSync(temporaryParent), []);
  });

test('preparation builds and packs byte-identical selected sources in its own workspace', async (t) => {
  const root = fixture(t);
  const temporary = join(root, 'owned');
  mkdirSync(temporary);
  for (const path of [
    'libs/core/.env.local',
    'libs/core/dist/stale.js',
    'libs/core/.install-collector/stale.mjs',
  ]) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), 'excluded');
  }
  const roots = [];
  const check = ({ buildRoot }) => {
    assert.equal(buildRoot, join(temporary, 'build-workspace'));
    assert.notEqual(buildRoot, root);
    assert.deepEqual(
      inputFingerprint(buildRoot, selectedBuildInputRoots(buildRoot)),
      inputFingerprint(root, selectedBuildInputRoots(root))
    );
    for (const path of [
      'libs/core/.env.local',
      'libs/core/dist',
      'libs/core/.install-collector',
      'examples/chat/native',
      'libs/design-tokens',
      'libs/telemetry/src',
    ])
      assert.equal(existsSync(join(buildRoot, path)), false, path);
    assert.equal(
      readFileSync(join(buildRoot, 'libs/core/src/index.ts'), 'utf8'),
      'original'
    );
    assert.equal(
      readFileSync(join(buildRoot, 'libs/telemetry/project.json'), 'utf8'),
      '{}'
    );
    assert.equal(
      realpathSync(join(buildRoot, 'node_modules')),
      realpathSync(join(root, 'node_modules'))
    );
    roots.push(buildRoot);
  };
  await prepareConsumer({
    root,
    temporary,
    operations: {
      build: check,
      pack(context) {
        check(context);
        return { tarballs: {} };
      },
      install({ consumer, buildRoot }) {
        assert.notEqual(consumer, buildRoot);
        assert.equal(existsSync(join(consumer, 'node_modules')), false);
      },
    },
  });
  assert.equal(roots.length, 2);
});

test('development preparation allows mutable app and token changes during the private build', async (t) => {
  const root = fixture(t);
  const temporary = join(root, 'owned');
  mkdirSync(temporary);
  writeFileSync(
    join(temporary, 'frozen.json'),
    JSON.stringify(frozenInputFingerprint(root))
  );
  const result = await prepareDevelopment({
    root,
    temporary,
    operations: {
      build() {
        writeFileSync(
          join(root, 'examples/chat/native/react/src/app.tsx'),
          'authored startup edit'
        );
        writeFileSync(
          join(root, 'libs/design-tokens/src/lib/tokens.css'),
          'mutable token edit'
        );
      },
      pack() {
        return { tarballs: {} };
      },
      install() {
        return { installed: true };
      },
    },
  });
  assert.equal(result.installation.installed, true);
  assert.deepEqual(
    result.buildInputs,
    inputFingerprint(root, selectedBuildInputRoots(root))
  );
});

for (const phase of ['build', 'pack', 'new-config'])
  test(`rejects owned source drift after ${phase} and cleans only owned preparation`, async (t) => {
    const root = fixture(t);
    const temporaryParent = join(root, 'temporaries');
    mkdirSync(temporaryParent);
    const stages = {
      build() {},
      pack() {
        return { tarballs: {} };
      },
      install() {
        assert.fail('Drift must stop before installation');
      },
    };
    stages[phase === 'new-config' ? 'build' : phase] = ({ buildRoot }) => {
      assert.ok(buildRoot, 'A private build root is required');
      writeFileSync(
        join(
          buildRoot,
          phase === 'new-config'
            ? 'tsconfig.extra.json'
            : 'libs/core/src/index.ts'
        ),
        'owned drift'
      );
      return { tarballs: {} };
    };
    await assert.rejects(
      buildConsumer({ root, temporaryParent, operations: stages }),
      /Owned build inputs changed/
    );
    assert.deepEqual(readdirSync(temporaryParent), []);
    assert.equal(
      readFileSync(join(root, 'libs/core/src/index.ts'), 'utf8'),
      'original'
    );
  });

test('fingerprint includes runtime, transport, tooling, lock, tokens and app source edits', (t) => {
  const root = fixture(t);
  const before = inputFingerprint(root);
  for (const path of [
    'libs/core/src/index.ts',
    'libs/langgraph/src/lib/transport/fetch.ts',
    'scripts/react-parity/build.mjs',
    'package-lock.json',
    'libs/design-tokens/src/lib/tokens.css',
  ]) {
    writeFileSync(join(root, path), 'edited');
    assert.notDeepEqual(inputFingerprint(root), before, path);
    writeFileSync(join(root, path), path.endsWith('.json') ? '{}' : 'original');
  }
});

test('copies authored sources and plain tokens with standalone strict config', (t) => {
  const root = fixture(t),
    consumer = join(root, 'consumer');
  mkdirSync(consumer);
  const copied = copyApplication(root, consumer, { assistantId: '' });
  assert.ok(
    existsSync(join(consumer, 'react/src/app.tsx')),
    'Real app was copied'
  );
  assert.equal(
    lstatSync(join(consumer, 'react/src/app.tsx')).isSymbolicLink(),
    false
  );
  assert.equal(
    readFileSync(join(consumer, 'react/src/app.tsx'), 'utf8'),
    readFileSync(join(root, 'examples/chat/native/react/src/app.tsx'), 'utf8')
  );
  const config = JSON.parse(
    readFileSync(join(consumer, 'react/tsconfig.json'), 'utf8')
  );
  assert.equal(config.extends, undefined);
  assert.equal(config.compilerOptions.paths, undefined);
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.skipLibCheck, false);
  assert.equal(
    readFileSync(join(consumer, 'shared/tokens.css'), 'utf8'),
    'original'
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(join(consumer, 'shared/browser-config.json'), 'utf8')
    ),
    { assistantId: '', apiBase: '/api' }
  );
  assert.ok(Object.keys(copied).includes('react/src/app.tsx'));
});

test('never copies dotenv files from authored source or shared directories', (t) => {
  const root = fixture(t),
    consumer = join(root, 'consumer');
  const source = join(root, 'examples/chat/native');
  mkdirSync(join(source, 'shared'), { recursive: true });
  for (const file of [
    'react/src/.env',
    'shared/.env.local',
    'shared/.local.env',
  ])
    writeFileSync(
      join(source, file),
      'NATIVE_LANGGRAPH_API_KEY=owned-copy-secret'
    );
  copyApplication(root, consumer);
  for (const file of [
    'react/src/.env',
    'shared/.env.local',
    'shared/.local.env',
  ])
    assert.equal(existsSync(join(consumer, file)), false);
});

test('initial copy uses the live mirror allowlist for public assets and excludes private or generated artifacts', (t) => {
  const root = fixture(t),
    consumer = join(root, 'consumer');
  const source = join(root, 'examples/chat/native');
  for (const path of [
    'react/public/icon.svg',
    'react/src/private.pem',
    'shared/private.key',
    'react/public/.env',
    'react/src/node_modules/dependency.ts',
    'shared/dist/output.js',
  ]) {
    mkdirSync(join(source, path, '..'), { recursive: true });
    writeFileSync(
      join(source, path),
      path.endsWith('.svg') ? '<svg/>' : 'private'
    );
  }
  copyApplication(root, consumer);
  assert.equal(
    readFileSync(join(consumer, 'react/public/icon.svg'), 'utf8'),
    '<svg/>'
  );
  for (const path of [
    'react/src/private.pem',
    'shared/private.key',
    'react/public/.env',
    'react/src/node_modules/dependency.ts',
    'shared/dist/output.js',
  ])
    assert.equal(existsSync(join(consumer, path)), false, path);
});

test('initial copy rejects a symlink in an authored source ancestor', (t) => {
  const root = fixture(t),
    consumer = join(root, 'consumer');
  const react = join(root, 'examples/chat/native/react'),
    outside = join(root, 'outside-react');
  cpSync(react, outside, { recursive: true });
  rmSync(react, { recursive: true });
  symlinkSync(outside, react, 'dir');
  assert.throws(() => copyApplication(root, consumer), /source links/i);
});

function operations(root, events, failAt, editAt) {
  const step = (name) => {
    events.push(name);
    if (name === editAt)
      writeFileSync(
        join(root, 'libs/core/src/index.ts'),
        'changed during preparation'
      );
    if (name === failAt) throw new Error(name + ' failed');
  };
  return {
    build() {
      assert.equal(
        readFileSync(join(root, 'libs/core/src/index.ts'), 'utf8'),
        'current before preparation'
      );
      step('build');
    },
    pack() {
      step('pack');
      return { tarballs: {}, emission: {} };
    },
    install() {
      step('install');
      return { artifacts: {}, graph: [] };
    },
    compile() {
      step('compile');
      return { inputs: [] };
    },
    bundle({ consumer }) {
      step('bundle');
      const output = join(consumer, 'react/dist');
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, 'index.html'), 'new valid app');
      return { output, inputs: [] };
    },
  };
}

for (const outcome of ['success', 'failure', 'drift', 'publication failure'])
  test(`capture is awaited before publication and cleanup (${outcome})`, async (t) => {
    const root = fixture(t),
      output = join(root, 'published'),
      temporaryParent = join(root, 'temporary');
    mkdirSync(output);
    mkdirSync(temporaryParent);
    writeFileSync(join(output, 'index.html'), 'previous');
    writeFileSync(
      join(root, 'libs/core/src/index.ts'),
      'current before preparation'
    );
    let captured = false,
      discarded = false,
      temporary;
    const result = buildConsumer({
      root,
      output,
      temporaryParent,
      operations: operations(root, []),
      async capture(context) {
        temporary = context.temporary;
        assert.ok(existsSync(context.buildRoot));
        assert.ok(existsSync(context.bundle.output));
        assert.deepEqual(context.provenance.compiler, context.compilation);
        assert.deepEqual(context.provenance.installation, context.installation);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(
          readFileSync(join(output, 'index.html'), 'utf8'),
          'previous'
        );
        assert.ok(existsSync(temporary));
        captured = true;
        if (outcome === 'failure') throw new Error('capture failed');
        if (outcome === 'drift')
          writeFileSync(join(root, 'package.json'), '{"drift":true}');
        if (outcome === 'publication failure')
          rmSync(context.bundle.output, { recursive: true });
        return {
          discard() {
            discarded = true;
          },
        };
      },
    });
    if (outcome === 'success') await result;
    else
      await assert.rejects(
        result,
        outcome === 'failure'
          ? /capture failed/
          : outcome === 'drift'
          ? /inputs changed/i
          : /ENOENT/
      );
    assert.equal(captured, true, 'Capture must run');
    assert.equal(discarded, ['drift', 'publication failure'].includes(outcome));
    assert.equal(existsSync(temporary), false);
    assert.deepEqual(readdirSync(temporaryParent), []);
    assert.equal(
      readFileSync(join(output, 'index.html'), 'utf8'),
      outcome === 'success' ? 'new valid app' : 'previous'
    );
  });

for (const phase of ['build', 'install', 'compile', 'bundle'])
  test(`${phase} failure cleans owned temporary work and preserves previous valid artifact`, async (t) => {
    const root = fixture(t),
      output = join(root, 'dist/app'),
      temporaryParent = join(root, 'temp');
    mkdirSync(output, { recursive: true });
    mkdirSync(temporaryParent);
    writeFileSync(join(output, 'index.html'), 'previous valid app');
    writeFileSync(
      join(root, 'libs/core/src/index.ts'),
      'current before preparation'
    );
    await assert.rejects(
      buildConsumer({
        root,
        output,
        temporaryParent,
        configuration: 'production',
        operations: operations(root, [], phase),
      }),
      new RegExp(phase + ' failed')
    );
    assert.equal(
      readFileSync(join(output, 'index.html'), 'utf8'),
      'previous valid app'
    );
    assert.deepEqual(readdirSync(temporaryParent), []);
    assert.deepEqual(readdirSync(join(root, 'dist')), ['app']);
  });

for (const phase of ['build', 'install'])
  test(`rejects source change during ${phase} before accepting artifacts`, async (t) => {
    const root = fixture(t),
      events = [];
    writeFileSync(
      join(root, 'libs/core/src/index.ts'),
      'current before preparation'
    );
    await assert.rejects(
      buildConsumer({
        root,
        output: join(root, 'output'),
        operations: operations(root, events, undefined, phase),
      }),
      /inputs changed/i
    );
    assert.equal(
      events.includes(phase === 'build' ? 'pack' : 'compile'),
      false
    );
  });

test('rebuilds current source after old outputs and publishes only fully built artifacts', async (t) => {
  const root = fixture(t),
    events = [],
    output = join(root, 'output');
  mkdirSync(join(root, 'dist/libs/core'), { recursive: true });
  writeFileSync(join(root, 'dist/libs/core/index.js'), 'old build');
  writeFileSync(
    join(root, 'libs/core/src/index.ts'),
    'current before preparation'
  );
  const result = await buildConsumer({
    root,
    output,
    operations: operations(root, events),
  });
  assert.deepEqual(events, ['build', 'pack', 'install', 'compile', 'bundle']);
  assert.equal(
    readFileSync(join(output, 'index.html'), 'utf8'),
    'new valid app'
  );
  assert.deepEqual(result.provenance.inputs, inputFingerprint(root));
  assert.ok(result.provenance.outputs['index.html']);
});

test('physical consumer path stays consistent when the system temporary directory is an alias', async (t) => {
  const root = fixture(t),
    physical = join(root, 'physical'),
    alias = join(root, 'alias');
  mkdirSync(physical);
  symlinkSync(physical, alias, 'dir');
  writeFileSync(
    join(root, 'libs/core/src/index.ts'),
    'current before preparation'
  );
  const stages = operations(root, []);
  const build = stages.build;
  stages.build = (context) => {
    assert.equal(context.consumer, realpathSync(context.consumer));
    build(context);
  };
  await buildConsumer({
    root,
    output: join(root, 'output'),
    temporaryParent: alias,
    operations: stages,
  });
});

for (const phase of ['before-worker', 'build', 'pack', 'install'])
  test(`development preparation honors parent's frozen baseline at ${phase}`, async (t) => {
    const root = fixture(t),
      events = [];
    const temporary = mkdtempSync(join(tmpdir(), 'native-preparation-test-'));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    writeFileSync(
      join(root, 'libs/core/src/index.ts'),
      'current before preparation'
    );
    writeFileSync(
      join(temporary, 'frozen.json'),
      JSON.stringify(frozenInputFingerprint(root))
    );
    if (phase === 'before-worker')
      writeFileSync(join(root, 'package.json'), '{"edited":true}');
    await assert.rejects(
      prepareDevelopment({
        root,
        temporary,
        operations: operations(root, events, undefined, phase),
      }),
      /Frozen development inputs changed; restart/
    );
    assert.deepEqual(
      events,
      phase === 'before-worker'
        ? []
        : ['build', 'pack', 'install'].slice(
            0,
            ['build', 'pack', 'install'].indexOf(phase) + 1
          )
    );
  });
