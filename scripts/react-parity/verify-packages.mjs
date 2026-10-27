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
  if (project === 'react' && (manifest.peerDependencies?.['react-dom'] !== '^19.2.4' || manifest.peerDependenciesMeta?.['react-dom']?.optional === true)) errors.push('React requires compatible nonoptional react-dom peer ^19.2.4.');
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
  const dom = Object.keys(inputs).filter(path => /(?:^|\/)node_modules\/react-dom(?:\/|$)/.test(path.replaceAll('\\', '/')));
  if (dom.length) throw new Error(`Headless framework root includes DOM inputs: ${dom.join(', ')}`);
  const render = Object.keys(inputs).filter((path) => /(?:@threadplane\/react\/src\/render\/|node_modules\/@json-render\/)/.test(path.replaceAll('\\', '/')));
  if (render.length) throw new Error(`Headless framework root includes render feature: ${render.join(', ')}`);
  const chat = Object.keys(inputs).filter((path) => /@threadplane\/(?:react\/src\/chat\/|angular\/fesm2022\/threadplane-angular-chat\.mjs)/.test(path.replaceAll('\\', '/')));
  if (chat.length) throw new Error(`Headless framework root includes chat components: ${chat.join(', ')}`);
  const markdown = Object.keys(inputs).filter((path) => /@threadplane\/(?:(?:react|content)\/src\/markdown\/|angular\/fesm2022\/threadplane-angular-markdown\.mjs)/.test(path.replaceAll('\\', '/')));
  if (markdown.length) throw new Error(`Headless framework root includes Markdown feature: ${markdown.join(', ')}`);
}

