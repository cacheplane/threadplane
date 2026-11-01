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

test('preserves safe chained links within the private installation', async t => {
  const f = await fixture(t);
  await symlink('dependency', join(f.root, 'node_modules/alias'));
  await symlink('../alias/cli.cjs', join(f.root, 'node_modules/.bin/chained'));
  await createDependencyBundle({ ...f, context });
  const root = await f.checkout('consumer');
  await restoreDependencyBundle({ root, artifactDirectory: f.artifactDirectory, context });
  assert.match(execFileSync(join(root, 'node_modules/.bin/chained'), { encoding: 'utf8' }), /restored executable/);
});

test('rejects cyclic archive link graphs before publishing', async t => {
  const f = await fixture(t);
  await symlink('second', join(f.root, 'node_modules/first'));
  await symlink('first', join(f.root, 'node_modules/second'));
  await assert.rejects(createDependencyBundle({ ...f, context }), /cyclic|link graph/i);
});

test('physical entries avoid redundant path resolution while links retain the data filter', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 30; i++) await writeFile(join(f.root, `node_modules/dependency/file-${i}`), 'dependency');
  await createDependencyBundle({ ...f, context });
  const destination = join(f.directory, 'staging');
  await mkdir(destination);
  const lock = JSON.parse(await readFile(join(f.root, 'package-lock.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(f.artifactDirectory, 'manifest.json'), 'utf8'));
  const policy = { roots: manifest.roots, workspaceLinks: Object.fromEntries(Object.entries(lock.packages)
    .filter(([, value]) => value.link).map(([path, value]) => [path, value.resolved])) };
  execFileSync('python3', ['-c', `
import json,os,runpy,sys,tarfile
helper,archive,destination=sys.argv[1:]
calls=[]
original=os.path.realpath
def counted(*args,**kwargs):
 calls.append(args[0]);return original(*args,**kwargs)
os.path.realpath=counted
sys.argv=[helper,'extract',archive,destination]
runpy.run_path(helper,run_name='__main__')
assert 0 < len(calls) < 20, f'Resolved {len(calls)} paths for three links; physical entries must reuse prevalidation'
`, fileURLToPath(new URL('./cockpit-dependencies-archive.py', import.meta.url)), join(f.artifactDirectory, 'dependencies.tar'), destination], {
    input: JSON.stringify(policy), stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.equal(await readFile(join(destination, 'node_modules/dependency/file-29'), 'utf8'), 'dependency');
});

test('restored files retain the data filter permission and ownership policy', async t => {
  const f = await fixture(t);
  const file = 'node_modules/dependency/cli.cjs';
  await chmod(join(f.root, file), 0o7777);
  await writeFile(join(f.root, 'node_modules/dependency/non-executable'), 'data');
  await chmod(join(f.root, 'node_modules/dependency/non-executable'), 0o441);
  await createDependencyBundle({ ...f, context });
  const root = await f.checkout('consumer');
  await restoreDependencyBundle({ root, artifactDirectory: f.artifactDirectory, context });
  assert.equal((await stat(join(root, file))).mode & 0o7777, 0o755);
  assert.equal((await stat(join(root, 'node_modules/dependency/non-executable'))).mode & 0o7777, 0o640);
  assert.equal((await stat(join(root, file))).uid, process.getuid());
});

for (const attack of ['traversal', 'absolute', 'symlink', 'hardlink', 'special', 'unexpected', 'duplicate', 'duplicate-canonical', 'root-prefix', 'late-file-ancestor', 'late-link-ancestor', 'cached-sibling', 'contiguous', 'sparse', 'linked-ancestor', 'resolved-link', 'resolved-link-first']) {
  test(`rejects ${attack} tar members before publishing, even with a matching archive digest`, async t => {
    const f = await fixture(t);
    await createDependencyBundle({ ...f, context });
    const archive = join(f.artifactDirectory, 'dependencies.tar');
    execFileSync('python3', ['-c', `
import os,tarfile,sys
path,attack,absolute=sys.argv[1:]
with tarfile.open(path) as source, tarfile.open(path+'.attack','w') as t:
 names={'traversal':'node_modules/../../escaped','absolute':absolute,'unexpected':'other/file','root-prefix':'node_modules-other/attack'}
 info=tarfile.TarInfo(names.get(attack,'node_modules/attack'))
 if attack=='symlink':info.type=tarfile.SYMTYPE;info.linkname='../../escaped'
 elif attack=='hardlink':info.type=tarfile.LNKTYPE;info.linkname='../escaped'
 elif attack=='special':info.type=tarfile.FIFOTYPE
 elif attack=='duplicate':info.name='node_modules/dependency/cli.cjs'
 elif attack=='duplicate-canonical':info.name='node_modules//dependency/./cli.cjs'
 elif attack in ['late-file-ancestor','late-link-ancestor','cached-sibling']:
  info.name='node_modules/late/shared'
  for name in (['node_modules/late/safe/first','node_modules/late/shared/second'] if attack=='cached-sibling' else ['node_modules/late/shared/first','node_modules/late/shared/second']):t.addfile(tarfile.TarInfo(name))
  if attack=='late-link-ancestor':info.type=tarfile.SYMTYPE;info.linkname='../dependency'
 elif attack=='contiguous':info.type=tarfile.CONTTYPE
 elif attack=='sparse':info.type=tarfile.GNUTYPE_SPARSE
 elif attack=='linked-ancestor':info.name='node_modules/@fixture/workspace/child'
 elif attack.startswith('resolved-link'):info.type=tarfile.SYMTYPE;info.linkname='@fixture/workspace/../../../node_modules/X'
 if attack=='resolved-link-first':t.addfile(info)
 for item in source.getmembers():t.addfile(item,source.extractfile(item) if item.isfile() else None)
 if attack!='resolved-link-first':t.addfile(info)
os.replace(path+'.attack',path)
`, archive, attack, join(f.directory, 'escaped')]);
    const manifestPath = join(f.artifactDirectory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bytes = await readFile(archive);
    manifest.archive = { ...manifest.archive, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    await writeFile(manifestPath, JSON.stringify(manifest));
    const lock = JSON.parse(await readFile(join(f.root, 'package-lock.json'), 'utf8'));
    const policy = { roots: manifest.roots, workspaceLinks: Object.fromEntries(Object.entries(lock.packages)
      .filter(([, value]) => value.link).map(([path, value]) => [path, value.resolved])) };
    assert.throws(() => execFileSync('python3', ['-I', fileURLToPath(new URL('./cockpit-dependencies-archive.py', import.meta.url)), 'validate', archive], {
      input: JSON.stringify(policy), stdio: ['pipe', 'pipe', 'pipe'],
    }), /archive|member|root|link|path|duplicate|special/i);
    const root = await f.checkout('consumer');
    await assert.rejects(restoreDependencyBundle({ root, artifactDirectory: f.artifactDirectory, context }), /archive|member|root|link|path|duplicate|special/i);
    await assert.rejects(stat(join(root, 'node_modules')), { code: 'ENOENT' });
    await assert.rejects(stat(join(f.directory, 'escaped')), { code: 'ENOENT' });
    assert.deepEqual((await readdir(root)).sort(), ['package-lock.json', 'package.json', 'packages']);
  });
}

test('restores canonical aliases and implicit shared directories across installation roots', async t => {
  const f = await fixture(t);
  await createDependencyBundle({ ...f, context });
  const archive = join(f.artifactDirectory, 'dependencies.tar');
  execFileSync('python3', ['-c', `
import io,os,sys,tarfile
path=sys.argv[1]
with tarfile.open(path) as source,tarfile.open(path+'.shared','w') as target:
 for item in source.getmembers():target.addfile(item,source.extractfile(item) if item.isfile() else None)
 for name in ['node_modules//shared/./branch/first','node_modules/shared/branch/second','packages/workspace/node_modules//shared/./branch/third']:
  item=tarfile.TarInfo(name);item.size=7;target.addfile(item,io.BytesIO(b'private'))
os.replace(path+'.shared',path)
`, archive]);
  const manifestPath = join(f.artifactDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const bytes = await readFile(archive);
  manifest.archive = { ...manifest.archive, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(manifestPath, JSON.stringify(manifest));
  const root = await f.checkout('shared-directories');
  await restoreDependencyBundle({ root, artifactDirectory: f.artifactDirectory, context });
  for (const name of ['node_modules/shared/branch/first', 'node_modules/shared/branch/second', 'packages/workspace/node_modules/shared/branch/third']) {
    assert.equal(await readFile(join(root, name), 'utf8'), 'private');
  }
});

test('validates deep implicit paths without retaining every ancestor prefix', () => {
  execFileSync('python3', ['-c', `
import io,runpy,sys,tarfile,tracemalloc
validate=runpy.run_path(sys.argv[1])['validate']
name='node_modules/'+'a/'*6000+'file'
data=io.BytesIO()
with tarfile.open(fileobj=data,mode='w',format=tarfile.PAX_FORMAT) as archive:
 root=tarfile.TarInfo('node_modules');root.type=tarfile.DIRTYPE;archive.addfile(root)
 archive.addfile(tarfile.TarInfo(name))
with tarfile.open(fileobj=io.BytesIO(data.getvalue()),mode='r:') as archive:
 tracemalloc.start()
 members=validate(archive,{'roots':['node_modules'],'workspaceLinks':{}})
 peak=tracemalloc.get_traced_memory()[1]
 tracemalloc.stop()
assert [member.name for member in members]==['node_modules',name]
# A 12 KiB implicit path must not retain tens of MiB of decreasing prefixes.
assert peak<8*1024*1024, f'Validation retained {peak} bytes for a {len(name)} byte path'
`, fileURLToPath(new URL('./cockpit-dependencies-archive.py', import.meta.url))], { stdio: ['ignore', 'pipe', 'pipe'] });
});

test('matches independent pathlib ancestry rules on seeded real-tar path and root variants', () => {
  execFileSync('python3', ['-I', '-c', `
import io,random,runpy,sys,tarfile
from pathlib import PurePosixPath
validate=runpy.run_path(sys.argv[1])['validate']
rng=random.Random(1739)
def reference(members,roots):
 seen={}
 for member in members:
  path=PurePosixPath(member.name)
  if path.is_absolute() or '..' in path.parts or chr(92) in member.name:return False
  name=str(path)
  if not any(name==root or name.startswith(root+'/') for root in roots) or name in seen:return False
  seen[name]=member
 for name in seen:
  for parent in PurePosixPath(name).parents:
   ancestor=seen.get(str(parent))
   if ancestor and not ancestor.isdir():return False
 return all(root in seen and seen[root].isdir() for root in roots)
accepted=rejected=0
for index in range(320):
 roots=['node_modules','packages/workspace/node_modules']
 if index%3==0:roots.append('node_modules/nested/node_modules')
 if index%11==0:roots.append('.')
 entries=[(root,tarfile.DIRTYPE) for root in roots]
 for item in range(8):
  root=rng.choice(roots[:2]);alias='//shared/./branch/' if rng.randrange(2) else '/shared/branch/'
  entries.append((root+alias+'leaf-'+str(item),tarfile.REGTYPE))
 if index%2:
  attack=index%5
  if attack==0:entries.append(('node_modules-other/file',tarfile.REGTYPE))
  elif attack==1:entries.append(('node_modules//shared/./branch/leaf-0',tarfile.REGTYPE));entries.append(('node_modules/shared/branch/leaf-0',tarfile.REGTYPE))
  elif attack==2:entries.append(('node_modules/../escaped',tarfile.REGTYPE))
  elif attack==3:entries.append(('node_modules/shared/branch',tarfile.REGTYPE))
  else:entries.append(('/absolute/file',tarfile.REGTYPE))
 rng.shuffle(entries)
 data=io.BytesIO()
 with tarfile.open(fileobj=data,mode='w') as archive:
  for name,kind in entries:
   member=tarfile.TarInfo(name);member.type=kind;archive.addfile(member)
 payload=data.getvalue()
 with tarfile.open(fileobj=io.BytesIO(payload),mode='r:') as archive:
  members=archive.getmembers();expected=reference(members,roots);names=[m.name for m in members]
 with tarfile.open(fileobj=io.BytesIO(payload),mode='r:') as archive:
  try:actual=validate(archive,{'roots':roots,'workspaceLinks':{}})
  except ValueError:
   assert not expected, (index,'unexpected rejection');rejected+=1
  else:
   assert expected and [m.name for m in actual]==names, (index,'unexpected acceptance or changed members');accepted+=1
assert accepted>0 and rejected>0,(accepted,rejected)
print(accepted,rejected)
`, fileURLToPath(new URL('./cockpit-dependencies-archive.py', import.meta.url))], { stdio: ['ignore', 'pipe', 'pipe'] });
});
