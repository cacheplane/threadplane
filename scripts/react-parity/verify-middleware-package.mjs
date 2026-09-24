import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfies } from 'semver';
import ts from 'typescript';

export function runMiddlewareConsumer(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: 180_000, maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', npm_config_legacy_peer_deps: 'false', NPM_CONFIG_LEGACY_PEER_DEPS: 'false' },
  });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.error ?? ''}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  return result.stdout;
}

export function lockedMiddlewareManifest(manifest, lock) {
  const version = (name) => {
    const value = lock.packages?.[`node_modules/${name}`]?.version;
    if (!value) throw new Error(`Missing root lock version for ${name}`);
    return value;
  };
  const dependencies = Object.fromEntries(Object.entries(manifest.peerDependencies ?? {}).map(([name, range]) => {
    const pinned = version(name);
    if (!satisfies(pinned, range)) throw new Error(`${name}@${pinned} does not satisfy middleware peer range ${range}`);
    return [name, pinned];
  }));
  return { private: true, type: 'module', dependencies, devDependencies: Object.fromEntries(['typescript', '@types/node'].map((name) => [name, version(name)])) };
}

export function assertConsumerFiles(consumer, files) {
  if (!files.length) throw new Error('No compiler files resolved');
  const prefix = realpathSync(consumer) + sep;
  for (const file of files) if (!realpathSync(file).startsWith(prefix)) throw new Error(`Compiler resolved outside isolated consumer: ${file}`);
}

function filesIn(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return lstatSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

export function auditMiddlewarePackage(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const errors = [];
  if (manifest.name !== '@threadplane/middleware' || manifest.type !== 'module') errors.push('Expected middleware ESM package');
  const declared = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
  for (const [name, range] of Object.entries(declared)) {
    if (name.startsWith('@threadplane/')) errors.push(`private dependency ${name}`);
    if (/^(?:npm|file|link|workspace):/.test(range)) errors.push(`dependency alias or local source ${name}: ${range}`);
  }
  const entry = manifest.exports?.['./langgraph'];
  if (!entry?.types || !entry?.default) errors.push('Missing langgraph types/default exports');
  function auditTarget(target) {
    if (typeof target === 'object' && target !== null) { Object.values(target).forEach(auditTarget); return; }
    if (typeof target !== 'string' || !target.startsWith('./') || !resolve(directory, target).startsWith(resolve(directory) + sep)) errors.push(`Invalid export target ${target}`);
    else if (!existsSync(join(directory, target))) errors.push(`missing export target ${target}`);
  }
  Object.values(manifest.exports ?? {}).forEach(auditTarget);
  for (const path of filesIn(directory)) {
    const name = relative(directory, path);
    if (lstatSync(path).isSymbolicLink()) { errors.push(`Symlink artifact ${name}`); continue; }
    if ((/\.[cm]?tsx?$/.test(name) && !/\.d\.[cm]?ts$/.test(name)) || /\.(?:spec|test)\./.test(name)) errors.push(`source artifact ${name}`);
    if (!/\.[cm]?[jt]s$/.test(name)) continue;
    const source = readFileSync(path, 'utf8');
    for (const { fileName: specifier } of ts.preProcessFile(source, true, true).importedFiles) {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(path), specifier);
        if (!target.startsWith(resolve(directory) + sep)) errors.push(`source escape ${name}: ${specifier}`);
        else if (!existsSync(target) && !existsSync(target.replace(/\.js$/, '.d.ts'))) errors.push(`missing imported file ${name}: ${specifier}`);
        continue;
      }
      if (isBuiltin(specifier)) continue;
      const dependency = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (dependency.startsWith('@threadplane/')) errors.push(`private dependency ${name}: ${specifier}`);
      else if (!Object.hasOwn(declared, dependency)) errors.push(`undeclared dependency ${name}: ${specifier}`);
    }
  }
  return errors;
}

export async function verifyMiddlewarePackage(root = process.cwd()) {
  root = realpathSync(resolve(root));
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'threadplane-middleware-consumer-')));
  try {
    if (temporary.startsWith(root + sep)) throw new Error('Consumer must be outside the workspace');
    for (let ancestor = dirname(temporary); ; ancestor = dirname(ancestor)) {
      if (existsSync(join(ancestor, 'node_modules'))) throw new Error(`Consumer has ancestor node_modules: ${ancestor}`);
      if (ancestor === dirname(ancestor)) break;
    }
    const packed = JSON.parse(runMiddlewareConsumer('npm', ['pack', join(root, 'dist/libs/middleware'), '--ignore-scripts', '--json', '--pack-destination', temporary], temporary));
    const tarball = join(temporary, packed[0].filename);
    const unpacked = join(temporary, 'packed');
    mkdirSync(unpacked);
    runMiddlewareConsumer('tar', ['-xzf', tarball, '-C', unpacked], temporary);
    const artifact = join(unpacked, 'package');
    const errors = auditMiddlewarePackage(artifact);
    if (errors.length) throw new Error(errors.join('\n'));
    const packageManifest = JSON.parse(readFileSync(join(artifact, 'package.json'), 'utf8'));
    const manifest = lockedMiddlewareManifest(packageManifest, JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')));
    manifest.dependencies['@threadplane/middleware'] = `file:${tarball}`;
    const consumer = join(temporary, 'consumer');
    cpSync(join(root, 'fixtures/react-parity/consumers/middleware'), consumer, { recursive: true });
    writeFileSync(join(consumer, 'package.json'), JSON.stringify(manifest, null, 2));
    console.log(`Middleware consumer toolchain: ${JSON.stringify(manifest)}`);
    console.log(runMiddlewareConsumer('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer));
    const installedLock = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8'));
    for (const [path, value] of Object.entries(installedLock.packages)) {
      if (!path) continue;
      const name = path.split('node_modules/').at(-1);
      if (value.link) throw new Error(`Linked consumer dependency ${path}`);
      if (name.startsWith('@threadplane/') && (name !== '@threadplane/middleware' || !value.resolved?.endsWith('.tgz'))) throw new Error(`Unexpected Threadplane dependency ${path}`);
    }
    const installed = join(consumer, 'node_modules/@threadplane/middleware');
    if (lstatSync(installed).isSymbolicLink()) throw new Error('Installed middleware is a symlink');
    const installedErrors = auditMiddlewarePackage(installed);
    if (installedErrors.length) throw new Error(installedErrors.join('\n'));
    const failures = [];
    const compiler = join(consumer, 'node_modules/typescript/bin/tsc');
    const files = runMiddlewareConsumer(process.execPath, [compiler, '-p', 'tsconfig.json', '--listFilesOnly'], consumer).trim().split(/\r?\n/).filter(Boolean);
    assertConsumerFiles(consumer, files);
    console.log(`All ${files.length} compiler-resolved files are inside the isolated consumer.`);
    for (const args of [[compiler, '-p', 'tsconfig.json'], ['runtime.mjs']]) {
      try { console.log(runMiddlewareConsumer(process.execPath, args, consumer)); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Installed middleware contracts failed');
    console.log('Verified standalone middleware tarball: strict declarations, removed imports, ESM exports, and owned execution-store behavior.');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyMiddlewarePackage();
