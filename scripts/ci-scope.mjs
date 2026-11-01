#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateScaffoldProjects } from './react-parity/package-policy.mjs';
import { requiresFullCockpitFleet } from './cockpit-matrix.mjs';

export const SCOPE_KEYS = [
  'library',
  'angular_compatibility',
  'website',
  'website_e2e',
  'cockpit',
  'cockpit_examples',
  'cockpit_smoke',
  'cockpit_e2e',
  'examples_chat',
  'examples_ag_ui',
  'posthog',
  'scripts_tests',
  'growth_lifecycle',
  'growth_research',
];

const GLOBAL_CI_FILES = new Set([
  '.github/workflows/ci.yml',
  'scripts/ci-scope.mjs',
  'scripts/ci-scope.spec.mjs',
  'scripts/cockpit-dependencies.mjs',
  'scripts/cockpit-dependencies-archive.py',
  'scripts/cockpit-dependencies.spec.mjs',
  'scripts/cockpit-matrix.mjs',
  'scripts/cockpit-matrix.spec.mjs',
  'package.json',
  'package-lock.json',
  '.npmrc',
  'nx.json',
  'tsconfig.json',
  'tsconfig.base.json',
  // Shared preparation changes affect both fresh and reused cockpit builds.
  'scripts/react-cockpit/build.mjs',
  'scripts/react-cockpit/consumer-preparation.mjs',
  'scripts/react-cockpit/prepare-consumer.mjs',
  'tools/website-runtime-preparation/project.json',
  // The Website server owner and cleanup checks must exercise browser CI.
  'scripts/website-angular-startup.mjs',
  'scripts/website-angular-startup.spec.mjs',
  'scripts/website-agents-startup.mjs',
  'scripts/website-agents-startup.spec.mjs',
]);

// These tests execute their complete generator proof in the Scripts target.
// Keep this reviewed list exact: mixed or unknown inputs use normal Nx discovery.
export const SCRIPTS_TEST_ONLY_FILES = Object.freeze([
  'scripts/generate-shared-deployment-config.spec.ts',
]);

export function isScriptsTestOnlyChange(changedFiles) {
  return changedFiles.length > 0 && changedFiles.every(file =>
    SCRIPTS_TEST_ONLY_FILES.includes(normalizePath(file)));
}

const PREVIEW_BUILD_FILES = new Set([
  'scripts/build-example-shard.ts',
  'scripts/example-build-artifacts.ts',
]);

const ANGULAR_COMPATIBILITY_FILES = new Set([
  'scripts/verify-angular-support.mjs',
  'scripts/verify-angular-support.spec.mjs',
  'libs/chat/package.json',
  'libs/langgraph/package.json',
  'libs/ag-ui/package.json',
  'libs/render/package.json',
  'libs/telemetry/package.json',
  'libs/cockpit-telemetry/package.json',
  'libs/example-layouts/package.json',
  'apps/website/src/components/pricing/angular-support.mjs',
  'apps/website/src/components/pricing/CompatibilityMatrix.tsx',
  'apps/website/src/components/pricing/PricingDetails.tsx',
  'README.md',
  'libs/chat/README.md',
  'libs/langgraph/README.md',
  'libs/ag-ui/README.md',
  'libs/render/README.md',
  'libs/telemetry/README.md',
  'apps/website/content/docs/chat/getting-started/installation.mdx',
  'apps/website/content/docs/langgraph/getting-started/installation.mdx',
  'apps/website/content/docs/ag-ui/getting-started/installation.mdx',
  'apps/website/content/docs/render/getting-started/installation.mdx',
]);

const ANGULAR_COMPATIBILITY_PREFIXES = [
  'examples/chat/smoke/',
  'examples/chat/angular/src/app/',
];

/** Files whose changes only affect linting (not builds, not e2e tests).
 *  These flip the scopes that actually run `nx lint` (library, cockpit,
 *  website, examples_chat) but do NOT trigger e2e/smoke/deploy jobs.
 *  Avoids the ~50 CI-minute spike from a one-line lint-config tweak
 *  re-running the 24-cap cockpit-e2e matrix. */
const LINT_ONLY_FILES = new Set(['eslint.config.mjs']);

/** Subset of SCOPE_KEYS that own jobs running `nx lint`. Flipped true
 *  when a LINT_ONLY_FILES entry changes. */
const LINT_SCOPE_KEYS = [
  'scripts_tests',
  'library',
  'cockpit',
  'website',
  'examples_chat',
  'growth_lifecycle',
  'growth_research',
];

