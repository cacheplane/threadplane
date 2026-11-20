import assert from 'node:assert/strict';
import {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  backendPackageViolations,
  emitBackendPackage,
  packBackendPackage,
  stageBuiltBackendPackage,
  filesIn,
  lockedVendorGraph,
  sha256,
  vendorOverrides,
  localArtifactRecords,
  assertInstalledArtifacts,
  assertLocalResolutions,
} from './langgraph-package.mjs';
import { installFootprint, runConsumer } from './verify-packages.mjs';

// The real package: its root is `src/public-api`, its manifest is the one in
// `libs/ag-ui/package.json`, and nothing in it may import a UI framework.
export const entry = 'src/public-api';
export const factory = 'src/runtime/create-session';
export const projector = 'src/runtime/text-transcript';
export const messages = 'src/runtime/message-projection';
export const agent = 'src/runtime/agent-session';
export const decision = 'src/runtime/decision';
export const clientTools = 'src/runtime/client-tools';
/** Every module the package compiles, reviewed by name. A new one is added here. */
export const reviewedSources = [
  'libs/ag-ui/src/public-api',
  ...[
    'activity-messages',
    'agent-session',
    'apply-patch',
    'bridge-citations-state',
    'child-projection',
    'client-tool-ledger',
    'client-tools',
    'copy-data',
    'create-http-request',
    'create-run',
    'create-session',
    'decision',
    'development-install',
    'durability',
    'encrypted-messages',
    'fake-agent',
    'interrupt-mode',
    'lifecycle',
    'message-projection',
    'package-version',
    'protected-fetch',
    'reasoning-clock',
    'reconcile-transcript',
    'replay',
    'session-attribution',
    'session-instruments',
    'session-observation',
    'session-publication',
    'state',
    'subagents',
    'submit-input',
    'text-messages',
    'text-transcript',
    'thread-store',
    'tool-messages',
    'transcript',
  ].map((name) => 'libs/ag-ui/src/runtime/' + name),
]
  .map((path) => path + '.ts')
  .sort();
