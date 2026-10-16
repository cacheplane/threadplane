import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  if (stylesheetExport(subpath, entry)) return true;
  if (!/\.(?:md|json)$/.test(subpath)) return false;
  return typeof entry === 'string' ? subpath === entry :
    entry !== null && typeof entry === 'object' && !Array.isArray(entry) &&
    Object.keys(entry).length === 1 && entry.default === subpath;
}
// Stylesheets are static assets: a .css subpath whose only target is a .css file.
function stylesheetExport(subpath, entry) {
  if (!subpath.endsWith('.css')) return false;
  const target = typeof entry === 'string' ? entry :
    entry !== null && typeof entry === 'object' && !Array.isArray(entry) &&
    Object.keys(entry).length === 1 ? entry.default : undefined;
  return typeof target === 'string' && target.endsWith('.css');
}

export function consumerSpecifiers(manifest) {
  // The selected protocol package predates export maps. Exercise its actual
  // installed root while keeping private scaffold export requirements strict.
  if (manifest.name === '@threadplane/a2ui' && manifest.exports === undefined) {
    const target = (path, extension) => typeof path === 'string' && path.startsWith('./') && !path.includes('\\') && path.slice(2).split('/').every(part => part && part !== '.' && part !== '..') && extension.test(path);
    if (manifest.type !== 'module' || !target(manifest.types, /\.d\.ts$/) || !target(manifest.main, /\.m?js$/)) throw new Error('A2UI legacy root requires ESM main and declarations');
    return [manifest.name];
  }
  if (manifest.name === '@threadplane/react' && !manifest.exports?.['./markdown']) throw new Error('React ./markdown export required');
  if (manifest.name === '@threadplane/react' && (!manifest.exports?.['./debug'] || !manifest.exports?.['./debug/styles.css'])) throw new Error('React ./debug and ./debug/styles.css exports required');
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
  if (project === 'react' && !manifest.exports?.['./markdown']) errors.push('Missing ./markdown export.');
  if (project === 'react' && (!manifest.exports?.['./debug'] || !manifest.exports?.['./debug/styles.css'])) errors.push('Missing ./debug or ./debug/styles.css export.');
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

// Resolve required local dependencies/peers before npm sees a manifest. Optional
// local peers enter only through explicit roots, required edges or optionalPeers.
// Unknown selected Threadplane packages fail closed instead of using npm.
export function localDependencyProjects(projects, readManifest, { optionalPeers = [] } = {}) {
  const selectedPeers = new Set(optionalPeers);
  const selected = new Set();
  const manifests = new Map();
  const optionalEdges = [];
  function visit(project) {
    if (selected.has(project)) return;
    if (!scanProjects.includes(project)) throw new Error(`No local artifact policy for ${project}`);
    selected.add(project);
    const manifest = readManifest(project);
    if (!manifest) throw new Error(`Missing local artifact manifest for ${project}`);
    manifests.set(project, manifest);
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (!name.startsWith('@threadplane/')) continue;
        const dependency = name.slice('@threadplane/'.length);
        if (field === 'peerDependencies' && manifest.peerDependenciesMeta?.[name]?.optional === true) {
          optionalEdges.push({ project, name, dependency, range });
          if (!selectedPeers.has(dependency)) continue;
        }
        visit(dependency);
        const version = manifests.get(dependency).version;
        if (!version || !satisfies(version, range)) throw new Error(`Local ${name}@${version} does not satisfy ${project} ${field} range ${range}`);
      }
    }
  }
  projects.forEach(visit);
  optionalPeers.forEach(visit);
  // A peer selected as a root or through a required edge must also satisfy every
  // optional peer constraint, regardless of the order in which roots were read.
  for (const { project, name, dependency, range } of optionalEdges) {
    if (!selected.has(dependency)) continue;
    const version = manifests.get(dependency).version;
    if (!version || !satisfies(version, range)) throw new Error(`Local ${name}@${version} does not satisfy ${project} peerDependencies range ${range}`);
  }
  return [...selected];
}

export function runConsumer(command, args, cwd, env = process.env) {
  console.log(`$ ${command} ${args.join(' ')} (cwd: ${cwd})`);
  return execFileSync(command, args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...env, npm_config_legacy_peer_deps: 'false', NPM_CONFIG_LEGACY_PEER_DEPS: 'false', NG_CLI_ANALYTICS: 'false' },
  });
}