/** The per-product `matrix.spec.ts` / `footprint.spec.ts` files sit at
 *  cockpit/<product>/, which is outside every project root. `nx affected`
 *  therefore attributes them to the `root` project, and `root` carries no
 *  `scope:` tag — so a PR touching only these specs produced an empty scope
 *  and skipped the job that owns cockpit changes. Map them onto the cockpit
 *  scope by path so that job still runs. They actually execute under the
 *  `cockpit` job through `cockpit-registry`'s vitest `test.include` globs
 *  (libs/cockpit-registry/vite.config.mts), which is what runs them today —
 *  this regex only decides which CI scope a change to them lights up. */
const COCKPIT_ROOTLESS_SPEC = /^cockpit\/[^/]+\/[^/]+\.spec\.ts$/;

// The Library lane's installed A2UI regression consumes only these scripts and
// the canonical Python source/lock/tests, independently of their Nx owner tags.
const A2UI_NATIVE_FIXTURE_FILES = new Set([
  'scripts/react-cockpit/chat-a2ui-wire.py',
  'scripts/react-cockpit/chat-a2ui-fixture.mjs',
  'scripts/react-cockpit/chat-a2ui-fixture.spec.mjs',
  'scripts/react-cockpit/chat-a2ui-native-probe.mjs',
  'cockpit/chat/a2ui/python/uv.lock',
  'cockpit/chat/a2ui/python/pyproject.toml',
  'cockpit/ag-ui/a2ui/python/src/graph.py',
  'cockpit/ag-ui/a2ui/python/src/__init__.py',
  'cockpit/ag-ui/a2ui/python/src/server.py',
  'cockpit/ag-ui/a2ui/python/pyproject.toml',
  'cockpit/ag-ui/a2ui/python/uv.lock',
]);

// Keep migration CI ownership aligned with the inventory's reviewed scope.
// Rootless fixtures and documentation can change it without affecting an Nx library.
const parityScope = JSON.parse(
  readFileSync(new URL('./react-parity/baseline.json', import.meta.url), 'utf8')
).scope;
const PARITY_PREFIXES = [
  'examples/chat/native/',
  'scripts/react-parity/',
  'fixtures/react-parity/',
  `${parityScope.docsRoot}/`,
  ...[...parityScope.libraries, ...privateScaffoldProjects]
    .map((name) => `libs/${name}/`),
];

function isParityChange(file) {
  const normalized = normalizePath(file);
  return PARITY_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    parityScope.configFiles.includes(normalized) ||
    (normalized.startsWith(`${parityScope.topicsRoot}/`) &&
      /\/angular\/(?:project\.json|src\/index\.ts)$/.test(normalized));
}

export function emptyScope() {
  return Object.fromEntries(SCOPE_KEYS.map((k) => [k, false]));
}

export function fullScope() {
  return Object.fromEntries(SCOPE_KEYS.map((k) => [k, true]));
}