const agUiPackage = Object.freeze({
  name: '@threadplane/ag-ui',
  project: 'ag-ui',
  peers: ['@ag-ui/client', '@threadplane/core', 'rxjs'],
  // RxJS is the SDK's own stream type: the in-process fake agent returns one.
  imports: ['@threadplane/core', '@ag-ui/client', 'rxjs'],
  typeOnlyImports: ['@threadplane/core/tools'],
  libraries: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.esnext.disposable.d.ts'],
});
const seeds = ['@ag-ui/client'];
const reviewedOutput = new Set(
  reviewedSources.flatMap((source) => {
    const base = source.slice('libs/ag-ui/'.length, -3);
    return [base + '.js', base + '.d.ts', base + '.d.ts.map'];
  })
);
export function candidateViolations(directory) {
  const errors = backendPackageViolations(directory, agUiPackage);
  for (const path of [entry, factory, projector, messages, agent, decision])
    for (const suffix of ['.js', '.d.ts'])
      if (!existsSync(join(directory, path + suffix)))
        errors.push(`Missing emitted ${path}${suffix}`);
  for (const path of filesIn(directory)) {
    const name = relative(directory, path);
    if (name.startsWith('src/') && !reviewedOutput.has(name))
      errors.push(`Unexpected candidate file ${name}`);
  }
  return [...new Set(errors)];
}
function assertReviewed(emission) {
  assert.deepEqual(
    emission.sources.map((file) => file.path).sort(),
    reviewedSources,
    'Only the reviewed actual AG-UI source set is emitted'
  );
  return emission;
}
export function emitCandidate(root, directory) {
  return assertReviewed(emitBackendPackage(root, directory, agUiPackage));
}
/** Stages `dist/libs/ag-ui`, the package the release publishes, and proves it current. */
export function stageBuiltPackage(root, directory) {
  return assertReviewed(stageBuiltBackendPackage(root, directory, agUiPackage));
}
export function packCandidate(directory, destination) {
  return packBackendPackage(
    directory,
    destination,
    candidateViolations,
    'unpacked-ag-ui'
  );
}
export function installViolations(lock, localNames, mixed = false) {
  const errors = [];
  for (const name of localNames)
    if (!lock.packages?.[`node_modules/${name}`])
      errors.push(`Missing installed local package ${name}`);
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (!path.includes('node_modules/')) continue;
    const name = path.split('node_modules/').at(-1);
    if (
      name.startsWith('@threadplane/') &&
      (!localNames.includes(name) ||
        pkg.link ||
        !/^file:.*\.tgz$/.test(pkg.resolved ?? ''))
    )
      errors.push(`${name} must use its local tarball`);
    if (
      !mixed &&
      (name.startsWith('@angular/') ||
        [
          'react',
          'react-dom',
          '@types/react',
          '@types/react-dom',
          '@threadplane/content',
          '@cacheplane/partial-markdown',
        ].includes(name))
    )
      errors.push(`Backend installed framework ${name}`);
    if (
      name.startsWith('@langchain/') ||
      name === '@ag-ui/mastra' ||
      name.startsWith('@mastra/')
    )
      errors.push(`Unrelated owner vendor ${name}`);
  }
  return errors;
}
export function rootRangeOverrides(root) {
  const overrides = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8')
  ).overrides;
  assert.deepEqual(
    overrides,
    { rxjs: '~7.8.0' },
    'Review any change to the existing supported root override policy'
  );
  return overrides;
}
export function agUiVendorOverrides(vendors) {
  const counts = new Map();
  for (const { name } of vendors) counts.set(name, (counts.get(name) ?? 0) + 1);
  // Pin shared vendors at every root as well as below their declared parents.
  // npm can otherwise hoist a shared proto dependency outside a seed-only pin.
  // Keep these unique-version root pins unqualified so the existing RxJS
  // override also applies to the SDK's original, different exact request.
  // Mixed React consumers require both AG-UI's Zod 3 and render's Zod 4.
  // Qualify only multi-version roots; keep the supported unique RxJS pin.
  const pins = vendorOverrides(
    vendors,
    vendors.map(({ name, version }) => `${name}@${version}`)
  );
  return Object.fromEntries(
    vendors.map(({ name, version }) => [
      counts.get(name) === 1 ? name : `${name}@${version}`,
      pins[`${name}@${version}`],
    ])
  );
}
export function consumerVendorGraph(
  lock,
  manifest,
  effectiveRanges = {},
  localManifests = {}
) {
  const roots = [
    ...new Set([
      ...seeds,
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]),
  ].filter((name) => !name.startsWith('@threadplane/'));
  return lockedVendorGraph(
    lock,
    [...roots, ...Object.keys(localManifests)],
    effectiveRanges,
    localManifests
  );
}
export function installCandidate(
  consumer,
  manifest,
  tarballs,
  rootLock,
  mixed = false,
  effectiveRanges = {}
) {
  const records = localArtifactRecords(tarballs);
  const localManifests = Object.fromEntries(
    Object.entries(records).map(([name, record]) => [name, record.manifest])
  );
  const vendors = lockedVendorGraph(rootLock, seeds, effectiveRanges);
  const consumerVendors = consumerVendorGraph(
    rootLock,
    manifest,
    effectiveRanges,
    localManifests
  );
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        ...manifest,
        // The SDK is a peer of the package: the consumer names it at the
        // locked version, as an application would install it.
        dependencies: {
          '@ag-ui/client': rootLock.packages['node_modules/@ag-ui/client'].version,
          ...manifest.dependencies,
          ...tarballs,
        },
        overrides: {
          ...agUiVendorOverrides(
            consumerVendors.filter(
              ({ name }) => !name.startsWith('@threadplane/')
            )
          ),
          ...Object.fromEntries(
            Object.keys(tarballs).map((name) => [name, `$${name}`])
          ),
        },
      },
      null,
      2
    )
  );
  console.log(
    runConsumer(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      consumer
    )
  );
  const lock = JSON.parse(
    readFileSync(join(consumer, 'package-lock.json'), 'utf8')
  );
  assert.deepEqual(installViolations(lock, Object.keys(tarballs), mixed), []);
  assertLocalResolutions(consumer, lock, tarballs);
  const artifacts = assertInstalledArtifacts(
    consumer,
    Object.fromEntries(
      Object.entries(records).map(([name, record]) => [name, record.files])
    )
  );
  assert.deepEqual(
    lockedVendorGraph(lock, seeds, effectiveRanges),
    vendors,
    'Installed owner preserves its exact locked vendor graph'
  );
  assert.deepEqual(
    lockedVendorGraph(
      lock,
      [
        ...seeds,
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(tarballs),
      ],
      effectiveRanges
    ),
    consumerVendors,
    'Installed framework and type roots preserve their exact locked vendor graph'
  );
  return {
    vendors,
    consumerVendors,
    artifacts,
    effectiveRanges,
    footprint: installFootprint(consumer, lock),
    versions: Object.entries(lock.packages)
      .filter(([path]) => path.includes('node_modules/'))
      .map(([path, pkg]) => ({ path, version: pkg.version })),
  };
}
/** Check package containment and bytes of every installed input. */
export function assertInstalledInputs(consumer, inputs, artifacts) {
  consumer = realpathSync(consumer);
  for (const input of inputs) {
    if (input.startsWith('\0') || input.startsWith('<')) continue;
    const path = realpathSync(resolve(consumer, input));
    assert.ok(
      path.startsWith(consumer + '/'),
      `Input outside installed consumer: ${input}`
    );
    const relativePath = relative(consumer, path);
    const matched = relativePath.match(
      /^node_modules\/(@threadplane\/[^/]+)\/(.+)$/
    );
    if (matched) {
      const [, name, file] = matched;
      const expected = artifacts[name]?.find((record) => record.path === file);
      assert.ok(expected, `Input not in installed artifact: ${input}`);
      assert.ok(
        realpathSync(path).startsWith(
          join(consumer, 'node_modules', name) + '/'
        ),
        'Installed input cannot link to private source'
      );
      assert.equal(
        sha256(readFileSync(path)),
        expected.sha256,
        `Installed artifact bytes differ: ${input}`
      );
    } else
      assert.ok(
        !relativePath.startsWith('libs/') && !relativePath.startsWith('dist/'),
        `Input outside installed artifacts: ${input}`
      );
  }
}