export function plainExportTypes(specifiers) {
  const namespaces = specifiers.map((specifier, index) => `import * as entry${index} from ${JSON.stringify(specifier)};\nexport type Entry${index} = typeof entry${index};`).join('\n');
  if (!specifiers.includes('@threadplane/react/chat')) return namespaces;
  return `${namespaces}
import type { ConfirmDialogProps, ChatSidebarProps, ChatSidenavMode, ChatSidenavProps, ChatSidenavScrimProps, ThreadListItem, ThreadListProps, ThreadRenameFormProps, OverflowMenuItem, OverflowMenuProps } from '@threadplane/react/chat';
import type { ReactNode, MouseEvent, KeyboardEvent } from 'react';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type ConfirmDialogContract = Assert<Equal<ConfirmDialogProps, { readonly open: boolean; readonly title: string; readonly onConfirm: () => void; readonly onCancel: () => void; readonly body?: string; readonly confirmLabel?: string; readonly cancelLabel?: string; readonly tone?: 'normal' | 'destructive'; readonly pending?: boolean; readonly className?: string; readonly returnFocusTo?: HTMLElement | null }>>;
export type ThreadRenameFormContract = Assert<Equal<ThreadRenameFormProps, { readonly value: string; readonly onValueChange: (value: string) => void; readonly onSubmit: () => void; readonly onCancel: () => void; readonly pending?: boolean; readonly error?: string; readonly label?: string; readonly className?: string }>>;
export type OverflowMenuItemContract = Assert<Equal<OverflowMenuItem, { readonly id: string; readonly label: string; readonly disabled?: boolean; readonly tone?: 'normal' | 'destructive' }>>;
export type OverflowMenuPropsContract = Assert<Equal<OverflowMenuProps, { readonly items: readonly OverflowMenuItem[]; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onSelect: (itemId: string, event: MouseEvent<HTMLButtonElement>) => void; readonly label: string; readonly className?: string; readonly disabled?: boolean; readonly anchorPoint?: { readonly x: number; readonly y: number } | null; readonly returnFocusTo?: HTMLElement | null }>>;
export type ThreadListItemContract = Assert<Equal<ThreadListItem, { readonly id: string; readonly title?: string; readonly updatedAt?: number; readonly pinned?: boolean }>>;
export type ThreadListRequiredContract = Assert<Equal<Pick<ThreadListProps, 'threads' | 'onSelect'>, { readonly threads: readonly ThreadListItem[]; readonly onSelect: (threadId: string) => void }>>;
export type ThreadListContextContract = Assert<Equal<Pick<ThreadListProps, 'onContextMenu'>, { readonly onContextMenu?: (threadId: string, event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) => void }>>;
export type ThreadListItemRendererContract = Assert<Equal<Pick<ThreadListProps, 'renderItem'>, { readonly renderItem?: (thread: ThreadListItem, isActive: boolean) => ReactNode }>>;
export type ThreadListActionsContract = Assert<Equal<Pick<ThreadListProps, 'renderActions'>, { readonly renderActions?: (thread: ThreadListItem) => ReactNode }>>;
export type ThreadListOptionsContract = Assert<Equal<Pick<ThreadListProps, 'activeThreadId' | 'label' | 'className' | 'onNewThread' | 'newThreadDisabled' | 'newThreadLabel' | 'now' | 'renderTitle'>, { readonly activeThreadId?: string | null; readonly label?: string; readonly className?: string; readonly onNewThread?: () => void; readonly newThreadDisabled?: boolean; readonly newThreadLabel?: string; readonly now?: number; readonly renderTitle?: (thread: ThreadListItem) => ReactNode }>>;
export type SidebarControlledContract = Assert<Equal<Pick<ChatSidebarProps, 'open' | 'onOpenChange' | 'title'>, { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly title: string }>>;
export type SidebarLayoutOptionsContract = Assert<Equal<Pick<ChatSidebarProps, 'pageContent' | 'pushContent'>, { readonly pageContent?: ReactNode; readonly pushContent?: boolean }>>;
type Controlled = Pick<ChatSidenavProps, 'mode' | 'open' | 'onOpenChange' | 'onModeChange'>;
export type SidenavCollapsedContentContract = Assert<Equal<Pick<ChatSidenavProps, 'collapsedContent'>, { readonly collapsedContent?: ReactNode }>>;
export type SidenavToggleShortcutContract = Assert<Equal<Pick<ChatSidenavProps, 'toggleShortcut'>, { readonly toggleShortcut?: boolean }>>;
export type SidenavSearchRequestContract = Assert<Equal<Pick<ChatSidenavProps, 'onSearch'>, { readonly onSearch?: () => void }>>;
export type SidenavSearchLabelContract = Assert<Equal<Pick<ChatSidenavProps, 'searchLabel'>, { readonly searchLabel?: string }>>;
export type SidenavSearchShortcutContract = Assert<Equal<Pick<ChatSidenavProps, 'searchShortcut'>, { readonly searchShortcut?: boolean }>>;
export type SidenavModeContract = Assert<Equal<ChatSidenavMode, 'expanded' | 'collapsed' | 'drawer'>>;
export type SidenavRequiredContract = Assert<Equal<Controlled, Required<Controlled>>>;
export type SidenavModePropContract = Assert<Equal<ChatSidenavProps['mode'], ChatSidenavMode>>;
export type SidenavOpenPropContract = Assert<Equal<ChatSidenavProps['open'], boolean>>;
export type SidenavModeCallbackContract = Assert<Equal<ChatSidenavProps['onModeChange'], (mode: Exclude<ChatSidenavMode, 'drawer'>) => void>>;
export type SidenavOpenCallbackContract = Assert<Equal<ChatSidenavProps['onOpenChange'], (open: boolean) => void>>;
type ScrimControlled = Pick<ChatSidenavScrimProps, 'open' | 'onDismiss'>;
export type ScrimRequiredContract = Assert<Equal<ScrimControlled, Required<ScrimControlled>>>;
export type ScrimOpenContract = Assert<Equal<ChatSidenavScrimProps['open'], boolean>>;
export type ScrimDismissContract = Assert<Equal<ChatSidenavScrimProps['onDismiss'], () => void>>;
export type ScrimOptionsContract = Assert<Equal<Pick<ChatSidenavScrimProps, 'label' | 'className'>, { readonly label?: string; readonly className?: string }>>;
`;
}

function verifyPlainExports(root, consumer, projects) {
  const specifiers = projects.flatMap((project) => consumerSpecifiers(JSON.parse(readFileSync(join(consumer, 'node_modules/@threadplane', project, 'package.json'), 'utf8'))));
  writeFileSync(join(consumer, 'index.mjs'), `${assertSupportedExports.toString()}\n` + specifiers.map((specifier) => `assertSupportedExports(${JSON.stringify(specifier.slice('@threadplane/'.length))}, await import(${JSON.stringify(specifier)}));`).join('\n'));
  writeFileSync(join(consumer, 'index.ts'), plainExportTypes(specifiers));
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM'], types: [], strict: true, skipLibCheck: false, noEmit: true }, files: ['index.ts'] }));
  runConsumer(process.execPath, ['index.mjs'], consumer);
  runConsumer(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer);
  return specifiers.length;
}

export function lockedRenderStateSdk(lock) {
  const sdk = lock.packages?.['node_modules/@json-render/core'];
  const zod = lock.packages?.['node_modules/@json-render/core/node_modules/zod'] ?? lock.packages?.['node_modules/zod'];
  if (!sdk?.version || !zod?.version) throw new Error('Missing root lock version for render-state SDK compile graph');
  return { '@json-render/core': sdk.version, zod: zod.version };
}

