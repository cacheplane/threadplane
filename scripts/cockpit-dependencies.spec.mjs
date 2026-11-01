import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDependencyBundle, restoreDependencyBundle } from './cockpit-dependencies.mjs';

const context = {
  repository: 'fixture/repository', runId: '123', attempt: '2',
  sha: 'a'.repeat(40), tree: 'b'.repeat(40),
  runtime: { node: process.version, abi: process.versions.modules, npm: '10.9.2', platform: process.platform, arch: process.arch, os: 'fixture' },
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cockpit-dependencies-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'producer');
  const artifactDirectory = join(directory, 'artifact');
  const packageJson = { private: true, workspaces: ['packages/*'] };
  const workspace = { name: '@fixture/workspace', version: '1.0.0' };
  const lock = { lockfileVersion: 3, packages: {
    '': packageJson, 'packages/workspace': workspace,
    'node_modules/@fixture/workspace': { resolved: 'packages/workspace', link: true },
    'node_modules/dependency': { version: '1.0.0' },
    'node_modules/dependency/node_modules/child': { version: '1.0.0' },
    'packages/workspace/node_modules/nested': { version: '2.0.0' },
  } };
  const inputs = { 'package.json': packageJson, 'package-lock.json': lock, 'packages/workspace/package.json': workspace };
  async function checkout(name) {
    const target = join(directory, name);
    for (const [file, value] of Object.entries(inputs)) {
      await mkdir(join(target, file, '..'), { recursive: true });
      await writeFile(join(target, file), JSON.stringify(value));
    }
    return target;
  }
  await checkout('producer');
  for (const path of ['node_modules/dependency', 'node_modules/.bin', 'node_modules/@fixture', 'packages/workspace/node_modules/nested']) {
    await mkdir(join(root, path), { recursive: true });
  }
  await writeFile(join(root, 'node_modules/dependency/cli.cjs'), '#!/usr/bin/env node\nconsole.log("restored executable");\n');
  await chmod(join(root, 'node_modules/dependency/cli.cjs'), 0o755);
  await link(join(root, 'node_modules/dependency/cli.cjs'), join(root, 'node_modules/dependency/cli-copy.cjs'));
  await writeFile(join(root, 'packages/workspace/node_modules/nested/value.txt'), 'nested dependency');
  await symlink('../dependency/cli.cjs', join(root, 'node_modules/.bin/dependency'));
  await symlink('../../packages/workspace', join(root, 'node_modules/@fixture/workspace'));
  await writeFile(join(root, '.env'), 'PRIVATE_CANARY=must-not-be-archived');
  return { directory, root, artifactDirectory, checkout };
}

test('restores root and nested installations, executable bins and workspace links as private copies', async t => {
  const f = await fixture(t);
  await createDependencyBundle({ ...f, context });
  const first = await f.checkout('first');
  const second = await f.checkout('second');
  for (const root of [first, second]) {
    await restoreDependencyBundle({ root, artifactDirectory: f.artifactDirectory, context });
    assert.match(execFileSync(join(root, 'node_modules/.bin/dependency'), { encoding: 'utf8' }), /restored executable/);
    assert.equal(await readFile(join(root, 'node_modules/@fixture/workspace/node_modules/nested/value.txt'), 'utf8'), 'nested dependency');
    assert.equal((await stat(join(root, 'node_modules/dependency/cli.cjs'))).mode & 0o111, 0o111);
    assert.match(await readFile(join(root, 'node_modules/dependency/cli-copy.cjs'), 'utf8'), /restored executable/);
    await assert.rejects(readFile(join(root, '.env')), { code: 'ENOENT' });
  }
  await writeFile(join(first, 'packages/workspace/node_modules/nested/value.txt'), 'mutated by one cap');
  await writeFile(join(first, 'node_modules/dependency/cli.cjs'), 'mutated');
  assert.equal(await readFile(join(second, 'packages/workspace/node_modules/nested/value.txt'), 'utf8'), 'nested dependency');
  assert.match(await readFile(join(second, 'node_modules/dependency/cli.cjs'), 'utf8'), /restored executable/);
  assert.match(await readFile(join(f.root, 'node_modules/dependency/cli.cjs'), 'utf8'), /restored executable/);
});

test('allows a failed-job rerun to use its successful earlier producer, but rejects future attempts', async t => {
  const f = await fixture(t);
  await createDependencyBundle({ ...f, context });
  await restoreDependencyBundle({ root: await f.checkout('retry'), artifactDirectory: f.artifactDirectory, context: { ...context, attempt: '3' }, producerAttempt: '2' });
  await assert.rejects(restoreDependencyBundle({ root: await f.checkout('past'), artifactDirectory: f.artifactDirectory, context: { ...context, attempt: '1' } }), /attempt/i);
});

