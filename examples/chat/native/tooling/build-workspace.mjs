import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { excludedSourcePath } from './source-policy.mjs';
import { selectedFramework } from './commands.mjs';

// These are real build inputs, not an Nx workspace clone. Telemetry metadata
// satisfies LangGraph's graph edge; no telemetry task or source is needed.
// The trace is eagerly read by the imported packaging helper graph.
export function selectedBuildInputRoots(root, framework) {
  return [
    'libs/core',
    'libs/content',
    'libs/' + selectedFramework(framework),
    'libs/langgraph',
    'libs/telemetry/project.json',
    'scripts/react-parity',
    'fixtures/react-parity/traces/langgraph-text-state.sse',
    'package.json',
    'package-lock.json',
    'nx.json',
    ...readdirSync(root).filter((name) => /^tsconfig.*\.json$/.test(name)),
  ];
}

export function buildInputRoots(root, framework) {
  return [
    ...selectedBuildInputRoots(root, framework),
    'examples/chat/native/' + selectedFramework(framework),
    'examples/chat/native/shared',
    'examples/chat/native/tooling',
    'examples/chat/native/tsconfig.test.json',
    'libs/design-tokens/src/lib/tokens.css',
  ];
}

function stat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

// Check every component under the source root, including selected-file parents.
// The only intentional link is installed separately at buildRoot/node_modules.
function sourcePath(root, local) {
  let path = root;
  for (const part of ['', ...local.split('/')]) {
    if (part) path = join(path, part);
    assert.ok(!stat(path)?.isSymbolicLink(), `No source links: ${path}`);
  }
  return path;
}

export function inputFingerprint(root, roots = buildInputRoots(root)) {
  const hashes = {};
  function visit(local) {
    if (excludedSourcePath(local)) return;
    const path = sourcePath(root, local);
    const info = stat(path);
    if (!info) return;
    if (info.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(local + '/' + name);
    } else {
      assert.ok(info.isFile(), `Only regular source files: ${path}`);
      hashes[local] = createHash('sha256')
        .update(readFileSync(path))
        .digest('hex');
    }
  }
  for (const local of roots) visit(local);
  return Object.fromEntries(
    Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))
  );
}

export function createBuildWorkspace(root, buildRoot, framework) {
  const roots = selectedBuildInputRoots(root, framework);
  for (const local of roots)
    assert.ok(stat(sourcePath(root, local)), `Missing build input: ${local}`);
  const inputs = inputFingerprint(root, roots);
  mkdirSync(buildRoot); // Caller owns a fresh directory; never reuse old output.
  for (const local of Object.keys(inputs)) {
    mkdirSync(dirname(join(buildRoot, local)), { recursive: true });
    writeFileSync(
      join(buildRoot, local),
      readFileSync(sourcePath(root, local))
    );
  }
  assert.deepEqual(
    inputFingerprint(root, selectedBuildInputRoots(root, framework)),
    inputs,
    'Original build inputs changed during copy'
  );
  const unchanged = () =>
    assert.deepEqual(
      inputFingerprint(
        buildRoot,
        selectedBuildInputRoots(buildRoot, framework)
      ),
      inputs,
      'Owned build inputs changed during preparation'
    );
  unchanged();
  const tools = realpathSync(join(root, 'node_modules'));
  assert.ok(
    lstatSync(tools).isDirectory(),
    'Build tools must be an installed directory'
  );
  symlinkSync(tools, join(buildRoot, 'node_modules'), 'dir');
  return { inputs, tools, unchanged };
}