export function verifyRenderStateDeclarations(consumer) {
  // A mandatory direct import prevents a removed manifest subpath from silently
  // disappearing from the general manifest-driven enumeration.
  const probe = join(consumer, 'render-state-exports.ts');
  writeFileSync(probe, "import * as owner from '@threadplane/content/render-state';\nexport type InstalledOwner = typeof owner;\n");
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: false, noEmit: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] };
  const program = ts.createProgram([probe], options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: p => p, getCurrentDirectory: () => consumer, getNewLine: () => '\n' }));
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(program.getSourceFile(probe).statements[0].moduleSpecifier);
  const declaration = module?.declarations?.find(node => ts.isSourceFile(node) && node.isDeclarationFile)?.fileName;
  if (!declaration || !declaration.replaceAll('\\', '/').includes('/node_modules/@threadplane/content/')) throw new Error('Cannot resolve installed render-state declarations');
  const runtime = [], types = [];
  const exports = checker.getExportsOfModule(module);
  for (const exported of exports) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    if (symbol.flags & ts.SymbolFlags.Value) runtime.push(exported.name);
    if (symbol.flags & ts.SymbolFlags.Type) types.push(exported.name);
  }
  runtime.sort(); types.sort();
  const expectedTypes = ['RenderState', 'RenderStateChange', 'RenderStateSnapshot', 'RenderStateValue'];
  const names = exports.map(symbol => symbol.name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...expectedTypes, 'createRenderState'].sort()) || JSON.stringify(runtime) !== JSON.stringify(['createRenderState']) || JSON.stringify(types) !== JSON.stringify(expectedTypes)) throw new Error(`render-state has unexpected declaration exports: ${JSON.stringify({ names, runtime, types })}`);
  return { declaration, runtime, types, strict: true, skipLibCheck: false, files: program.getSourceFiles().map(source => source.fileName) };
}

export function assertRenderStateInputs(inputs) {
  const paths = Object.keys(inputs ?? {}).map(path => path.replaceAll('\\', '/'));
  for (const name of ['index', 'create-render-state', 'pointer', 'owned-value']) {
    if (!paths.some(path => path.endsWith(`/node_modules/@threadplane/content/src/render-state/${name}.js`) || path === `node_modules/@threadplane/content/src/render-state/${name}.js`)) throw new Error(`Missing installed emitted render-state owner implementation ${name}`);
  }
  const forbidden = paths.filter(path => path !== 'render-state-owner.mjs' && !/^(?:.*\/)?node_modules\/@threadplane\/content\/src\/render-state\/[^/]+\.js$/.test(path));
  if (forbidden.length) throw new Error(`render-state owner has forbidden inputs: ${forbidden.join(', ')}`);
}