export function packLocalArtifacts(root, temporary, projects, { optionalPeers = [] } = {}) {
  const selected = localDependencyProjects(projects, (project) =>
    JSON.parse(readFileSync(join(root, 'dist/libs', project, 'package.json'), 'utf8')), { optionalPeers });
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
  const parser = /(?:^|\/)node_modules\/(?:@cacheplane\/(?:json-stream|partial-json|partial-markdown)|marked|remark-gfm|katex|shiki)(?:\/|$)/;
  const found = Object.keys(inputs).filter((path) => parser.test(path.replaceAll('\\', '/')));
  if (found.length) throw new Error(`Framework root includes content parser inputs: ${found.join(', ')}`);
}

export function assertDebugFreeInputs(inputs) {
  if (!inputs || !Object.keys(inputs).length) throw new Error('Missing bundler inputs evidence');
  const found = Object.keys(inputs).filter(path => /@threadplane\/react\/src\/debug\//.test(path.replaceAll('\\', '/')));
  if (found.length) throw new Error(`Production entry includes Debug feature: ${found.join(', ')}`);
}

export function assertHeadlessInputs(inputs) {
  assertDebugFreeInputs(inputs);
  assertParserFreeInputs(inputs);
  const render = Object.keys(inputs).filter((path) => /(?:@threadplane\/react\/src\/render\/|node_modules\/@json-render\/)/.test(path.replaceAll('\\', '/')));
  if (render.length) throw new Error(`Headless framework root includes render feature: ${render.join(', ')}`);
  const chat = Object.keys(inputs).filter((path) => /@threadplane\/(?:react\/src\/chat\/|angular\/fesm2022\/threadplane-angular-chat\.mjs)/.test(path.replaceAll('\\', '/')));
  if (chat.length) throw new Error(`Headless framework root includes chat components: ${chat.join(', ')}`);
  const markdown = Object.keys(inputs).filter((path) => /@threadplane\/(?:(?:react|content)\/src\/markdown\/|angular\/fesm2022\/threadplane-angular-markdown\.mjs)/.test(path.replaceAll('\\', '/')));
  if (markdown.length) throw new Error(`Headless framework root includes Markdown feature: ${markdown.join(', ')}`);
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
      'react/chat': [
        'ApprovalCard',
        'Chat',
        'ChatInput',
        'Citations',
        'MessageList',
        'MessageActions',
        'Reasoning',
        'TextTranscript',
        'ToolObservation',
      ],
      'react/debug': ['ChatDebug'],
      'react/markdown': ['Markdown'],
      'react/render': ['RenderSpec'],
      'content/json': ['createJson'],
      'content/a2ui': ['createA2uiSurfaces'],
    }[project] ?? [];
  // React entries may export forwardRef/memo components, which are $$typeof objects.
  const supported = (value) =>
    typeof value === 'function' ||
    (project.startsWith('react') &&
      value !== null &&
      typeof value === 'object' &&
      typeof value.$$typeof === 'symbol');
  for (const name of expected)
    if (!supported(entry[name]))
      throw new Error(`${project} missing supported contract ${name}`);
  if (
    ['react/debug', 'react/chat', 'react/markdown', 'react/render', 'content/json', 'content/a2ui'].includes(project) &&
    Object.keys(entry).some((name) => !expected.includes(name))
  )
    throw new Error(`${project} has unexpected exports`);
}

