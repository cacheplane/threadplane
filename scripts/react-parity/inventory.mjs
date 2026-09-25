#!/usr/bin/env node
/** T01 source evidence, not a typecheck or a claim that React parity is implemented. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const DEFAULT_SCOPE = {
  libraries: ['a2ui', 'ag-ui', 'angular', 'chat', 'cockpit-registry', 'cockpit-runtime-bridge', 'cockpit-shell', 'cockpit-telemetry', 'design-tokens', 'e2e-harness', 'example-layouts', 'langgraph', 'middleware', 'react', 'render', 'telemetry', 'ui-react', 'workspace-react'],
  entryPoints: ['libs/a2ui/src/index.ts', 'libs/ag-ui/src/public-api.ts', 'libs/angular/src/public-api.ts', 'libs/angular/chat/src/public-api.ts', 'libs/chat/src/public-api.ts', 'libs/chat/debug/public-api.ts', 'libs/chat/testing/public-api.ts', 'libs/langgraph/src/public-api.ts', 'libs/middleware/src/langgraph/index.ts', 'libs/react/src/index.ts', 'libs/react/src/chat/index.ts', 'libs/render/src/public-api.ts', 'libs/telemetry/src/index.ts', 'libs/telemetry/src/browser/public-api.ts', 'libs/telemetry/src/node/index.ts', 'libs/telemetry/src/shared/public-api.ts'],
  docsRoot: 'apps/website/content/docs',
  topicsRoot: 'cockpit',
  configFiles: ['package.json', 'package-lock.json', 'nx.json', 'tsconfig.base.json', '.github/workflows/ci.yml', '.github/workflows/publish.yml', '.github/workflows/release-provenance.yml', '.github/workflows/publish-middleware-npm.yml', '.github/workflows/publish-middleware-python.yml', 'scripts/verify-release-versions.mjs', 'scripts/cockpit-matrix.mjs', 'scripts/assemble-examples.ts', 'scripts/examples/serve-example.ts', 'apps/website/scripts/generate-api-docs.ts', 'apps/website/scripts/generate-narrative-docs.ts', 'apps/website/scripts/generate-agent-context.ts'],
};

const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const portable = path => path.split(sep).join('/');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const isSource = path => /\.(?:[cm]?[jt]s|tsx|jsx)$/.test(path);
const isTest = path => /\.(?:spec|test|type-spec|type-test)\.[^.]+$/.test(path);
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const signature = node => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());

function pathsInRepository(root, scope) {
  // --others is intentional: a new source file must not escape review until git add.
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...scope.libraries.map(name => `libs/${name}`), scope.docsRoot, scope.topicsRoot, ...scope.configFiles], { cwd: root, encoding: 'utf8' });
  return [...new Set(paths.split('\0').filter(path => path && existsSync(resolve(root, path))))].sort(lexical);
}

function createProgram(root, paths) {
  const configPath = resolve(root, 'tsconfig.base.json');
  const config = existsSync(configPath) ? ts.readConfigFile(configPath, ts.sys.readFile) : { config: {} };
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const converted = ts.convertCompilerOptionsFromJson(config.config.compilerOptions ?? {}, root);
  const options = { ...converted.options, noEmit: true, noLib: true, allowJs: true, checkJs: false, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(options);
  // Inventory the repository's source contract. Installed dependency declarations
  // are deliberately excluded: their graph is separately pinned by package-lock.
  host.resolveModuleNames = (names, containingFile) => names.map(name => {
    const resolved = ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
    return resolved && !portable(resolved.resolvedFileName).includes('/node_modules/') ? resolved : undefined;
  });
  return ts.createProgram(paths.map(path => resolve(root, path)), options, host);
}

function decoratorName(decorator, source) {
  const expression = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
  if (ts.isPropertyAccessExpression(expression)) {
    const namespace = source.statements.find(statement => ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === '@angular/core' && statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings) && statement.importClause.namedBindings.name.text === expression.expression.getText(source));
    return namespace ? expression.name.text : undefined;
  }
  if (!ts.isIdentifier(expression)) return undefined;
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== '@angular/core') continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const binding = bindings.elements.find(element => element.name.text === expression.text);
    if (binding) return binding.propertyName?.text ?? binding.name.text;
  }
  return undefined;
}

export function collectInventory(root, scope = DEFAULT_SCOPE) {
  root = resolve(root);
  const paths = pathsInRepository(root, scope);
  const scoped = paths.filter(path => scope.libraries.some(name => path.startsWith(`libs/${name}/`)));
  const sources = scoped.filter(path => isSource(path) && !isTest(path));
  const topicProjects = paths.filter(path => path.startsWith(`${scope.topicsRoot}/`) && /\/angular\/project.json$/.test(path));
  const topicSources = topicProjects.map(path => path.replace(/project.json$/, 'src/index.ts'));
  const program = createProgram(root, [...sources, ...scope.entryPoints, ...topicSources]);
  const syntaxErrors = program.getSyntacticDiagnostics();
  if (syntaxErrors.length) throw new Error(syntaxErrors.map(error => `Syntax error ${portable(relative(root, error.file.fileName))}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`).join('\n'));
  const checker = program.getTypeChecker();
  const rows = [];
  const fileRow = (kind, path) => rows.push({ id: `${kind}:${path}`, kind, path, sha256: sha256(readFileSync(resolve(root, path))) });
  for (const path of sources) fileRow('source', path);
  // These are the selected libraries' non-source package assets/configuration,
  // including styles, notices, manifests, and build metadata; no whole-repo dump.
  for (const path of scoped.filter(path => !isSource(path))) fileRow('asset', path);
  for (const path of scope.configFiles.filter(path => paths.includes(path))) fileRow('config', path);
  for (const path of paths.filter(path => path.startsWith(`${scope.docsRoot}/`) && path.endsWith('.mdx'))) fileRow('doc', path);

  const describe = node => ({
    path: portable(relative(root, node.getSourceFile().fileName)),
    symbol: node.name?.getText(node.getSourceFile()) ?? '(anonymous)',
    syntaxKind: ts.SyntaxKind[node.kind],
    // Keeping normalized declaration text makes review useful, while source-file
    // digests also catch changes to private types used by a public signature.
    signature: signature(ts.isImportSpecifier(node) ? node.parent.parent.parent : ts.isExportSpecifier(node) ? node.parent.parent : node),
  });
  for (const path of scope.entryPoints) {
    const source = program.getSourceFile(resolve(root, path));
    if (!source) throw new Error(`Missing entry point: ${path}`);
    const module = checker.getSymbolAtLocation(source);
    if (!module) throw new Error(`Entry point is not a module: ${path}`);
    rows.push({ id: `entry:${path}`, kind: 'entry', path });
    for (const symbol of checker.getExportsOfModule(module)) {
      let target = symbol;
      const visited = new Set();
      while (target.flags & ts.SymbolFlags.Alias && !visited.has(target)) {
        visited.add(target);
        const next = checker.getImmediateAliasedSymbol(target);
        if (!next?.declarations?.length) break;
        target = next;
      }
      const declarations = target.declarations;
      if (!declarations?.length) throw new Error(`Unresolved export: ${path}#${symbol.name}`);
      rows.push({ id: `export:${path}#${symbol.name}`, kind: 'export', path, symbol: symbol.name, declarations: declarations.map(describe).sort((a, b) => lexical(JSON.stringify(a), JSON.stringify(b))) });
    }
  }
  for (const path of sources) {
    const source = program.getSourceFile(resolve(root, path));
    if (!source) continue;
    const visit = node => {
      if (ts.isClassDeclaration(node)) {
        const decorators = (ts.getDecorators(node) ?? []).map(decorator => decoratorName(decorator, source)).filter(name => name === 'Component' || name === 'Directive');
        if (decorators.length) {
          if (!node.name) throw new Error(`Unnamed decorated declaration: ${path}`);
          rows.push({ id: `component:${path}#${node.name.text}`, kind: 'component', path, symbol: node.name.text, decorators, signature: signature(node) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const path of topicSources) {
    const source = program.getSourceFile(resolve(root, path));
    if (!source) throw new Error(`Missing topic source: ${path}`);
    const ids = [];
    const visit = node => {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        const id = node.initializer.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source).replaceAll(/['"]/g, '') === 'id');
        if (id && ts.isStringLiteralLike(id.initializer)) ids.push(id.initializer.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (ids.length !== 1) throw new Error(`Expected one topic ID in ${path}, found ${ids.length}`);
    rows.push({ id: `topic:${ids[0]}`, kind: 'topic', path, topicId: ids[0], project: path.replace(/src\/index.ts$/, 'project.json'), sha256: sha256(readFileSync(resolve(root, path))) });
  }
  rows.sort((a, b) => lexical(a.id, b.id));
  return { schemaVersion: 1, scope, rows };
}

function indexRows(rows, label, errors) {
  const result = new Map();
  for (const row of rows) {
    if (result.has(row.id)) errors.push(`Duplicate ${label}: ${row.id}`);
    result.set(row.id, row);
  }
  return result;
}

export function compareInventories(baseline, actual) {
  const errors = [];
  if (baseline.schemaVersion !== actual.schemaVersion) errors.push('Unsupported inventory schemaVersion');
  if (JSON.stringify(baseline.scope) !== JSON.stringify(actual.scope)) errors.push('Inventory scope changed');
  const previous = indexRows(baseline.rows, 'baseline record', errors);
  const current = indexRows(actual.rows, 'current record', errors);
  for (const [id, row] of previous) {
    if (!current.has(id)) errors.push(`Missing ${id}`);
    else if (JSON.stringify(row) !== JSON.stringify(current.get(id))) errors.push(`Changed ${id}`);
  }
  for (const id of current.keys()) if (!previous.has(id)) errors.push(`Added ${id}`);
  return errors;
}

export function validateDispositions(inventory, dispositions) {
  const errors = [];
  if (dispositions.schemaVersion !== 1) errors.push('Unsupported dispositions schemaVersion');
  const facts = indexRows(inventory.rows, 'inventory record', errors);
  const assignments = indexRows(dispositions.rows, 'disposition', errors);
  const treatments = new Set(['shared', 'angular-only', 'react', 'internal', 'infrastructure', 'excluded']);
  for (const id of facts.keys()) if (!assignments.has(id)) errors.push(`Missing disposition: ${id}`);
  for (const [id, row] of assignments) {
    if (!facts.has(id)) errors.push(`Stale disposition source reference: ${id}`);
    if (!Array.isArray(row.taskIds) || row.taskIds.length === 0) errors.push(`Missing task IDs: ${id}`);
    else {
      for (const task of row.taskIds) if (typeof task !== 'string' || !/^T(?:0[1-9]|[12][0-9]|3[0-9])$/.test(task)) errors.push(`Unknown task ID ${task}: ${id}`);
      if (new Set(row.taskIds).size !== row.taskIds.length) errors.push(`Duplicate task ID: ${id}`);
    }
    if (!treatments.has(row.treatment)) errors.push(`Unknown treatment: ${id}`);
    if (['angular-only', 'internal', 'excluded'].includes(row.treatment) && (typeof row.reason !== 'string' || !row.reason.trim())) errors.push(`Explicit reason required for ${row.treatment}: ${id}`);
    if (!['planned', 'in-progress', 'complete'].includes(row.status)) errors.push(`Unknown planning status: ${id}`);
  }
  return errors;
}

export function summarize(inventory) {
  const counts = {};
  for (const row of inventory.rows) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
  counts.uniqueExportDefinitions = new Set(inventory.rows.filter(row => row.kind === 'export').flatMap(row => row.declarations.map(declaration => `${declaration.path}#${declaration.symbol}:${declaration.syntaxKind}`))).size;
  counts.componentFiles = new Set(inventory.rows.filter(row => row.kind === 'component').map(row => row.path)).size;
  counts.libraries = inventory.scope.libraries.length;
  return counts;
}

function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(`Usage: node scripts/react-parity/inventory.mjs --check | --write-baseline
  --check           Read-only drift and planning-ownership validation.
  --write-baseline  Explicitly regenerate facts; never rewrites dispositions.
  --root PATH       Repository root (default: the script's repository).
  --baseline PATH   Inventory facts JSON (default: scripts/react-parity/baseline.json).
  --dispositions PATH  Ownership JSON (default: scripts/react-parity/dispositions.json).

The baseline scope declares selected libraries, public entries, docs, topics and
distribution configuration; initial generation uses DEFAULT_SCOPE in this script.
Git-tracked and non-ignored untracked scoped files are included. Test source is
excluded; package test configuration and fixture assets remain in scope.
AST declaration signatures include implementation text; file digests intentionally
detect source, asset and documentation edits as well as structural API changes.
External dependencies are represented by local import contracts, not node_modules.
Explicit regeneration records the current Git HEAD and scoped modified/untracked
paths; review this provenance change with the fact diff and preserve the prior
baseline in Git history. It does not certify React implementation parity. Adjust
dispositions separately. No research Markdown is read at runtime.`);
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--check', '--write-baseline'].includes(arg)) options[arg] = true;
    else if (['--root', '--baseline', '--dispositions'].includes(arg) && args[index + 1]) options[arg] = args[++index];
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if (Boolean(options['--check']) === Boolean(options['--write-baseline'])) throw new Error('Choose --check (read only) or --write-baseline (explicitly update facts; dispositions remain manual).');
  const root = resolve(options['--root'] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  const baselinePath = resolve(options['--baseline'] ?? resolve(root, 'scripts/react-parity/baseline.json'));
  const dispositionsPath = resolve(options['--dispositions'] ?? resolve(root, 'scripts/react-parity/dispositions.json'));
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : undefined;
  const actual = collectInventory(root, baseline?.scope ?? DEFAULT_SCOPE);
  if (options['--write-baseline']) {
    const baselineHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const paths = new Set([...actual.rows, ...(baseline?.rows ?? [])].flatMap(row => [row.path, ...(row.declarations ?? []).map(declaration => declaration.path)]));
    const changedPaths = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(path => paths.has(path)).sort(lexical);
    const sourceState = {
      modified: changedPaths(['diff', 'HEAD', '--name-only', '-z']),
      untracked: changedPaths(['ls-files', '--others', '--exclude-standard', '-z']),
    };
    const recorded = { schemaVersion: actual.schemaVersion, baselineHead, sourceState, scope: actual.scope, rows: actual.rows };
    writeFileSync(baselinePath, `${JSON.stringify(recorded, null, 2)}\n`);
    console.log(`Wrote inventory facts; review and update dispositions separately. ${JSON.stringify(summarize(actual))}`);
    return;
  }
  if (!baseline) throw new Error(`Missing baseline: ${baselinePath}`);
  const dispositions = JSON.parse(readFileSync(dispositionsPath, 'utf8'));
  const errors = [...compareInventories(baseline, actual), ...validateDispositions(actual, dispositions)];
  if (!/^[a-f0-9]{40}$/.test(baseline.baselineHead ?? '')) errors.push('Missing or invalid baselineHead provenance');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Parity inventory and planning ownership valid (not implementation parity). ${JSON.stringify(summarize(actual))}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