test('requires the exact producer attempt named by the dispatcher', async t => {
  const f = await fixture(t);
  await createDependencyBundle({ ...f, context });
  await assert.rejects(restoreDependencyBundle({ root: await f.checkout('consumer'), artifactDirectory: f.artifactDirectory,
    context: { ...context, attempt: '3' }, producerAttempt: '1' }), /attempt/i);
});

test('actual CLI binds both checkouts to Git and preserves a failed-job rerun', async t => {
  const f = await fixture(t);
  const consumer = await f.checkout('consumer');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  const git = (root, args) => execFileSync('git', ['-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env, encoding: 'utf8' }).trim();
  for (const root of [f.root, consumer]) {
    git(root, ['init', '--quiet']);
    git(root, ['add', 'package.json', 'package-lock.json', 'packages/workspace/package.json']);
    git(root, ['commit', '--quiet', '-m', 'fixture']);
  }
  const sha = git(f.root, ['rev-parse', 'HEAD']);
  assert.equal(git(consumer, ['rev-parse', 'HEAD']), sha);
  Object.assign(env, { GITHUB_SHA: sha, GITHUB_REPOSITORY: context.repository, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' });
  const script = fileURLToPath(new URL('./cockpit-dependencies.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [script, 'pack', f.artifactDirectory], {
    cwd: f.root, env: { ...env, GITHUB_SHA: 'f'.repeat(40) }, stdio: 'pipe',
  }), /workflow source/);
  execFileSync(process.execPath, [script, 'pack', f.artifactDirectory], { cwd: f.root, env, stdio: 'pipe' });
  assert.throws(() => execFileSync(process.execPath, [script, 'restore', f.artifactDirectory], {
    cwd: consumer, env: { ...env, GITHUB_RUN_ATTEMPT: '3', COCKPIT_DEPENDENCY_PRODUCER_ATTEMPT: '1' }, stdio: 'pipe',
  }), /attempt/i);
  await writeFile(join(f.artifactDirectory, 'canary'), 'keep unrelated files');
  execFileSync(process.execPath, [script, 'restore', f.artifactDirectory], {
    cwd: consumer, env: { ...env, GITHUB_RUN_ATTEMPT: '3', COCKPIT_DEPENDENCY_PRODUCER_ATTEMPT: '2' }, stdio: 'pipe',
  });
  assert.match(execFileSync(join(consumer, 'node_modules/.bin/dependency'), { encoding: 'utf8' }), /restored executable/);
  assert.equal(await readFile(join(f.artifactDirectory, 'canary'), 'utf8'), 'keep unrelated files');
  await assert.rejects(stat(join(f.artifactDirectory, 'dependencies.tar')), { code: 'ENOENT' });
  await assert.rejects(stat(join(f.artifactDirectory, 'manifest.json')), { code: 'ENOENT' });
});

for (const [name, changes] of [
  ['source commit', { sha: 'c'.repeat(40) }], ['source tree', { tree: 'c'.repeat(40) }],
  ['repository', { repository: 'another/repository' }], ['run', { runId: '456' }],
  ...['node', 'abi', 'npm', 'platform', 'arch', 'os'].map(key => [key, { runtime: { ...context.runtime, [key]: 'incompatible' } }]),
]) test(`rejects mismatched ${name} before installing any dependency tree`, async t => {
  const f = await fixture(t);
  await createDependencyBundle({ ...f, context });
  const root = await f.checkout('consumer');
  await assert.rejects(restoreDependencyBundle({ root, artifactDirectory: f.artifactDirectory, context: { ...context, ...changes } }), /mismatch|incompatible/i);
  await assert.rejects(stat(join(root, 'node_modules')), { code: 'ENOENT' });
});

test('rejects changed lockfiles and workspace manifests, preserving the pristine checkout', async t => {
  const f = await fixture(t);
  await createDependencyBundle({ ...f, context });
  for (const file of ['package-lock.json', 'package.json', '.npmrc', 'packages/workspace/package.json']) {
    const root = await f.checkout(file.replaceAll('/', '-'));
    await writeFile(join(root, file), '{}');
    await assert.rejects(restoreDependencyBundle({ root, artifactDirectory: f.artifactDirectory, context }), /input|lock|workspace/i);
    await assert.rejects(stat(join(root, 'node_modules')), { code: 'ENOENT' });
  }
});

test('does not overwrite an existing installation or accept a corrupt archive', async t => {
  const f = await fixture(t);
  await createDependencyBundle({ ...f, context });
  const root = await f.checkout('consumer');
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'node_modules/canary'), 'keep');
  await assert.rejects(restoreDependencyBundle({ root, artifactDirectory: f.artifactDirectory, context }), /exists|existing/i);
  assert.equal(await readFile(join(root, 'node_modules/canary'), 'utf8'), 'keep');
  await rm(join(root, 'node_modules'), { recursive: true });
  await writeFile(join(f.artifactDirectory, 'dependencies.tar'), 'corrupt');
  await assert.rejects(restoreDependencyBundle({ root, artifactDirectory: f.artifactDirectory, context }), /integrity|digest|size/i);
  await assert.rejects(stat(join(root, 'node_modules')), { code: 'ENOENT' });
});

test('rejects workspace lifecycle side effects outside the installed dependency trees', async t => {
  const f = await fixture(t);
  const path = join(f.root, 'packages/workspace/package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...pkg, scripts: { postinstall: 'node install/postinstall.cjs' } }));
  await mkdir(join(f.root, 'packages/workspace/install'));
  await writeFile(join(f.root, 'packages/workspace/install/postinstall.cjs'), '// inert contributor stub\n');
  await createDependencyBundle({ ...f, context });
  await rm(f.artifactDirectory, { recursive: true });
  await writeFile(join(f.root, 'packages/workspace/install/postinstall.cjs'), 'require("fs").writeFileSync("generated", "side effect");');
  await assert.rejects(createDependencyBundle({ ...f, context }), /lifecycle|hook|side.effect/i);
});

test('does not publish dependencies through a workspace parent outside the checkout', async t => {
  const f = await fixture(t);
  const outside = join(f.directory, 'outside');
  await rename(join(f.root, 'packages/workspace'), outside);
  await symlink(outside, join(f.root, 'packages/workspace'));
  await assert.rejects(createDependencyBundle({ ...f, context }), /parent|symlink/i);
  await assert.rejects(stat(f.artifactDirectory), { code: 'ENOENT' });
});

for (const [name, terminator] of [['CR', '\r'], ['LS', '\u2028'], ['PS', '\u2029']]) {
  test(`does not hide executable lifecycle code after a ${name} line terminator`, async t => {
    const f = await fixture(t);
    const path = join(f.root, 'packages/workspace/package.json');
    const pkg = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...pkg, scripts: { postinstall: 'node install/postinstall.cjs' } }));
    await mkdir(join(f.root, 'packages/workspace/install'));
    const code = `// contributor stub${terminator}globalThis.lifecycleExecuted = true;`;
    const sandbox = {};
    runInNewContext(code, sandbox);
    assert.equal(sandbox.lifecycleExecuted, true, 'this is executable JavaScript, not an inert comment');
    await writeFile(join(f.root, 'packages/workspace/install/postinstall.cjs'), code);
    await assert.rejects(createDependencyBundle({ ...f, context }), /lifecycle|side.effect/i);
  });
}

