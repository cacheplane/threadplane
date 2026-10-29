import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { CockpitFrontendDeployment } from '@threadplane/cockpit-registry';
import type { RuntimeParentOriginPolicy } from './generate-runtime-parent-origins';

export const EXAMPLE_BUILD_SHARDS = 4;

function assertShard(shard: number) {
  assert.ok(
    Number.isInteger(shard) && shard >= 1 && shard <= EXAMPLE_BUILD_SHARDS,
    'Invalid example build shard'
  );
}

export function exampleArtifactName(shard: number) {
  assertShard(shard);
  return `website-preview-examples-${shard}`;
}

export function exampleManifestPath(shard: number) {
  assertShard(shard);
  return join('output', 'website-preview-builds', `shard-${shard}.json`);
}

/** Partition capabilities so peer frameworks share a shard and none are lost. */
export function selectExampleBuildShard(
  frontends: readonly CockpitFrontendDeployment[],
  shard: number
) {
  assertShard(shard);
  assert.equal(
    new Set(frontends.map((f) => f.project)).size,
    frontends.length,
    'Duplicate example project'
  );
  const key = (frontend: CockpitFrontendDeployment) =>
    `${frontend.product}/${frontend.topic}`;
  const keys = [...new Set(frontends.map(key))].sort();
  return frontends.filter(
    (frontend) =>
      keys.indexOf(key(frontend)) % EXAMPLE_BUILD_SHARDS === shard - 1
  );
}

const hash = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

function outputPath(root: string, frontend: CockpitFrontendDeployment) {
  const output = resolve(root, frontend.buildOutput);
  assert.ok(
    output.startsWith(resolve(root, 'dist/cockpit') + sep),
    'Example output must be inside dist/cockpit'
  );
  return output;
}

/** Include hidden files and reject links instead of following them off-tree. */
function filesIn(directory: string, prefix = ''): string[] {
  assert.ok(
    lstatSync(directory).isDirectory(),
    `Expected build directory: ${directory}`
  );
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const path = join(directory, name);
      const info = lstatSync(path);
      assert.ok(
        !info.isSymbolicLink(),
        `Symbolic link in example artifact: ${path}`
      );
      if (info.isDirectory()) return filesIn(path, join(prefix, name));
      assert.ok(info.isFile(), `Unexpected example artifact entry: ${path}`);
      return [join(prefix, name)];
    });
}

function buildManifest(
  root: string,
  shard: number,
  frontends: readonly CockpitFrontendDeployment[],
  policy: RuntimeParentOriginPolicy,
  revision: string
) {
  assert.match(revision, /^[a-f0-9]{40}$/, 'Invalid example build revision');
  const selected = selectExampleBuildShard(frontends, shard);
  assert.ok(selected.length > 0, 'Empty example build shard');
  return {
    schemaVersion: 1,
    shard,
    revision,
    policySha256: hash(JSON.stringify(policy)),
    projects: selected.map((frontend) => {
      const output = outputPath(root, frontend);
      const files = filesIn(output);
      assert.ok(
        files.includes('index.html'),
        `Missing index.html for ${frontend.project}`
      );
      if (frontend.frontend === 'react')
        assert.ok(
          files.includes('build-proof.json'),
          `Missing build-proof.json for ${frontend.project}`
        );
      return {
        project: frontend.project,
        files: Object.fromEntries(
          files.map((file) => [file, hash(readFileSync(join(output, file)))])
        ),
      };
    }),
  };
}

/** Emit only after the complete shard has built successfully. */
export function writeExampleBuildManifest(
  root: string,
  shard: number,
  frontends: readonly CockpitFrontendDeployment[],
  policy: RuntimeParentOriginPolicy,
  revision: string
) {
  const manifest = buildManifest(root, shard, frontends, policy, revision);
  const path = join(root, exampleManifestPath(shard));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
}

/** Validate separate archives completely before replacing any local outputs. */
export function restoreExampleBuildArtifacts(
  root: string,
  downloads: string,
  frontends: readonly CockpitFrontendDeployment[],
  policy: RuntimeParentOriginPolicy,
  revision: string
) {
  const shards = Array.from({ length: EXAMPLE_BUILD_SHARDS }, (_, i) => i + 1);
  assert.deepEqual(
    readdirSync(downloads).sort(),
    shards.map(exampleArtifactName).sort(),
    'Missing or unexpected example build artifacts'
  );
  for (const shard of shards) {
    const artifact = join(downloads, exampleArtifactName(shard));
    const expected = buildManifest(
      artifact,
      shard,
      frontends,
      policy,
      revision
    );
    const manifest = JSON.parse(
      readFileSync(join(artifact, exampleManifestPath(shard)), 'utf8')
    );
    assert.deepEqual(
      manifest,
      expected,
      `Example build shard ${shard} does not match its revision, policy, projects or files`
    );
    const selected = selectExampleBuildShard(frontends, shard);
    const expectedFiles = [
      exampleManifestPath(shard),
      ...expected.projects.flatMap((project, index) =>
        Object.keys(project.files).map((file) =>
          join(relative(artifact, outputPath(artifact, selected[index])), file)
        )
      ),
    ].sort();
    assert.deepEqual(
      filesIn(artifact).sort(),
      expectedFiles,
      `Unexpected files in example build artifact ${shard}`
    );
  }
  for (const shard of shards)
    for (const frontend of selectExampleBuildShard(frontends, shard)) {
      const source = outputPath(
        join(downloads, exampleArtifactName(shard)),
        frontend
      );
      const destination = outputPath(root, frontend);
      rmSync(destination, { recursive: true, force: true });
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(source, destination, { recursive: true });
    }
}
