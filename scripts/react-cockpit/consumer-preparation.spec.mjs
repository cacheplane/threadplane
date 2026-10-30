import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  preparationProfile,
  prepareProfile,
  copyPreparedConsumer,
} from './consumer-preparation.mjs';
import { reactCockpitConfiguration } from './configuration.mjs';

function fixture(t) {
  const base = realpathSync(
    mkdtempSync(join(tmpdir(), 'website-consumer-test-'))
  );
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'root'),
    store = join(base, 'store');
  mkdirSync(root);
  mkdirSync(store);
  writeFileSync(join(root, 'package.json'), '{}');
  return { base, root, store, profile: 'react-langgraph' };
}

function fakePreparation(root, directory) {
  const consumer = join(directory, 'consumer');
  mkdirSync(join(consumer, 'node_modules/tool'), { recursive: true });
  mkdirSync(join(consumer, 'node_modules/.bin'));
  writeFileSync(
    join(consumer, 'node_modules/tool/index.js'),
    'installed bytes'
  );
  symlinkSync('../tool/index.js', join(consumer, 'node_modules/.bin/tool'));
  writeFileSync(join(consumer, 'package.json'), '{}');
  writeFileSync(join(consumer, 'package-lock.json'), '{}');
  return {
    consumer,
    installed: { profile: 'react-langgraph' },
    emission: { sources: [] },
    tarballs: {},
  };
}

const verify = ({ record }) => record.installed;

test('shares preparation while copies and internal executable links remain private', async (t) => {
  const f = fixture(t);
  let preparations = 0;
  await prepareProfile({
    ...f,
    prepare: (...args) => {
      preparations++;
      return fakePreparation(...args);
    },
  });
  const first = copyPreparedConsumer({
    ...f,
    temporary: join(f.base, 'first'),
    verify,
  });
  const second = copyPreparedConsumer({
    ...f,
    temporary: join(f.base, 'second'),
    verify,
  });
  assert.equal(preparations, 1);
  assert.equal(
    realpathSync(join(first.consumer, 'node_modules/.bin/tool')),
    join(first.consumer, 'node_modules/tool/index.js')
  );
  writeFileSync(
    join(first.consumer, 'node_modules/tool/index.js'),
    'changed privately'
  );
  assert.equal(
    readFileSync(join(second.consumer, 'node_modules/.bin/tool'), 'utf8'),
    'installed bytes'
  );
  assert.equal(
    readFileSync(
      join(f.store, f.profile, 'consumer/node_modules/tool/index.js'),
      'utf8'
    ),
    'installed bytes'
  );
});

for (const mutation of [
  'source',
  'installed bytes',
  'profile',
  'missing completion',
]) {
  test(`rejects ${mutation} drift before returning a copied consumer`, async (t) => {
    const f = fixture(t);
    await prepareProfile({ ...f, prepare: fakePreparation });
    const directory = join(f.store, f.profile),
      ready = join(directory, 'ready.json');
    if (mutation === 'source')
      writeFileSync(join(f.root, 'package.json'), '{"changed":true}');
    if (mutation === 'installed bytes')
      writeFileSync(
        join(directory, 'consumer/node_modules/tool/index.js'),
        'corrupt'
      );
    if (mutation === 'missing completion') rmSync(ready);
    if (mutation === 'profile') {
      const data = JSON.parse(readFileSync(ready));
      data.profile = 'react-ag-ui';
      writeFileSync(ready, JSON.stringify(data));
    }
    const temporary = join(f.base, 'copy');
    assert.throws(() => copyPreparedConsumer({ ...f, temporary, verify }));
    assert.equal(existsSync(join(temporary, 'consumer')), false);
  });
}

test('cleans failed preparation but never removes an existing caller directory', async (t) => {
  const f = fixture(t),
    directory = join(f.store, f.profile);
  await assert.rejects(
    prepareProfile({
      ...f,
      prepare: () => {
        throw Error('failed install');
      },
    }),
    /failed install/
  );
  assert.equal(existsSync(directory), false);
  mkdirSync(directory);
  writeFileSync(join(directory, 'keep'), 'owned elsewhere');
  await assert.rejects(prepareProfile({ ...f, prepare: fakePreparation }));
  assert.equal(
    readFileSync(join(directory, 'keep'), 'utf8'),
    'owned elsewhere'
  );
});

