import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { buildSync } from 'esbuild';
import { satisfies } from 'semver';
import { angularTransitionProjects, emittedEntries, manifestViolations, privateScaffoldProjects, scanProjects } from './package-policy.mjs';
import { lockedReactManifest, prepareInstalledTypes, prepareRuntimeConsumer, runRuntimeScenarios } from './runtime-consumer.mjs';

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)]);
}
function clientDirective(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const first = source.statements[0];
  return first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use client';
}

function metadataExport(subpath, entry) {
  if (!/\.(?:md|json)$/.test(subpath)) return false;
  return typeof entry === 'string' ? subpath === entry :
    entry !== null && typeof entry === 'object' && !Array.isArray(entry) &&
    Object.keys(entry).length === 1 && entry.default === subpath;
}

export function consumerSpecifiers(manifest) {
  return Object.entries(manifest.exports).filter(([subpath, entry]) => !metadataExport(subpath, entry))
    .map(([subpath]) => manifest.name + (subpath === '.' ? '' : subpath.slice(1)));
}

export function validatePackage(directory, { angularTransitions = angularTransitionProjects, telemetryBrowserTransition = true } = {}) {
  const errors = [];
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const project = manifest.name?.replace(/^@threadplane\//, '');
  const scaffold = privateScaffoldProjects.includes(project);
  errors.push(...manifestViolations(project, manifest, { angularTransitions, telemetryBrowserTransition }));
  if (scaffold && manifest.private !== true) errors.push('Foundation package must remain private.');
  if (manifest.type !== 'module') errors.push('Foundation package must emit ESM.');
  if (manifest.license !== 'MIT') errors.push('Expected MIT package license.');
  for (const file of ['LICENSE.md', 'README.md']) if (!existsSync(join(directory, file))) errors.push(`Missing ${file}`);
  if (!emittedEntries(manifest).length) errors.push('Missing root export.');
  const exports = manifest.exports ?? { '.': { types: manifest.types ?? manifest.typings, default: manifest.module ?? manifest.main } };
  for (const [subpath, entry] of Object.entries(exports)) {
    const conditions = typeof entry === 'string' ? { default: entry } : entry;
    const metadataAsset = metadataExport(subpath, entry);
    if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions) || !Object.keys(conditions).length) { errors.push(`${subpath}: invalid export conditions.`); continue; }
    if (scaffold && !metadataAsset) {
      // ng-packagr APF root and real secondary entries use types/default.
      const angularEntry = project === 'angular';
      if (!conditions.types || !conditions.default || (!angularEntry && !conditions.import)) errors.push(`${subpath}: requires ${angularEntry ? 'types and default' : 'types, import and default'} export conditions.`);
    }
    for (const [condition, target] of Object.entries(conditions)) {
      if (typeof target !== 'string' || !target.startsWith('./') || !resolve(directory, target).startsWith(resolve(directory) + sep)) { errors.push(`${subpath}: invalid export target ${target}`); continue; }
      const path = join(directory, target);
      if (!existsSync(path)) { errors.push(`${subpath}: missing export target ${target}`); continue; }
      if (condition === 'types' && !target.endsWith('.d.ts')) errors.push(`${subpath}: types must resolve to declarations.`);
      if (condition !== 'types' && !metadataAsset && !/\.m?js$/.test(target)) errors.push(`${subpath}: runtime must resolve to JavaScript ESM (.js or .mjs).`);
      if (!metadataAsset && ['import', 'default'].includes(condition) && manifest.name === '@threadplane/react' && !clientDirective(path)) errors.push(`${subpath}: missing use client directive.`);
    }
  }
  for (const file of filesIn(directory)) if (/\.(?:spec|test|type-test)\.[cm]?[jt]sx?$|\/test-setup\./.test(file) || (/\.tsx?$/.test(file) && !file.endsWith('.d.ts'))) errors.push(`Unexpected production artifact ${relative(directory, file)}`);
  return errors;
}

// Resolve only declared local dependencies, including peers, before npm sees a
// manifest. Unknown Threadplane packages fail closed instead of using npm.
export function localDependencyProjects(projects, readManifest) {
  const selected = new Set();
  const manifests = new Map();
  function visit(project) {
    if (selected.has(project)) return;
    if (!scanProjects.includes(project)) throw new Error(`No local artifact policy for ${project}`);
    selected.add(project);
    const manifest = readManifest(project);
    manifests.set(project, manifest);
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (!name.startsWith('@threadplane/')) continue;
        const dependency = name.slice('@threadplane/'.length);
        visit(dependency);
        const version = manifests.get(dependency).version;
        if (!version || !satisfies(version, range)) throw new Error(`Local ${name}@${version} does not satisfy ${project} ${field} range ${range}`);
      }
    }
  }
  projects.forEach(visit);
  return [...selected];
}

