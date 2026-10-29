#!/usr/bin/env npx tsx
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCockpitFrontends } from '@threadplane/cockpit-registry';
import {
  selectExampleBuildShard,
  writeExampleBuildManifest,
} from './example-build-artifacts';
import {
  GENERATED_RUNTIME_PARENT_ORIGINS_MODULE,
  generateRuntimeParentOriginPolicy,
  parseRuntimeParentPreviewOrigins,
} from './generate-runtime-parent-origins';

const root = resolve(__dirname, '..');
const shard = Number(process.argv[2]);
const frontends = getCockpitFrontends();
const selected = selectExampleBuildShard(frontends, shard);
assert.ok(selected.length > 0, 'Empty example build shard');
const policy = generateRuntimeParentOriginPolicy(
  JSON.parse(
    readFileSync(resolve(root, 'runtime-parent-origins.json'), 'utf8')
  ),
  parseRuntimeParentPreviewOrigins(
    process.env['RUNTIME_PARENT_PREVIEW_ORIGINS']
  )
);
writeFileSync(
  resolve(root, GENERATED_RUNTIME_PARENT_ORIGINS_MODULE),
  policy.compiledChildModule
);
console.log(
  `Building example shard ${shard}: ${selected.length} registered frontends`
);
execFileSync(
  'npx',
  [
    'nx',
    'run-many',
    '-t',
    'build',
    `--projects=${selected.map((f) => f.project).join(',')}`,
    '--skip-nx-cache',
  ],
  { cwd: root, stdio: 'inherit' }
);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
writeExampleBuildManifest(root, shard, frontends, policy, revision);
