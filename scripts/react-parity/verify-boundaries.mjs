import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const foundationProjects = ['core', 'content', 'langgraph-core', 'ag-ui-core', 'react-render', 'react'];
const angularProjects = ['chat', 'langgraph', 'ag-ui', 'render'];
const optional = /(?:^|\/)(?:testing|zod|math)(?:\/|$)/;
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
  const add = (node) => { if (node && ts.isStringLiteralLike(node)) imports.push(node.text); };
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(source);
  // Triple-slash type references can leak a dependency without an import node.
  imports.push(...source.typeReferenceDirectives.map((reference) => reference.fileName));
  imports.push(...source.referencedFiles.map((reference) => reference.fileName.startsWith('.') ? reference.fileName : `./${reference.fileName}`));
  return imports;
}

function packageOf(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}
function projectOf(path) {
  return path.replaceAll('\\', '/').match(/(?:^|\/)(?:dist\/)?libs\/([^/]+)\//)?.[1];
}
function forbidden(project, specifier, rootRuntime) {
  const pkg = packageOf(specifier);
  const angular = pkg.startsWith('@angular/') || angularProjects.some((name) => pkg === `@threadplane/${name}`);
  const react = ['react', 'react-dom', '@types/react', '@types/react-dom'].includes(pkg) || ['react', 'react-render', 'ui-react', 'workspace-react'].some((name) => pkg === `@threadplane/${name}`);
  const backend = pkg.startsWith('@langchain/') || pkg.startsWith('@ag-ui/') || ['langgraph-core', 'ag-ui-core'].some((name) => pkg === `@threadplane/${name}`);
  const parser = ['@cacheplane/partial-json', '@cacheplane/partial-markdown', 'marked', 'remark-gfm', 'katex', 'shiki', '@threadplane/content'].includes(pkg);
  if (project === 'core') return angular || react || backend || parser || pkg === 'rxjs' || (rootRuntime && pkg === 'zod');
  if (project === 'content') return angular || react || backend || pkg === 'rxjs';
  if (['langgraph-core', 'ag-ui-core'].includes(project)) return angular || react;
  if (project.startsWith('react')) return angular || backend;
  return angularProjects.includes(project) && react;
}

export function verifyBoundaries({ root = process.cwd(), mode = 'source', projects = [...foundationProjects, ...angularProjects] } = {}) {
  root = resolve(root);
  const errors = new Set();
  const configPath = join(root, 'tsconfig.base.json');
  const config = existsSync(configPath) ? ts.readConfigFile(configPath, ts.sys.readFile).config : {};
  const options = ts.convertCompilerOptionsFromJson(config.compilerOptions ?? {}, root).options;
  options.pathsBasePath = root;
  options.moduleResolution = ts.ModuleResolutionKind.Bundler;
  const cache = new Map();
  const prefix = mode === 'built' ? 'dist/libs' : 'libs';
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
    const entry = manifest?.exports?.[match[2] ? `./${match[2]}` : '.'];
    const declaration = from.endsWith('.d.ts');
    let target = typeof entry === 'string' ? entry : entry?.[declaration ? 'types' : 'import'] ?? entry?.default;
    // Existing @nx/js packages such as a2ui expose legacy main/module/types.
    // Do not bypass an explicit exports map or invent undeclared subpaths.
    if (!manifest?.exports && !match[2]) target = declaration ? manifest?.types ?? manifest?.typings : manifest?.module ?? manifest?.main;
    return target ? join(root, prefix, match[1], target) : undefined;
  }
  for (const project of projects) {
    const directory = join(root, prefix, project);
    if (!existsSync(directory)) { errors.add(`${project}: missing ${mode} package`); continue; }
    const manifestPath = join(directory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = readJson(manifestPath);
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const dependency of Object.keys(manifest[field] ?? {})) {
          if (forbidden(project, dependency, false)) errors.add(`${project}: forbidden ${field} entry ${dependency}`);
        }
      }
    }
    const allFiles = filesIn(mode === 'source' ? join(directory, 'src') : directory);
    // Existing Angular secondary entry points live alongside src.
    if (mode === 'source' && angularProjects.includes(project)) allFiles.push(...filesIn(directory).filter((path) => !path.includes('/src/')));
    const manifestExports = manifestFor(project)?.exports;
    const roots = mode === 'source' ? [join(directory, 'src/index.ts')] : Object.values(manifestExports?.['.'] ?? {}).filter((value) => typeof value === 'string').map((value) => join(directory, value));
    const visited = new Set();
    function visit(path, rootRuntime, ancestry = []) {
      const key = `${path}:${rootRuntime}`;
      if (visited.has(key)) return;
      visited.add(key);
      if (!existsSync(path)) { errors.add(`${project}: unresolved ${relative(root, path)}`); return; }
      const dependencies = cache.get(path) ?? importsIn(path);
      cache.set(path, dependencies);
      for (const specifier of dependencies) {
        const target = resolveImport(specifier, path);
        const targetProject = target && projectOf(target);
        const normalized = targetProject ? `@threadplane/${targetProject}` : specifier;
        const trail = [...ancestry, relative(root, path), specifier].join(' -> ');
        if (forbidden(project, specifier, rootRuntime) || forbidden(project, normalized, rootRuntime)) errors.add(`${project}: forbidden dependency ${trail}`);
        // Core's root is dependency-free except for compiler helpers. Explicitly
        // review any future external dependency instead of allowing a wrapper
        // package to hide a framework/parser dependency behind its own imports.
        if (project === 'core' && rootRuntime && (!target || target.includes('/node_modules/')) && !specifier.startsWith('.') && packageOf(specifier) !== 'tslib') errors.add(`${project}: unreviewed root dependency ${trail}`);
        if (rootRuntime && (optional.test(specifier) || ['zod', 'katex'].includes(packageOf(specifier)) || (target && optional.test(relative(directory, target))))) errors.add(`${project}: optional/testing dependency reachable from root: ${trail}`);
        if (target && !target.includes('/node_modules/')) visit(target, rootRuntime, [...ancestry, relative(root, path)]);
        else if (!target && (specifier.startsWith('.') || specifier.startsWith('@threadplane/'))) errors.add(`${project}: unresolved dependency ${trail}`);
      }
    }
    for (const path of allFiles) visit(path, false);
    if (foundationProjects.includes(project)) {
      if (!roots.length) errors.add(`${project}: missing root exports`);
      for (const path of roots) visit(path, true);
    }
  }
  return [...errors].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.includes('--built') ? 'built' : 'source';
  const errors = verifyBoundaries({ mode });
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`React parity ${mode} boundaries verified.`);
}