test('rejects links outside preparation and cleans private copies after validation failure', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    prepareProfile({
      ...f,
      prepare: (root, directory) => {
        const result = fakePreparation(root, directory);
        symlinkSync(root, join(result.consumer, 'outside'));
        return result;
      },
    }),
    /link/i
  );
  await prepareProfile({ ...f, prepare: fakePreparation });
  const temporary = join(f.base, 'copy');
  assert.throws(
    () =>
      copyPreparedConsumer({
        ...f,
        temporary,
        verify: () => {
          throw Error('bad graph');
        },
      }),
    /bad graph/
  );
  assert.equal(existsSync(join(temporary, 'consumer')), false);
});

test('does not remove a caller-owned dangling consumer link', async (t) => {
  const f = fixture(t);
  await prepareProfile({ ...f, prepare: fakePreparation });
  const temporary = join(f.base, 'existing');
  mkdirSync(temporary);
  const consumer = join(temporary, 'consumer');
  symlinkSync(join(f.base, 'missing'), consumer);
  assert.throws(() => copyPreparedConsumer({ ...f, temporary, verify }));
  assert.ok(lstatSync(consumer).isSymbolicLink());
});

test('five profiles are distinct and default preparation CLI performs no installation', () => {
  for (const [topic, profile] of [
    ['streaming', 'react-langgraph'],
    ['ag-ui-streaming', 'react-ag-ui'],
    ['render-spec-rendering', 'react-render'],
    ['chat-a2ui', 'react-native-a2ui-langgraph'],
    ['ag-ui-a2ui', 'react-native-a2ui-ag-ui'],
  ]) {
    assert.equal(preparationProfile(reactCockpitConfiguration(topic)), profile);
    const env = { ...process.env };
    delete env.WEBSITE_RUNTIME_PREPARATION;
    execFileSync(
      process.execPath,
      ['scripts/react-cockpit/prepare-consumer.mjs', profile],
      { env, timeout: 5000 }
    );
  }
});

test('every React build waits for its profile preparation and keeps foundation proof edges', () => {
  const tools = JSON.parse(
    readFileSync('tools/website-runtime-preparation/project.json')
  );
  let count = 0;
  for (const product of readdirSync('cockpit', { withFileTypes: true }).filter(
    (entry) => entry.isDirectory()
  )) {
    for (const topic of readdirSync(join('cockpit', product.name), {
      withFileTypes: true,
    }).filter((entry) => entry.isDirectory())) {
      const path = join(
        'cockpit',
        product.name,
        topic.name,
        'react/project.json'
      );
      if (!existsSync(path)) continue;
      const project = JSON.parse(readFileSync(path)),
        build = project.targets?.build;
      const command = build?.options?.command;
      if (!command?.startsWith('node scripts/react-cockpit/build.mjs'))
        continue;
      const profile = preparationProfile(
        reactCockpitConfiguration(command.split(' ')[2])
      );
      assert.ok(
        build.dependsOn.some(
          (edge) =>
            edge.target === profile && edge.projects?.includes(tools.name)
        ),
        project.name
      );
      const foundation = build.dependsOn.find(
        (edge) => edge.target === 'build'
      );
      for (const name of [
        'core',
        'content',
        'react',
        ...(profile.includes('a2ui') ? ['a2ui'] : []),
      ]) {
        assert.ok(
          foundation.projects.includes(name),
          `${project.name}: ${name}`
        );
        assert.ok(tools.targets[profile].dependsOn[0].projects.includes(name));
      }
      assert.equal(tools.targets[profile].cache, false);
      assert.equal(
        tools.targets[profile].options.command,
        `node scripts/react-cockpit/prepare-consumer.mjs ${profile}`
      );
      count++;
    }
  }
  assert.equal(count, 41);
});