function normalizePath(value) {
  return String(value ?? '')
    .replaceAll(path.sep, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function tagToScopeKey(tag) {
  // 'scope:cockpit-e2e' → 'cockpit_e2e'
  return tag.replace(/^scope:/, '').replaceAll('-', '_');
}

export function isAngularCompatibilityChange(changedFiles) {
  return changedFiles.some((file) => {
    const normalized = normalizePath(file);
    return (
      ANGULAR_COMPATIBILITY_FILES.has(normalized) ||
      ANGULAR_COMPATIBILITY_PREFIXES.some((prefix) =>
        normalized.startsWith(prefix)
      )
    );
  });
}

/**
 * Pure-function classifier.
 *
 * @param {string[]} changedFiles - normalized repo-relative paths
 * @param {Array<{name: string, tags: string[]}>} affectedProjects
 *        — projects nx considers affected, with their tags
 * @returns {Record<string, boolean>} scope booleans keyed by SCOPE_KEYS
 */
export function classifyFromAffected(changedFiles, affectedProjects) {
  if (hasGlobalCiFileChange(changedFiles)) {
    return fullScope();
  }
  if (isScriptsTestOnlyChange(changedFiles)) {
    return { ...emptyScope(), scripts_tests: true };
  }

  const scope = emptyScope();
  // Rootless workflow shell contracts execute in the scripts Vitest suite.
  if (changedFiles.includes('.github/workflows/deploy-langgraph.yml')) {
    scope.scripts_tests = true;
  }
  for (const project of affectedProjects) {
    for (const tag of project.tags ?? []) {
      if (!tag.startsWith('scope:')) continue;
      const key = tagToScopeKey(tag);
      if (SCOPE_KEYS.includes(key)) scope[key] = true;
    }
  }
  if (changedFiles.some((f) => LINT_ONLY_FILES.has(f))) {
    for (const key of LINT_SCOPE_KEYS) scope[key] = true;
  }
  if (changedFiles.some((f) => COCKPIT_ROOTLESS_SPEC.test(f))) {
    scope.cockpit = true;
  }
  if (changedFiles.some(file => PREVIEW_BUILD_FILES.has(normalizePath(file)))) {
    scope.scripts_tests = true;
    scope.website_e2e = true;
  }
  if (isAngularCompatibilityChange(changedFiles)) {
    scope.angular_compatibility = true;
  }
  if (changedFiles.some(isParityChange)) {
    scope.library = true;
  }
  if (changedFiles.some((file) => {
    const normalized = normalizePath(file);
    return A2UI_NATIVE_FIXTURE_FILES.has(normalized) ||
      normalized.startsWith('cockpit/chat/a2ui/python/src/') ||
      normalized.startsWith('cockpit/chat/a2ui/python/tests/');
  })) scope.library = true;
  // The installed native approval proof copies only these canonical inputs.
  if (
    changedFiles.some((file) => {
      const normalized = normalizePath(file);
      return (
        normalized.startsWith('examples/chat/python/src/') ||
        [
          'examples/chat/python/pyproject.toml',
          'examples/chat/python/uv.lock',
          'examples/chat/python/langgraph.json',
          'examples/chat/native/tooling/fixtures/approval.json',
        ].includes(normalized)
      );
    })
  )
    scope.library = true;
  // The native owner proof uses this service's isolated lock and test fixture,
  // including changes Nx attributes only to the untagged root project. MAF is
  // included so its deployment changes are not left ungated, even though the
  // library lane's native-owner proof covers Mastra only.
  if (changedFiles.some((file) => /^deployments\/ag-ui-(mastra|maf)\//.test(normalizePath(file)))) {
    scope.library = true;
  }
  return scope;
}

export function hasGlobalCiFileChange(changedFiles) {
  return requiresFullCockpitFleet(changedFiles) || changedFiles.some((f) => GLOBAL_CI_FILES.has(f));
}

function changedFilesBetween(base, head, workspaceRoot) {
  // Retain both paths of a rename so an unreviewed input cannot hide behind
  // an allowlisted destination.
  return execFileSync('git', ['diff', '--no-renames', '--name-only', base, head], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
}

function loadAffectedProjects(base, head, workspaceRoot) {
  const namesJson = execFileSync(
    'npx',
    [
      'nx',
      'show',
      'projects',
      '--affected',
      '--base',
      base,
      '--head',
      head,
      '--json',
    ],
    { cwd: workspaceRoot, encoding: 'utf8' }
  );
  const names = JSON.parse(namesJson);
  return names.map((name) => {
    const projectJson = execFileSync(
      'npx',
      ['nx', 'show', 'project', name, '--json'],
      { cwd: workspaceRoot, encoding: 'utf8' }
    );
    const project = JSON.parse(projectJson);
    return { name: project.name ?? name, tags: project.tags ?? [] };
  });
}

function writeOutputs(scope, outputPath) {
  const lines = SCOPE_KEYS.map((k) => `${k}=${scope[k] ? 'true' : 'false'}`);
  if (outputPath) appendFileSync(outputPath, `${lines.join('\n')}\n`);
  for (const line of lines) console.log(line);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    args[a.slice(2)] = argv[i + 1];
    i++;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = process.cwd();

  if (args.event === 'push') {
    writeOutputs(fullScope(), args.output);
    console.log('Push to main runs the full CI suite.');
    return;
  }

  if (!args.base || !args.head) {
    throw new Error(
      'Expected --base and --head for pull request scope detection.'
    );
  }

  const changedFiles = changedFilesBetween(args.base, args.head, workspaceRoot);
  if (hasGlobalCiFileChange(changedFiles)) {
    console.log('Changed files:');
    for (const f of changedFiles) console.log(`  ${f}`);
    writeOutputs(fullScope(), args.output);
    console.log('Global CI file changed; running the full CI suite.');
    return;
  }

  const scriptsTestOnly = isScriptsTestOnlyChange(changedFiles);
  const affectedProjects = scriptsTestOnly ? [] : loadAffectedProjects(
    args.base,
    args.head,
    workspaceRoot
  );
  const scope = classifyFromAffected(changedFiles, affectedProjects);

  console.log('Changed files:');
  for (const f of changedFiles) console.log(`  ${f}`);
  console.log(scriptsTestOnly
    ? 'Reviewed Scripts test-only diff; Nx consumer discovery skipped.'
    : `Affected projects (${affectedProjects.length}):`);
  for (const p of affectedProjects)
    console.log(`  ${p.name} [${p.tags.join(', ')}]`);

  writeOutputs(scope, args.output);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      `::error::${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}