function verifyInstalledRenderState(root, ownerConsumer, plain, rootLock) {
  const ownerLock = JSON.parse(readFileSync(join(ownerConsumer, 'package-lock.json'), 'utf8'));
  const optional = Object.keys(ownerLock.packages).filter(path => /node_modules\/(?:@threadplane\/a2ui|@json-render\/|@angular\/|react(?:-dom)?(?:\/|$))/.test(path));
  if (optional.length) throw new Error(`Owner-only install includes optional frameworks/SDK/protocol: ${optional}`);
  cpSync(join(root, 'fixtures/react-parity/render-state/installed-runtime.mjs'), join(ownerConsumer, 'render-state-owner.mjs'));
  const runtime = runConsumer(process.execPath, ['render-state-owner.mjs'], ownerConsumer);
  console.log(runtime);
  const bundle = buildSync({ absWorkingDir: ownerConsumer, entryPoints: ['render-state-owner.mjs'], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
  assertRenderStateInputs(bundle.metafile.inputs);
  writeFileSync(join(ownerConsumer, 'render-state-owner.bundle.mjs'), bundle.outputFiles[0].contents);
  const bundledRuntime = runConsumer(process.execPath, ['render-state-owner.bundle.mjs'], ownerConsumer);
  if (bundledRuntime !== runtime) throw new Error('Bundled owner runtime differs from installed module probe');
  // Root footprint remains independent of the optional owner entry.
  writeFileSync(join(ownerConsumer, 'content-root.mjs'), "import * as content from '@threadplane/content'; console.log(Object.keys(content));\n");
  const contentRoot = buildSync({ absWorkingDir: ownerConsumer, entryPoints: ['content-root.mjs'], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
  if (Object.keys(contentRoot.metafile.inputs).some(path => /\/render-state\//.test(path))) throw new Error('Content root includes optional render-state owner');
  const declarations = verifyRenderStateDeclarations(plain);
  cpSync(join(root, 'fixtures/react-parity/render-state/installed-types.ts'), join(plain, 'render-state-types.ts'));
  writeFileSync(join(plain, 'tsconfig.render-state.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM'], types: [], strict: true, skipLibCheck: false, noEmit: true }, files: ['render-state-types.ts'] }));
  runConsumer(process.execPath, [join(plain, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.render-state.json'], plain);
  const sdkResolution = ts.resolveModuleName('@json-render/core', join(plain, 'render-state-types.ts'), { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }, ts.sys).resolvedModule;
  if (!sdkResolution?.resolvedFileName.includes(join(plain, 'node_modules/@json-render/core/'))) throw new Error('SDK compatibility must resolve the installed SDK declaration');
  const installedSdk = JSON.parse(readFileSync(join(plain, 'node_modules/@json-render/core/package.json'), 'utf8'));
  if (installedSdk.version !== lockedRenderStateSdk(rootLock)['@json-render/core']) throw new Error('Installed SDK differs from the root lock');
  const sdkConfig = ts.readConfigFile(join(plain, 'tsconfig.render-state.json'), ts.sys.readFile);
  const sdkParsed = ts.parseJsonConfigFileContent(sdkConfig.config, ts.sys, plain);
  const sdkProgram = ts.createProgram(sdkParsed.fileNames, sdkParsed.options);
  const sdkDiagnostics = ts.getPreEmitDiagnostics(sdkProgram);
  if (sdkDiagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(sdkDiagnostics, { getCanonicalFileName: p => p, getCurrentDirectory: () => plain, getNewLine: () => '\n' }));
  const evidence = { declarations, sdk: { version: installedSdk.version, resolution: sdkResolution, strict: true, skipLibCheck: false, files: sdkProgram.getSourceFiles().map(source => source.fileName) }, runtime, bundledRuntime, ownerLock, bundle: { metafile: bundle.metafile, outputs: bundle.outputFiles.map(file => ({ path: file.path, bytes: file.contents.length })) }, contentRoot: { metafile: contentRoot.metafile, bytes: contentRoot.outputFiles[0].contents.length } };
  writeFileSync(join(ownerConsumer, 'render-state-proof.json'), JSON.stringify(evidence, null, 2));
  console.log(`Installed render-state proof: ${JSON.stringify(evidence)}`);
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
        'ChatPopup',
        'ChatSidebar',
        'ChatSidenav',
        'ChatSidenavScrim',
        'ChatInput',
        'Citations',
        'ConfirmDialog',
        'MessageList',
        'MessageActions',
        'OverflowMenu',
        'Reasoning',
        'TextTranscript',
        'ThreadList',
        'ThreadRenameForm',
        'ToolObservation',
      ],
      'react/debug': ['ChatDebug'],
      'react/markdown': ['Markdown'],
      'react/render': ['RenderSpec'],
      'content/json': ['createJson'],
      'content/a2ui': ['createA2uiSurfaces'],
      'content/render-state': ['createRenderState'],
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
    ['react', 'react/debug', 'react/chat', 'react/markdown', 'react/render', 'content/json', 'content/a2ui', 'content/render-state'].includes(project) &&
    Object.keys(entry).some((name) => !expected.includes(name))
  )
    throw new Error(`${project} has unexpected exports`);
}

export async function verifyPackedConsumers(root = process.cwd(), { retain = false } = {}) {
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
    const rootLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    const plainManifest = lockedReactManifest(rootLock);
    plainManifest.devDependencies = { ...plainManifest.devDependencies, ...lockedRenderStateSdk(rootLock) };
    installConsumer(plain, plainManifest, tarballs, 'plain');
    const owner = join(temporary, 'render-state-consumer');
    mkdirSync(owner);
    // Keep protocol and SDK selection out of the owner-only graph.
    installConsumer(owner, { private: true, type: 'module' }, Object.fromEntries(['core', 'content'].map(project => [`@threadplane/${project}`, tarballs[`@threadplane/${project}`]])), 'plain');
    verifyInstalledRenderState(root, owner, plain, rootLock);
    const installedLock = JSON.parse(readFileSync(join(plain, 'package-lock.json'), 'utf8'));
    console.log(`Installed local candidate resolutions: ${JSON.stringify(Object.fromEntries(Object.entries(installedLock.packages).filter(([path]) => path.includes('node_modules/@threadplane/')).map(([path, entry]) => [path, { version: entry.version, resolved: entry.resolved, integrity: entry.integrity }])) )}`);
    const count = verifyPlainExports(root, plain, Object.keys(tarballs).map((name) => name.slice('@threadplane/'.length)));
    cpSync(join(root, 'fixtures/react-parity/runtime/sidenav-ssr.mjs'), join(plain, 'sidenav-ssr.mjs'));
    console.log(runConsumer(process.execPath, ['sidenav-ssr.mjs'], plain));
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
  } finally {
    if (retain) console.log(`Retained packed consumer evidence: ${temporary}`);
    else rmSync(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyPackedConsumers(process.cwd(), { retain: process.argv.includes('--retain') });