export function runConsumer(command, args, cwd) {
  console.log(`$ ${command} ${args.join(' ')} (cwd: ${cwd})`);
  return execFileSync(command, args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, npm_config_legacy_peer_deps: 'false', NPM_CONFIG_LEGACY_PEER_DEPS: 'false', NG_CLI_ANALYTICS: 'false' },
  });
}

export function packLocalArtifacts(root, temporary, projects) {
  const selected = localDependencyProjects(projects, (project) =>
    JSON.parse(readFileSync(join(root, 'dist/libs', project, 'package.json'), 'utf8')));
  const dependencies = {};
  for (const project of selected) {
    const packed = JSON.parse(runConsumer('npm', ['pack', join(root, 'dist/libs', project), '--ignore-scripts', '--json', '--pack-destination', temporary], temporary));
    const tarball = join(temporary, packed[0].filename);
    dependencies[`@threadplane/${project}`] = `file:${tarball}`;
    const unpacked = join(temporary, `packed-${project}`);
    mkdirSync(unpacked);
    runConsumer('tar', ['-xzf', tarball, '-C', unpacked], temporary);
    const errors = validatePackage(join(unpacked, 'package'));
    if (errors.length) throw new Error(`${project}:\n${errors.join('\n')}`);
  }
  return dependencies;
}

export function installGraphViolations(lock, kind) {
  const errors = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path.includes('node_modules/')) continue;
    const name = path.split('node_modules/').at(-1);
    if (kind === 'core' && name !== '@threadplane/core') errors.push(`Core installed dependency ${name}`);
    if (kind === 'plain' && name.startsWith('@angular/')) errors.push(`Plain consumer installed Angular: ${name}`);
    if (kind === 'angular' && ['react', 'react-dom', '@types/react', '@types/react-dom', '@threadplane/react'].includes(name)) errors.push(`Angular consumer installed React: ${name}`);
    if (name.startsWith('@langchain/') || name.startsWith('@ag-ui/') || ['openai', '@anthropic-ai/sdk'].includes(name)) errors.push(`Consumer installed backend SDK: ${name}`);
    if (name.startsWith('@threadplane/') && (entry.link || !/^file:.*\.tgz$/.test(entry.resolved ?? ''))) errors.push(`${name} must resolve to a local tarball`);
  }
  return errors;
}