for (const attack of ['traversal', 'absolute', 'symlink', 'hardlink', 'special', 'unexpected', 'duplicate']) {
  test(`rejects ${attack} tar members before extraction, even with a matching archive digest`, async t => {
    const f = await fixture(t);
    await createDependencyBundle({ ...f, context });
    const archive = join(f.artifactDirectory, 'dependencies.tar');
    execFileSync('python3', ['-c', `
import os,tarfile,sys
path,attack,absolute=sys.argv[1:]
with tarfile.open(path) as source, tarfile.open(path+'.attack','w') as t:
 for item in source.getmembers():t.addfile(item,source.extractfile(item) if item.isfile() else None)
 names={'traversal':'node_modules/../../escaped','absolute':absolute,'unexpected':'other/file'}
 info=tarfile.TarInfo(names.get(attack,'node_modules/attack'))
 if attack=='symlink':info.type=tarfile.SYMTYPE;info.linkname='../../escaped'
 elif attack=='hardlink':info.type=tarfile.LNKTYPE;info.linkname='../escaped'
 elif attack=='special':info.type=tarfile.FIFOTYPE
 elif attack=='duplicate':info.name='node_modules/dependency/cli.cjs'
 t.addfile(info)
os.replace(path+'.attack',path)
`, archive, attack, join(f.directory, 'escaped')]);
    const manifestPath = join(f.artifactDirectory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bytes = await readFile(archive);
    manifest.archive = { ...manifest.archive, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    await writeFile(manifestPath, JSON.stringify(manifest));
    const root = await f.checkout('consumer');
    await assert.rejects(restoreDependencyBundle({ root, artifactDirectory: f.artifactDirectory, context }), /archive|member|root|link|path|duplicate|special/i);
    await assert.rejects(stat(join(root, 'node_modules')), { code: 'ENOENT' });
    await assert.rejects(stat(join(f.directory, 'escaped')), { code: 'ENOENT' });
    assert.deepEqual((await readdir(root)).sort(), ['package-lock.json', 'package.json', 'packages']);
  });
}
