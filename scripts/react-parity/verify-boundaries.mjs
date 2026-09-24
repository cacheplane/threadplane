import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { angularTransitionProjects, assertFinalRelease, emittedEntries, forbiddenDependency, langGraphRuntimeSourceKind, manifestViolations, neutralLangGraphRoots, packageOf, privateScaffoldProjects, scanProjects, sourceEntry } from './package-policy.mjs';

export const foundationProjects = privateScaffoldProjects;
const optional = /(?:^|\/)(?:testing|zod|math)(?:\/|$)/;
const reactFeature = /^(?:chat|markdown|a2ui|debug|tools|testing|render)(?:\/|$)/;
const sourceFile = /\.(?:[cm]?[jt]sx?)$/;
const testFile = /(?:\.(?:spec|test|type-test)\.[cm]?[jt]sx?$|\/test-setup\.)/;
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function filesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : sourceFile.test(path) && !testFile.test(path) ? [path] : [];
  });
}

// Parse syntax rather than matching source text: type-only imports, import types,
// re-exports, dynamic imports and CommonJS imports all contribute dependency edges.
function importsIn(path) {
  const text = readFileSync(path, 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imports = [];
  const diagnostics = source.parseDiagnostics.map(() => 'invalid source syntax');
  const add = (node) => { if (node && ts.isStringLiteralLike(node)) imports.push(node.text); };
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) add(node.arguments[0]);
      else diagnostics.push(node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'nonliteral import target' : 'nonliteral require target');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  // Triple-slash type references can leak a dependency without an import node.
  imports.push(...source.typeReferenceDirectives.map((reference) => reference.fileName));
  imports.push(...source.referencedFiles.map((reference) => reference.fileName.startsWith('.') ? reference.fileName : `./${reference.fileName}`));
  return { imports, diagnostics };
}

