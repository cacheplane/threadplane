#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, realpathSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { pipeline } from 'node:stream/promises';

const archiveHelper = fileURLToPath(new URL('./cockpit-dependencies-archive.py', import.meta.url));
const lifecycleHooks = new Set(['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare', 'dependencies']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const maxArchiveBytes = 16 * 1024 ** 3;
const maxTransportBytes = 8 * 1024 ** 3;
const exists = async path => {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};

function repoPath(path) {
  assert.equal(typeof path, 'string', 'Invalid dependency root');
  assert.ok(path && !isAbsolute(path) && !path.includes('\\') && !path.split('/').includes('..'), 'Invalid dependency root path');
  assert.equal(posix.normalize(path), path, 'Noncanonical dependency root path');
  return path;
}

function inputs(root) {
  const lock = json(join(root, 'package-lock.json'));
  assert.ok(lock.packages?.[''], 'Expected workspace package lock');
  const workspaceLinks = Object.fromEntries(Object.entries(lock.packages)
    .filter(([, entry]) => entry.link)
    .map(([path, entry]) => [repoPath(path), repoPath(entry.resolved)]));
  const workspaces = [...new Set(Object.values(workspaceLinks))].sort();
  const files = ['package.json', 'package-lock.json'];
  const roots = new Set(['node_modules']);
  for (const path of Object.keys(lock.packages)) {
    if (path.startsWith('node_modules/')) continue;
    const index = path.indexOf('/node_modules/');
    if (index > 0) roots.add(repoPath(path.slice(0, index) + '/node_modules'));
  }
  for (const workspace of ['', ...workspaces]) {
    const file = posix.join(workspace, 'package.json');
    if (workspace) files.push(file);
    const pkg = json(join(root, file));
    assert.ok(!existsSync(join(root, workspace, 'binding.gyp')), 'Unreproducible workspace install lifecycle');
    for (const [hook, command] of Object.entries(pkg.scripts ?? {})) {
      if (!lifecycleHooks.has(hook)) continue;
      assert.ok(workspace && hook === 'postinstall' && command === 'node install/postinstall.cjs', `Unsupported workspace lifecycle hook: ${file} ${hook}`);
      const stub = posix.join(workspace, 'install/postinstall.cjs');
      const lines = readFileSync(join(root, stub), 'utf8').split(/\r\n|[\r\n\u2028\u2029]/u);
      assert.ok(lines.every(line => !line.trim() || line.trimStart().startsWith('//')), 'Workspace lifecycle hook has side effects');
      files.push(stub);
    }
    for (const [name, bin] of Object.entries(typeof pkg.bin === 'string' ? { [pkg.name?.split('/').at(-1)]: pkg.bin } : pkg.bin ?? {})) {
      workspaceLinks[`node_modules/.bin/${repoPath(name)}`] = repoPath(posix.join(workspace, repoPath(bin)));
    }
  }
  if (existsSync(join(root, '.npmrc'))) files.push('.npmrc');
  return {
    roots: [...roots].sort(), workspaceLinks,
    hash: sha256(JSON.stringify(files.sort().map(path => [path, sha256(readFileSync(join(root, path)))]))),
  };
}

function validateContext(context) {
  assert.match(context.repository ?? '', /^[\w.-]+\/[\w.-]+$/, 'Invalid repository provenance');
  for (const key of ['runId', 'attempt']) assert.match(context[key] ?? '', /^[1-9][0-9]*$/, `Invalid ${key} provenance`);
  for (const key of ['sha', 'tree']) assert.match(context[key] ?? '', /^[a-f0-9]{40}$/, `Invalid ${key} provenance`);
  assert.ok(context.runtime && Object.keys(context.runtime).length > 0, 'Missing runtime provenance');
}

async function archiveDigest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

function validateDescriptor(descriptor, limit) {
  assert.ok(descriptor && Number.isSafeInteger(descriptor.bytes) && descriptor.bytes > 0 && descriptor.bytes <= limit, 'Invalid dependency archive bytes or size limit');
  assert.match(descriptor.sha256 ?? '', /^[a-f0-9]{64}$/, 'Invalid dependency archive digest');
}

async function expandTransport(source, destination, expected) {
  const hash = createHash('sha256');
  let bytes = 0;
  let errors = '';
  const decoder = spawn('zstd', ['-q', '-d', '-c', '-M128MB', source], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, killSignal: 'SIGKILL' });
  decoder.stderr.on('data', chunk => { errors += chunk.toString().slice(0, Math.max(0, 16384 - errors.length)); });
  const completed = new Promise((resolve, reject) => {
    decoder.once('error', reject);
    decoder.once('close', code => code === 0 ? resolve() : reject(new Error(`Dependency decompression failed (${code}): ${errors}`)));
  });
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  const written = pipeline(decoder.stdout, async function* (chunks) {
    for await (const chunk of chunks) {
      bytes += chunk.length;
      assert.ok(bytes <= expected.bytes, 'Dependency decompression exceeds declared archive size');
      hash.update(chunk);
      yield chunk;
    }
  }, output);
  try {
    await Promise.all([completed, written]);
  } catch (error) {
    decoder.kill('SIGKILL');
    decoder.stdout.destroy();
    output.destroy();
    await Promise.allSettled([completed, written]);
    throw error;
  }
  assert.equal(bytes, expected.bytes, 'Dependency expanded archive size mismatch');
  assert.equal(hash.digest('hex'), expected.sha256, 'Dependency expanded archive digest mismatch');
}