export function installConsumer(consumer, manifest, localDependencies, kind) {
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    ...manifest,
    dependencies: { ...manifest.dependencies, ...localDependencies },
    // npm must use our candidate for every transitive Threadplane edge too.
    overrides: { ...manifest.overrides, ...Object.fromEntries(Object.keys(localDependencies).map((name) => [name, `$${name}`])) },
  }, null, 2));
  console.log(runConsumer('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer));
  const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8'));
  const errors = installGraphViolations(lock, kind);
  if (errors.length) throw new Error(errors.join('\n'));
  const footprint = installFootprint(consumer, lock);
  const names = Object.keys(lock.packages).filter((path) => path.includes('node_modules/@threadplane/'));
  console.log(`${kind} install footprint${kind === 'angular' ? ' (includes Angular CLI/build/compiler dev tooling)' : ''}: ${footprint.installedPackages} installed packages, ${footprint.fileBytes} file bytes; ${footprint.lockedPackages} lock entries including optional platforms. Threadplane artifacts: ${names.join(', ')}. Installation size is separate from framework root bundle size.`);
}

export function installFootprint(consumer, lock) {
  const packages = Object.keys(lock.packages).filter((path) => path.includes('node_modules/'));
  const fileBytes = (directory) => readdirSync(directory).reduce((total, name) => {
    const path = join(directory, name);
    const entry = lstatSync(path);
    return total + (entry.isDirectory() ? fileBytes(path) : entry.isFile() ? entry.size : 0);
  }, 0);
  return {
    installedPackages: packages.filter((path) => existsSync(join(consumer, path, 'package.json'))).length,
    lockedPackages: packages.length,
    fileBytes: fileBytes(join(consumer, 'node_modules')),
  };
}

export function assertParserFreeInputs(inputs) {
  if (!inputs || typeof inputs !== 'object' || !Object.keys(inputs).length) throw new Error('Missing bundler inputs evidence');
  const parser = /(?:^|\/)node_modules\/(?:@cacheplane\/(?:partial-json|partial-markdown)|marked|remark-gfm|katex|shiki)(?:\/|$)/;
  const found = Object.keys(inputs).filter((path) => parser.test(path.replaceAll('\\', '/')));
  if (found.length) throw new Error(`Framework root includes content parser inputs: ${found.join(', ')}`);
}

export function assertHeadlessInputs(inputs) {
  assertParserFreeInputs(inputs);
  const chat = Object.keys(inputs).filter((path) => /@threadplane\/(?:react\/src\/chat\/|angular\/fesm2022\/threadplane-angular-chat\.mjs)/.test(path.replaceAll('\\', '/')));
  if (chat.length) throw new Error(`Headless framework root includes chat components: ${chat.join(', ')}`);
}

function verifyPlainExports(root, consumer, projects) {
  const specifiers = projects.flatMap((project) => consumerSpecifiers(JSON.parse(readFileSync(join(consumer, 'node_modules/@threadplane', project, 'package.json'), 'utf8'))));
  writeFileSync(join(consumer, 'index.mjs'), `${assertSupportedExports.toString()}\n` + specifiers.map((specifier) => `assertSupportedExports(${JSON.stringify(specifier.slice('@threadplane/'.length))}, await import(${JSON.stringify(specifier)}));`).join('\n'));
  writeFileSync(join(consumer, 'index.ts'), specifiers.map((specifier, index) => `import * as entry${index} from ${JSON.stringify(specifier)};\nexport type Entry${index} = typeof entry${index};`).join('\n'));
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM'], types: [], strict: true, skipLibCheck: false, noEmit: true }, files: ['index.ts'] }));
  runConsumer(process.execPath, ['index.mjs'], consumer);
  runConsumer(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer);
  return specifiers.length;
}

export function assertSupportedExports(project, entry) {
  const expected =
    {
      core: [
        'completeDelivery',
        'streamingDelivery',
        'staticDelivery',
        'projectAgentError',
      ],
      react: ['useAgent'],
      'react/chat': ['TextTranscript', 'ToolObservation'],
    }[project] ?? [];
  for (const name of expected)
    if (typeof entry[name] !== 'function')
      throw new Error(`${project} missing supported contract ${name}`);
  if (
    project === 'react/chat' &&
    Object.keys(entry).some((name) => !expected.includes(name))
  )
    throw new Error('react/chat has unexpected exports');
}

export async function verifyPackedConsumers(root = process.cwd()) {
  root = resolve(root);
  const temporary = mkdtempSync(join(tmpdir(), 'threadplane-consumer-'));
  try {
    const projects = privateScaffoldProjects.filter((project) => project !== 'angular');
    const tarballs = packLocalArtifacts(root, temporary, projects);
    const core = join(temporary, 'core-consumer');
    mkdirSync(core);
    installConsumer(core, { private: true, type: 'module' }, { '@threadplane/core': tarballs['@threadplane/core'] }, 'core');
    const coreCount = verifyPlainExports(root, core, ['core']);
    prepareInstalledTypes(root, core, 'core');
    runConsumer(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.contracts.json'], core);
    const plain = join(temporary, 'plain-consumer');
    mkdirSync(plain);
    installConsumer(plain, lockedReactManifest(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))), tarballs, 'plain');
    const count = verifyPlainExports(root, plain, Object.keys(tarballs).map((name) => name.slice('@threadplane/'.length)));
    writeFileSync(join(plain, 'react-root.mjs'), "import * as react from '@threadplane/react';\nconsole.log(Object.keys(react));\n");
    const bundle = buildSync({ absWorkingDir: plain, entryPoints: [join(plain, 'react-root.mjs')], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
    assertHeadlessInputs(bundle.metafile.inputs);
    console.log(`React development root-import probe (unminified, separate from the production app): ${Object.keys(bundle.metafile.inputs).length} inputs, ${bundle.outputFiles[0].contents.length} bytes, no content parsers. Inputs: ${Object.keys(bundle.metafile.inputs).join(', ')}.`);
    prepareInstalledTypes(root, plain, 'react');
    await prepareRuntimeConsumer(root, plain, 'react');
    for (const config of ['tsconfig.contracts.json', 'tsconfig.app.json']) runConsumer(process.execPath, [join(plain, 'node_modules/typescript/bin/tsc'), '-p', config], plain);
    console.log(runConsumer(process.execPath, [join(plain, 'node_modules/vite/bin/vite.js'), 'build'], plain));
    await runRuntimeScenarios(join(plain, 'dist'), 'React');
    console.log(`Verified ${Object.keys(tarballs).length} private plain tarballs, ${count} ESM/type exports, and ${coreCount} isolated core exports with skipLibCheck:false, precise heterogeneous tool contracts, and a production-built installed React consumer.`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyPackedConsumers();
