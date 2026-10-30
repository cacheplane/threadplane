import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import {
  emitCandidate,
  packCandidate,
} from '../react-parity/langgraph-candidate-package.mjs';
import {
  emitCandidate as emitAgUiCandidate,
  packCandidate as packAgUiCandidate,
  rootRangeOverrides,
} from '../react-parity/ag-ui-candidate-package.mjs';
import { packLocalArtifacts } from '../react-parity/verify-packages.mjs';
import {
  assertPresentationInstallation,
  derivePresentationConsumer,
  installPresentationConsumer,
  reactLanggraphPresentationSeeds,
  reactAgUiPresentationSeeds,
  reactRenderPresentationSeeds,
} from '../react-parity/markdown-presentation-build.mjs';
import { reactCockpitConfiguration } from './configuration.mjs';

const topics = {
  'react-langgraph': 'streaming',
  'react-ag-ui': 'ag-ui-streaming',
  'react-render': 'render-spec-rendering',
  'react-native-a2ui-langgraph': 'chat-a2ui',
  'react-native-a2ui-ag-ui': 'ag-ui-a2ui',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const confined = (root, path) => {
  const local = relative(root, path);
  return (
    local !== '..' &&
    !local.startsWith('../') &&
    !local.startsWith('..\\') &&
    !isAbsolute(local)
  );
};

export function preparationProfile({ adapter = 'langgraph', topic }) {
  assert.ok(
    ['none', 'ag-ui', 'langgraph'].includes(adapter),
    'Unknown preparation adapter'
  );
  return adapter === 'none'
    ? 'react-render'
    : topic === 'a2ui'
    ? adapter === 'ag-ui'
      ? 'react-native-a2ui-ag-ui'
      : 'react-native-a2ui-langgraph'
    : adapter === 'ag-ui'
    ? 'react-ag-ui'
    : 'react-langgraph';
}

function selection(profile) {
  assert.ok(
    Object.hasOwn(topics, profile),
    'Unknown consumer preparation profile'
  );
  return {
    configuration: reactCockpitConfiguration(topics[profile]),
    seeds:
      profile === 'react-render'
        ? reactRenderPresentationSeeds
        : profile.endsWith('ag-ui')
        ? reactAgUiPresentationSeeds
        : reactLanggraphPresentationSeeds,
  };
}

// This is the original fresh pack/install path, also used when reuse is off.
export function prepareFreshConsumer(root, temporary, configuration) {
  const profile = preparationProfile(configuration);
  const { seeds } = selection(profile);
  const nativeA2ui = configuration.topic === 'a2ui';
  const nativeAgUi = configuration.adapter === 'ag-ui';
  const staticRender = configuration.adapter === 'none';
  if (nativeAgUi) rootRangeOverrides(root);
  let emission = { sources: [] };
  const tarballs = packLocalArtifacts(root, temporary, ['react'], {
    optionalPeers: nativeA2ui ? ['a2ui'] : [],
  });
  if (!staticRender) {
    const candidate = join(temporary, 'candidate');
    mkdirSync(candidate);
    emission = (nativeAgUi ? emitAgUiCandidate : emitCandidate)(
      root,
      candidate
    );
    const packed = (nativeAgUi ? packAgUiCandidate : packCandidate)(
      candidate,
      temporary
    );
    tarballs[nativeAgUi ? '@threadplane/ag-ui' : '@threadplane/langgraph'] =
      'file:' + packed.tarball;
  }
  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  const installed = installPresentationConsumer(
    consumer,
    json(join(root, 'package-lock.json')),
    tarballs,
    { seeds, profile }
  );
  return { consumer, installed, emission, tarballs };
}

function inventory(directory, { source = false, omitReady = false } = {}) {
  const result = {};
  const visit = (local) => {
    const path = join(directory, local),
      info = lstatSync(path);
    if (info.isSymbolicLink()) {
      const target = readlinkSync(path);
      assert.ok(
        !isAbsolute(target) && confined(directory, realpathSync(path)),
        'Preparation link escapes its owned tree'
      );
      result[local] = 'link:' + target;
    } else if (info.isDirectory()) {
      result[local] = 'directory';
      for (const name of readdirSync(path).sort()) {
        if (
          source &&
          (['node_modules', '.git', '.nx'].includes(name) ||
            /(?:^|\.)env(?:\.|$)/i.test(name))
        )
          continue;
        if (omitReady && !local && name === 'ready.json') continue;
        visit(local ? local + '/' + name : name);
      }
    } else {
      assert.ok(info.isFile(), 'Preparation inputs must be regular files');
      result[local] = hash(readFileSync(path));
    }
  };
  visit('');
  return result;
}

function inputs(root, profile) {
  const paths = [
    'package.json',
    'package-lock.json',
    'nx.json',
    'tsconfig.json',
    'tsconfig.base.json',
    'scripts/react-cockpit/consumer-preparation.mjs',
    'scripts/react-cockpit/prepare-consumer.mjs',
    'scripts/react-cockpit/configuration.mjs',
    'scripts/react-parity',
    'fixtures/react-parity',
    ...['core', 'content', 'react', 'langgraph', 'ag-ui', 'a2ui'].map(
      (name) => 'libs/' + name
    ),
    ...[
      'core',
      'content',
      'react',
      ...(profile.includes('a2ui') ? ['a2ui'] : []),
    ].map((name) => 'dist/libs/' + name),
  ];
  return Object.fromEntries(
    paths
      .filter((path) => existsSync(join(root, path)))
      .map((path) => [
        path,
        lstatSync(join(root, path)).isDirectory()
          ? inventory(join(root, path), { source: true })
          : hash(readFileSync(join(root, path))),
      ])
  );
}

export async function prepareProfile({ root, store, profile, prepare }) {
  const { configuration } = selection(profile);
  root = realpathSync(root);
  store = realpathSync(store);
  const directory = join(store, profile);
  // Exclusive creation happens outside cleanup: never remove a caller's tree.
  mkdirSync(directory);
  const started = performance.now();
  try {
    const before = inputs(root, profile);
    const prepared = await (prepare ?? prepareFreshConsumer)(
      root,
      directory,
      configuration
    );
    assert.deepEqual(
      inputs(root, profile),
      before,
      'Consumer preparation inputs changed'
    );
    const record = {
      version: 1,
      root,
      profile,
      inputs: before,
      installed: prepared.installed,
      emission: prepared.emission,
      tarballs: prepared.tarballs,
      files: inventory(directory),
    };
    writeFileSync(join(directory, 'ready.json.tmp'), JSON.stringify(record));
    renameSync(
      join(directory, 'ready.json.tmp'),
      join(directory, 'ready.json')
    );
    console.log(
      `Website consumer preparation ${profile}: ready in ${Math.round(
        performance.now() - started
      )}ms`
    );
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function verifyCopy({ root, directory, consumer, profile, record }) {
  for (const value of Object.values(record.tarballs)) {
    assert.ok(
      typeof value === 'string' &&
        value.startsWith('file:') &&
        confined(directory, realpathSync(value.slice(5))),
      'Preparation archive outside owned tree'
    );
  }
  const { seeds } = selection(profile);
  const derived = derivePresentationConsumer(
    json(join(root, 'package-lock.json')),
    record.tarballs,
    seeds,
    profile
  );
  assert.deepEqual(json(join(consumer, 'package.json')), derived.manifest);
  assert.deepEqual(json(join(consumer, 'package-lock.json')), derived.lock);
  const installed = {
    ...assertPresentationInstallation(consumer, derived, record.tarballs),
    profile: derived.profile,
    seeds: derived.seeds,
    derivedLockSha256: hash(readFileSync(join(consumer, 'package-lock.json'))),
    artifacts: derived.artifacts,
  };
  assert.deepEqual(
    installed,
    record.installed,
    'Copied installation proof changed'
  );
  return installed;
}

export function copyPreparedConsumer({
  root,
  store,
  profile,
  temporary,
  verify = verifyCopy,
}) {
  selection(profile);
  root = realpathSync(root);
  const directory = join(realpathSync(store), profile),
    ready = join(directory, 'ready.json');
  assert.ok(
    lstatSync(ready).isFile() && !lstatSync(ready).isSymbolicLink(),
    'Preparation completion record required'
  );
  const record = json(ready);
  assert.equal(record.version, 1);
  assert.equal(record.root, root, 'Preparation belongs to another checkout');
  assert.equal(record.profile, profile, 'Preparation profile mismatch');
  assert.deepEqual(
    inputs(root, profile),
    record.inputs,
    'Consumer preparation inputs changed'
  );
  assert.deepEqual(
    inventory(directory, { omitReady: true }),
    record.files,
    'Prepared consumer bytes changed'
  );
  const consumer = join(temporary, 'consumer');
  assert.equal(
    lstatSync(consumer, { throwIfNoEntry: false }),
    undefined,
    'Fresh private consumer required'
  );
  try {
    cpSync(join(directory, 'consumer'), consumer, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
    const expected = Object.fromEntries(
      Object.entries(record.files)
        .filter(([path]) => path === 'consumer' || path.startsWith('consumer/'))
        .map(([path, digest]) => [path === 'consumer' ? '' : path.slice(9), digest])
    );
    assert.deepEqual(inventory(consumer), expected, 'Private consumer copy changed');
    const installed = verify({ root, directory, consumer, profile, record });
    console.log(
      `Website consumer preparation ${profile}: verified private copy`
    );
    return { consumer, installed, emission: record.emission };
  } catch (error) {
    rmSync(consumer, { recursive: true, force: true });
    throw error;
  }
}