export async function verifyPackedConsumers(root = process.cwd()) {
  root = resolve(root);
  const temporary = mkdtempSync(join(tmpdir(), 'threadplane-consumer-'));
  try {
    const projects = privateScaffoldProjects.filter((project) => project !== 'angular');
    const tarballs = packLocalArtifacts(root, temporary, projects, { optionalPeers: ['a2ui'] });
    const core = join(temporary, 'core-consumer');
    mkdirSync(core);
    installConsumer(core, { private: true, type: 'module' }, { '@threadplane/core': tarballs['@threadplane/core'] }, 'core');
    const coreCount = verifyPlainExports(root, core, ['core']);
    prepareInstalledTypes(root, core, 'core');
    runConsumer(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.contracts.json'], core);
    const plain = join(temporary, 'plain-consumer');
    mkdirSync(plain);
    installConsumer(plain, lockedReactManifest(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))), tarballs, 'plain');
    const installedLock = JSON.parse(readFileSync(join(plain, 'package-lock.json'), 'utf8'));
    console.log(`Installed local candidate resolutions: ${JSON.stringify(Object.fromEntries(Object.entries(installedLock.packages).filter(([path]) => path.includes('node_modules/@threadplane/')).map(([path, entry]) => [path, { version: entry.version, resolved: entry.resolved, integrity: entry.integrity }])) )}`);
    const count = verifyPlainExports(root, plain, Object.keys(tarballs).map((name) => name.slice('@threadplane/'.length)));
    cpSync(join(root, 'fixtures/react-parity/runtime/json-runtime.mjs'), join(plain, 'json-runtime.mjs'));
    console.log(runConsumer(process.execPath, ['json-runtime.mjs'], plain));
    cpSync(join(root, 'fixtures/react-parity/runtime/render-runtime.mjs'), join(plain, 'render-runtime.mjs'));
    console.log(runConsumer(process.execPath, ['render-runtime.mjs'], plain));
    writeFileSync(join(plain, 'react-root.mjs'), "import * as react from '@threadplane/react';\nconsole.log(Object.keys(react));\n");
    const bundle = buildSync({ absWorkingDir: plain, entryPoints: [join(plain, 'react-root.mjs')], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
    assertHeadlessInputs(bundle.metafile.inputs);
    console.log(`React development root-import probe (unminified, separate from the production app): ${Object.keys(bundle.metafile.inputs).length} inputs, ${bundle.outputFiles[0].contents.length} bytes, no content parsers. Inputs: ${Object.keys(bundle.metafile.inputs).join(', ')}.`);
    for (const entry of ['root', 'chat', 'debug']) {
      const specifier = entry === 'root' ? '@threadplane/react' : `@threadplane/react/${entry}`;
      const css = entry === 'debug' || entry === 'chat' ? `import '${specifier}/styles.css';\n` : '';
      writeFileSync(join(plain, `${entry}-production.mjs`), `${css}import * as entry from '${specifier}';\nconsole.log(Object.keys(entry));\n`);
      const result = buildSync({ absWorkingDir: plain, entryPoints: [`${entry}-production.mjs`], bundle: true, platform: 'browser', format: 'esm', minify: true, define: { 'process.env.NODE_ENV': '"production"' }, outdir: join(plain, `proof-${entry}`), write: false, metafile: true });
      const assets = result.outputFiles.filter(file => file.path.endsWith('.css'));
      const debugCss = assets.some(file => file.text.includes('.tp-debug'));
      if (entry === 'debug') {
        if (!Object.keys(result.metafile.inputs).some(path => path.endsWith('/debug/chat-debug.js')) || !debugCss) throw new Error('Installed standalone Debug import and emitted CSS required');
      } else {
        assertDebugFreeInputs(result.metafile.inputs);
        if (debugCss) throw new Error('Production root/chat includes Debug CSS');
      }
      console.log(`Installed production ${entry} proof: ${JSON.stringify({ metafile: result.metafile, outputs: result.outputFiles.map(file => ({ path: file.path, bytes: file.contents.length })), css: assets.map(file => ({ path: file.path, text: file.text })), debugCss })}`);
    }
    writeFileSync(join(plain, 'debug-types.ts'), `import { ChatDebug, type ChatDebugProps, type DebugSelection } from '@threadplane/react/debug';
const selection: DebugSelection = { contextKey: 'owner', pageGeneration: 1, rowKey: 'row' };
const props: ChatDebugProps = { contextKey: 'owner', current: { contextKey: 'owner', status: 'ready', values: {} }, selection, onInspect: () => undefined };
ChatDebug(props);
// @ts-expect-error Debug does not accept a session capability.
ChatDebug({ ...props, session: {} });
// @ts-expect-error Async readers are not notification callbacks.
ChatDebug({ ...props, onInspect: async () => undefined });
// @ts-expect-error Selection is immutable.
selection.rowKey = 'other';
`);
    writeFileSync(join(plain, 'tsconfig.debug.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM'], strict: true, skipLibCheck: false, noEmit: true }, files: ['debug-types.ts'] }));
    runConsumer(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.debug.json'], plain);
    prepareInstalledTypes(root, plain, 'react');
    await prepareRuntimeConsumer(root, plain, 'react');
    for (const config of ['tsconfig.contracts.json', 'tsconfig.app.json']) runConsumer(process.execPath, [join(plain, 'node_modules/typescript/bin/tsc'), '-p', config], plain);
    console.log(runConsumer(process.execPath, [join(plain, 'node_modules/vite/bin/vite.js'), 'build'], plain));
    await runRuntimeScenarios(join(plain, 'dist'), 'React');
    console.log(`Verified ${Object.keys(tarballs).length} selected plain tarballs, ${count} ESM/type exports, and ${coreCount} isolated core exports with skipLibCheck:false, precise heterogeneous tool contracts, and a production-built installed React consumer.`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyPackedConsumers();