function archiveOperation(mode, archive, policy, destination) {
  execFileSync('python3', ['-I', archiveHelper, mode, archive, ...(destination ? [destination] : [])], {
    input: JSON.stringify(policy), encoding: 'utf8', timeout: 600000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function createDependencyBundle({ root, artifactDirectory, context, transport = 'tar' }) {
  validateContext(context);
  assert.ok(['tar', 'zstd'].includes(transport), 'Unsupported dependency transport format');
  root = realpathSync(root);
  const source = inputs(root);
  const roots = source.roots.filter(path => existsSync(join(root, path)));
  assert.ok(roots.includes('node_modules'), 'Missing installed node_modules');
  for (const path of roots) {
    assert.equal(realpathSync(dirname(join(root, path))), dirname(join(root, path)), 'Dependency parent must not be a symlink');
    assert.ok((await lstat(join(root, path))).isDirectory(), 'Installation root must be a physical directory');
  }
  artifactDirectory = resolve(artifactDirectory);
  for (const path of roots) assert.ok(!artifactDirectory.startsWith(join(root, path) + sep), 'Artifact directory is inside installation');
  await mkdir(artifactDirectory);
  try {
    const archive = join(artifactDirectory, 'dependencies.tar');
    execFileSync('tar', ['-cf', archive, '-C', root, '--', ...roots], {
      timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    archiveOperation('validate', archive, { roots, workspaceLinks: source.workspaceLinks });
    const manifest = {
      schema: 1, context, inputs: source.hash, roots,
      archive: { bytes: (await stat(archive)).size, sha256: await archiveDigest(archive) },
    };
    validateDescriptor(manifest.archive, maxArchiveBytes);
    if (transport === 'zstd') {
      const compressed = join(artifactDirectory, 'dependencies.tar.zst');
      execFileSync('zstd', ['-q', '-T2', '-3', '--no-progress', archive, '-o', compressed], { timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
      manifest.schema = 2;
      manifest.transport = { format: 'zstd', bytes: (await stat(compressed)).size, sha256: await archiveDigest(compressed) };
      validateDescriptor(manifest.transport, maxTransportBytes);
      await rm(archive);
    }
    await writeFile(join(artifactDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    return manifest;
  } catch (error) {
    await rm(artifactDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreDependencyBundle({ root, artifactDirectory, context, producerAttempt = context.attempt }) {
  validateContext(context);
  root = realpathSync(root);
  const manifest = JSON.parse(await readFile(join(artifactDirectory, 'manifest.json'), 'utf8'));
  assert.ok([1, 2].includes(manifest.schema), 'Unsupported dependency manifest');
  validateContext(manifest.context);
  assert.equal(manifest.context.attempt, producerAttempt, 'Dependency producer attempt mismatch');
  for (const key of ['repository', 'runId', 'sha', 'tree', 'runtime']) {
    assert.ok(isDeepStrictEqual(manifest.context[key], context[key]), `Dependency ${key} mismatch`);
  }
  assert.ok(BigInt(manifest.context.attempt) <= BigInt(context.attempt), 'Dependency producer attempt is in the future');
  const source = inputs(root);
  assert.equal(manifest.inputs, source.hash, 'Dependency input hash mismatch');
  assert.ok(Array.isArray(manifest.roots) && manifest.roots.includes('node_modules'), 'Missing installation roots');
  assert.equal(new Set(manifest.roots).size, manifest.roots.length, 'Duplicate installation roots');
  for (const path of manifest.roots) {
    assert.ok(source.roots.includes(repoPath(path)), 'Unexpected dependency root');
    assert.equal(realpathSync(dirname(join(root, path))), dirname(join(root, path)), 'Dependency parent must not be a symlink');
    assert.ok(!await exists(join(root, path)), `Dependency installation already exists: ${path}`);
  }
  validateDescriptor(manifest.archive, maxArchiveBytes);
  const compressed = manifest.schema === 2;
  if (compressed) {
    assert.equal(manifest.transport?.format, 'zstd', 'Unsupported dependency transport format');
    validateDescriptor(manifest.transport, maxTransportBytes);
  } else assert.equal(manifest.transport, undefined, 'Unexpected dependency transport metadata');
  const stored = join(artifactDirectory, compressed ? 'dependencies.tar.zst' : 'dependencies.tar');
  const descriptor = compressed ? manifest.transport : manifest.archive;
  assert.equal((await stat(stored)).size, descriptor.bytes, 'Dependency archive transport size mismatch');
  assert.equal(await archiveDigest(stored), descriptor.sha256, 'Dependency archive transport digest mismatch');
  const staging = await mkdtemp(join(root, '.cockpit-dependencies-'));
  const installed = [];
  try {
    const archive = compressed ? join(staging, 'dependencies.tar') : stored;
    if (compressed) await expandTransport(stored, archive, manifest.archive);
    archiveOperation('extract', archive, { roots: manifest.roots, workspaceLinks: source.workspaceLinks }, staging);
    for (const path of manifest.roots) {
      assert.ok(!await exists(join(root, path)), 'Dependency installation appeared during restore');
      await rename(join(staging, path), join(root, path));
      installed.push(path);
    }
    return manifest;
  } catch (error) {
    for (const path of installed.reverse()) await rm(join(root, path), { recursive: true, force: true });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function collectContext(root, environment = process.env) {
  const git = arg => execFileSync('git', ['rev-parse', arg], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
  const sha = git('HEAD');
  assert.equal(sha, environment.GITHUB_SHA, 'Checkout does not match workflow source');
  const os = process.platform === 'linux' ? readFileSync('/etc/os-release', 'utf8').split('\n').filter(line => /^(ID|VERSION_ID)=/.test(line)).join(';') : process.platform;
  const context = {
    repository: environment.GITHUB_REPOSITORY, runId: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT,
    sha, tree: git('HEAD^{tree}'),
    runtime: { node: process.version, abi: process.versions.modules, npm: execFileSync('npm', ['--version'], { encoding: 'utf8', timeout: 10000 }).trim(), platform: process.platform, arch: process.arch, os },
  };
  validateContext(context);
  return context;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, artifactDirectory] = process.argv.slice(2);
  try {
    assert.ok(['pack', 'restore'].includes(mode) && artifactDirectory, 'Expected pack|restore ARTIFACT_DIRECTORY');
    const start = Date.now();
    const options = { root: process.cwd(), artifactDirectory, context: collectContext(process.cwd()) };
    if (mode === 'pack') options.transport = process.env.COCKPIT_DEPENDENCY_TRANSPORT ?? 'tar';
    if (mode === 'restore') {
      assert.match(process.env.COCKPIT_DEPENDENCY_PRODUCER_ATTEMPT ?? '', /^[1-9][0-9]*$/, 'Missing producer attempt');
      options.producerAttempt = process.env.COCKPIT_DEPENDENCY_PRODUCER_ATTEMPT;
    }
    const manifest = await (mode === 'pack' ? createDependencyBundle(options) : restoreDependencyBundle(options));
    console.log(`Cockpit dependencies ${mode}: ${manifest.archive.bytes} bytes, ${manifest.roots.length} private installation roots, ${((Date.now() - start) / 1000).toFixed(2)} seconds`);
    if (mode === 'restore') {
      for (const file of [manifest.schema === 2 ? 'dependencies.tar.zst' : 'dependencies.tar', 'manifest.json']) await rm(join(artifactDirectory, file));
      try { await rmdir(artifactDirectory); } catch (error) { if (error.code !== 'ENOTEMPTY') throw error; }
    }
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