function projectOf(path) {
  return path.replaceAll('\\', '/').match(/(?:^|\/)(?:dist\/)?libs\/([^/]+)\//)?.[1];
}
export function verifyBoundaries({ root = process.cwd(), mode = 'source', projects = scanProjects, angularTransitions = angularTransitionProjects, telemetryBrowserTransition = true, finalRelease = false } = {}) {
  root = resolve(root);
  const errors = new Set(finalRelease ? assertFinalRelease({ projects, angularTransitions, telemetryBrowserTransition }) : []);
  const configPath = join(root, 'tsconfig.base.json');
  const config = existsSync(configPath) ? ts.readConfigFile(configPath, ts.sys.readFile).config : {};
  const options = ts.convertCompilerOptionsFromJson(config.compilerOptions ?? {}, root).options;
  options.pathsBasePath = root;
  options.moduleResolution = ts.ModuleResolutionKind.Bundler;
  const cache = new Map();
  const prefix = mode === 'built' ? 'dist/libs' : 'libs';
  // Resolve filesystem identity before applying exact source exceptions. Import
  // spelling can differ in case or traverse a symlink on supported filesystems.
  const identities = new Map();
  const canonical = (path) => {
    if (!identities.has(path)) identities.set(path, existsSync(path) ? realpathSync.native(path) : path);
    return identities.get(path);
  };
  const canonicalRoot = canonical(root);
  const runtimeSourceKind = (path) => langGraphRuntimeSourceKind(canonicalRoot, canonical(path));
  const manifestFor = (project) => {
    const path = join(root, prefix, project, 'package.json');
    return existsSync(path) ? readJson(path) : undefined;
  };
  function resolveImport(specifier, from) {
    if (mode === 'source') return ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule?.resolvedFileName;
    if (specifier.startsWith('.')) {
      const base = resolve(dirname(from), specifier);
      const declaration = from.endsWith('.d.ts');
      const candidates = declaration ? [base.replace(/\.js$/, '.d.ts'), base, `${base}.d.ts`, join(base, 'index.d.ts')] : [base, `${base}.js`, join(base, 'index.js')];
      return candidates.find((path) => existsSync(path) && sourceFile.test(path));
    }
    const match = specifier.match(/^@threadplane\/([^/]+)(?:\/(.*))?$/);
    if (!match) return undefined;
    const manifest = manifestFor(match[1]);
    const declaration = from.endsWith('.d.ts');
    const target = emittedEntries(manifest, match[2] ? `./${match[2]}` : '.').find((entry) => declaration ? /\.d\.[cm]?ts$/.test(entry) : /\.[cm]?js$/.test(entry));
    return target ? join(root, prefix, match[1], target) : undefined;
  }
  for (const project of projects) {
    const directory = join(root, prefix, project);
    if (!existsSync(directory)) { errors.add(`${project}: missing ${mode} package`); continue; }
    const manifestPath = join(directory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = readJson(manifestPath);
      for (const error of manifestViolations(project, manifest, { angularTransitions, telemetryBrowserTransition })) errors.add(error);
    }
    const allFiles = filesIn(mode === 'source' ? join(directory, 'src') : directory);
    // Existing Angular secondary entry points live alongside src.
    if (mode === 'source' && (project === 'angular' || angularTransitions.includes(project))) allFiles.push(...filesIn(directory).filter((path) => !path.includes('/src/')));
    const manifest = manifestFor(project);
    const roots = mode === 'source' ? [join(directory, sourceEntry(project, angularTransitions))] : emittedEntries(manifest).filter((value) => sourceFile.test(value)).map((value) => join(directory, value));
    const browserEntries = mode === 'built' ? emittedEntries(manifest, './browser').map((value) => join(directory, value)) : [];
    const browserPath = (path) => project === 'telemetry' && telemetryBrowserTransition && (path.startsWith(join(directory, mode === 'source' ? 'src/browser' : 'browser') + '/') || browserEntries.includes(path));
    const visited = new Set();
    function visit(path, rootRuntime, ancestry = [], browserTransition = false, neutralRuntime = false, legacyRuntime = false) {
      const key = `${path}:${rootRuntime}:${browserTransition}:${neutralRuntime}:${legacyRuntime}`;
      if (visited.has(key)) return;
      visited.add(key);
      if (!existsSync(path)) { errors.add(`${project}: unresolved ${relative(root, path)}`); return; }
      const dependencies = cache.get(path) ?? importsIn(path);
      cache.set(path, dependencies);
      if (mode === 'source' && (neutralRuntime || legacyRuntime)) {
        for (const diagnostic of dependencies.diagnostics) errors.add(`${project}: cannot analyze guarded dependencies ${relative(root, path)}: ${diagnostic}`);
      }
      for (const specifier of dependencies.imports) {
        const target = resolveImport(specifier, path);
        const targetProject = target && projectOf(target);
        const normalized = targetProject ? `@threadplane/${targetProject}` : specifier;
        const trail = [...ancestry, relative(root, path), specifier].join(' -> ');
        if (legacyRuntime && target && runtimeSourceKind(target) === 'private') errors.add(`${project}: private runtime reachable from legacy source: ${trail}`);
        const policy = { angularTransitions, rootRuntime, neutralRuntime, browserTransition: browserTransition && browserPath(path) };
        const label = neutralRuntime ? 'neutral runtime forbidden dependency' : 'forbidden dependency';
        if (forbiddenDependency(project, specifier, policy) || forbiddenDependency(project, normalized, policy)) errors.add(`${project}: ${label} ${trail}`);
        if (neutralRuntime && (
          optional.test(specifier) || (target && optional.test(relative(directory, target))) ||
          (specifier.startsWith('@threadplane/core/') && specifier !== '@threadplane/core/tools') ||
          (targetProject === 'core' && projectOf(path) !== 'core' && !['@threadplane/core', '@threadplane/core/tools'].includes(specifier))
        )) errors.add(`${project}: neutral runtime private/testing dependency ${trail}`);
        // Every core entry is dependency-free. Explicitly
        // review any future external dependency instead of allowing a wrapper
        // package to hide a framework/parser dependency behind its own imports.
        if (project === 'core' && (!target || target.includes('/node_modules/')) && !specifier.startsWith('.')) errors.add(`${project}: unreviewed dependency ${trail}`);
        if (rootRuntime && (optional.test(specifier) || ['zod', 'katex'].includes(packageOf(specifier)) || (target && optional.test(relative(directory, target))))) errors.add(`${project}: optional/testing dependency reachable from root: ${trail}`);
        if (project === 'react' && rootRuntime && ((specifier.startsWith('@threadplane/react/') && reactFeature.test(specifier.slice('@threadplane/react/'.length))) || (targetProject === 'react' && reactFeature.test(relative(join(directory, 'src'), target))))) errors.add(`${project}: feature dependency reachable from root: ${trail}`);
        if (target && !target.includes('/node_modules/')) visit(target, rootRuntime, [...ancestry, relative(root, path)], browserTransition && browserPath(target), neutralRuntime, legacyRuntime);
        else if (!target && (specifier.startsWith('.') || specifier.startsWith('@threadplane/'))) errors.add(`${project}: unresolved dependency ${trail}`);
      }
    }
    for (const path of allFiles) visit(path, false, [], browserPath(path), false, mode === 'source' && angularTransitions.includes(project) && runtimeSourceKind(path) === undefined);
    if (mode === 'source' && project === 'langgraph') {
      const neutralRoots = [
        ...filesIn(join(directory, 'src/runtime')).filter((path) => !optional.test(relative(directory, path))),
        ...neutralLangGraphRoots.map((path) => join(directory, path)).filter(existsSync),
      ];
      for (const path of neutralRoots) visit(path, false, [], false, true);
    }
    if (!angularTransitions.includes(project)) {
      if (!roots.length) errors.add(`${project}: missing root exports`);
      for (const path of roots) visit(path, true);
    }
  }
  return [...errors].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.includes('--built') ? 'built' : 'source';
  const errors = verifyBoundaries({ mode, finalRelease: process.argv.includes('--final-release') });
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`React parity ${mode} boundaries verified.`);
}
