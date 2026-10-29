import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  getCockpitFrontends,
  type CockpitFrontendDeployment,
} from '@threadplane/cockpit-registry';
import { generateRuntimeParentOriginPolicy } from './generate-runtime-parent-origins';
import {
  EXAMPLE_BUILD_SHARDS,
  exampleArtifactName,
  exampleManifestPath,
  selectExampleBuildShard,
  writeExampleBuildManifest,
  restoreExampleBuildArtifacts,
} from './example-build-artifacts';

const revision = 'a'.repeat(40);
const policy = (preview = 'https://threadplane-pr-1-cacheplane.vercel.app') =>
  generateRuntimeParentOriginPolicy(
    { baseOrigins: ['https://threadplane.ai'] },
    [preview]
  );
const frontends: CockpitFrontendDeployment[] = Array.from(
  { length: 8 },
  (_, i) => {
    const frontend = i % 2 ? 'react' : 'angular';
    const topic = `topic-${Math.floor(i / 2)}`;
    return {
      frontend,
      product: 'render',
      topic,
      project: `${topic}-${frontend}`,
      port: 4000 + i,
      runtimePath: `render/${topic}/${frontend}`,
      buildOutput: `dist/cockpit/render/${topic}/${frontend}`,
    };
  }
);

it('builds every registered frontend exactly once and keeps peer frameworks together', () => {
  const registry = getCockpitFrontends();
  const groups = Array.from({ length: EXAMPLE_BUILD_SHARDS }, (_, i) =>
    selectExampleBuildShard(registry, i + 1)
  );
  expect(
    groups
      .flat()
      .map((f) => f.project)
      .sort()
  ).toEqual(registry.map((f) => f.project).sort());
  expect(groups.every((group) => group.length > 0)).toBe(true);
  for (const group of groups)
    for (const frontend of group) {
      expect(
        group.filter(
          (f) => f.product === frontend.product && f.topic === frontend.topic
        )
      ).toEqual(
        registry.filter(
          (f) => f.product === frontend.product && f.topic === frontend.topic
        )
      );
    }
});

it.each([0, 5, -1, 1.5, NaN])(
  'rejects invalid shard %s before building',
  (shard) => {
    expect(() => selectExampleBuildShard(frontends, shard)).toThrow(/shard/i);
  }
);

describe('preview build artifacts', () => {
  let root: string;
  let downloads: string;
  const artifact = (shard: number) =>
    join(downloads, exampleArtifactName(shard));
  const file = (frontend: CockpitFrontendDeployment) =>
    join(artifact(1), frontend.buildOutput, 'index.html');
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'example-artifacts-'));
    downloads = join(root, 'downloads');
    for (let shard = 1; shard <= EXAMPLE_BUILD_SHARDS; shard++) {
      for (const frontend of selectExampleBuildShard(frontends, shard)) {
        const output = join(artifact(shard), frontend.buildOutput);
        mkdirSync(join(output, 'assets'), { recursive: true });
        writeFileSync(
          join(output, 'index.html'),
          `<html>${frontend.project}</html>`
        );
        writeFileSync(
          join(output, 'assets/main.js'),
          `console.log('${frontend.project}')`
        );
        if (frontend.frontend === 'react')
          writeFileSync(
            join(output, 'build-proof.json'),
            '{"frontend":"react"}'
          );
      }
      writeExampleBuildManifest(
        artifact(shard),
        shard,
        frontends,
        policy(),
        revision
      );
    }
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('restores the complete checked outputs and retains internal React proofs', () => {
    restoreExampleBuildArtifacts(
      root,
      downloads,
      frontends,
      policy(),
      revision
    );
    for (const frontend of frontends) {
      expect(
        readFileSync(join(root, frontend.buildOutput, 'index.html'), 'utf8')
      ).toContain(frontend.project);
      if (frontend.frontend === 'react')
        expect(
          existsSync(join(root, frontend.buildOutput, 'build-proof.json'))
        ).toBe(true);
    }
  });

  it.each([
    'missing shard',
    'extra shard',
    'wrong revision',
    'wrong policy',
    'missing project',
    'changed file',
    'extra file',
    'missing proof',
    'overlapping artifact',
    'symlink',
  ])('rejects %s before changing existing outputs', (scenario) => {
    const existing = join(root, frontends[0].buildOutput, 'index.html');
    mkdirSync(dirname(existing), { recursive: true });
    writeFileSync(existing, 'existing output');
    const manifestPath = join(artifact(1), exampleManifestPath(1));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (scenario === 'missing shard') rmSync(artifact(4), { recursive: true });
    if (scenario === 'extra shard') mkdirSync(join(downloads, 'unexpected'));
    if (scenario === 'wrong revision') manifest.revision = 'b'.repeat(40);
    if (scenario === 'missing project') manifest.projects.pop();
    if (scenario === 'changed file')
      writeFileSync(file(frontends[0]), 'changed');
    if (scenario === 'extra file')
      writeFileSync(
        join(artifact(1), frontends[0].buildOutput, 'extra.js'),
        'unexpected'
      );
    if (scenario === 'missing proof')
      rmSync(join(artifact(1), frontends[1].buildOutput, 'build-proof.json'));
    if (scenario === 'overlapping artifact')
      cpSync(
        join(artifact(2), frontends[2].buildOutput),
        join(artifact(1), frontends[2].buildOutput),
        { recursive: true }
      );
    if (scenario === 'symlink')
      symlinkSync(
        file(frontends[0]),
        join(artifact(1), frontends[0].buildOutput, 'link.js')
      );
    if (scenario === 'wrong revision' || scenario === 'missing project')
      writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() =>
      restoreExampleBuildArtifacts(
        root,
        downloads,
        frontends,
        scenario === 'wrong policy'
          ? policy('https://threadplane-pr-2-cacheplane.vercel.app')
          : policy(),
        revision
      )
    ).toThrow();
    expect(readFileSync(existing, 'utf8')).toBe('existing output');
  });

  it('refuses to emit a manifest for incomplete output', () => {
    rmSync(file(frontends[0]));
    rmSync(join(artifact(1), exampleManifestPath(1)));
    expect(() =>
      writeExampleBuildManifest(artifact(1), 1, frontends, policy(), revision)
    ).toThrow(/index.html/);
    expect(existsSync(join(artifact(1), exampleManifestPath(1)))).toBe(false);
  });
});
