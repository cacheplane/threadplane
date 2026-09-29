import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assertInstalledArtifacts } from '../../../../scripts/react-parity/langgraph-candidate-package.mjs';
import { startProxy } from './proxy.mjs';

export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const locals = [
  '@threadplane/content',
  '@threadplane/core',
  '@threadplane/langgraph',
  '@threadplane/react',
];
function localPath(path) {
  assert.ok(
    typeof path === 'string' &&
      path.length &&
      !isAbsolute(path) &&
      !/[\\\x00-\x20\x7f?#%]/.test(path) &&
      path.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Unsafe retained path'
  );
  return path;
}
export function noLinks(path) {
  const absolute = resolve(path);
  if (dirname(absolute) !== absolute) noLinks(dirname(absolute));
  assert.ok(
    !lstatSync(absolute).isSymbolicLink(),
    'Retained paths cannot contain symlinks'
  );
  return absolute;
}
export function file(root, local) {
  const path = noLinks(join(root, localPath(local)));
  assert.ok(lstatSync(path).isFile(), 'Retained inputs must be regular files');
  return readFileSync(path);
}
export function inventory(root, local = '') {
  const directory = noLinks(local ? join(root, localPath(local)) : root);
  const result = Object.create(null);
  for (const name of readdirSync(directory).sort()) {
    const path = local ? local + '/' + name : name;
    localPath(path);
    const info = lstatSync(join(root, path));
    assert.ok(!info.isSymbolicLink(), 'Retained paths cannot contain symlinks');
    if (info.isDirectory()) Object.assign(result, inventory(root, path));
    else result[path] = hash(file(root, path));
  }
  return { ...result };
}
function recordMap(value) {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    'Expected hash inventory'
  );
  for (const [path, digest] of Object.entries(value)) {
    localPath(path);
    assert.match(digest, /^[a-f0-9]{64}$/, 'Invalid inventory hash');
  }
  return value;
}
function merge(...maps) {
  const result = Object.create(null);
  for (const map of maps)
    for (const [path, digest] of Object.entries(recordMap(map))) {
      assert.ok(
        result[path] === undefined || result[path] === digest,
        'Conflicting inventory hashes'
      );
      result[path] = digest;
    }
  return { ...result };
}
function expectedConsumer(record) {
  const p = record.provenance;
  assert.deepEqual(
    Object.keys(p.installation.artifacts).sort(),
    locals,
    'Exactly four local artifacts required'
  );
  const artifacts = {};
  for (const [name, files] of Object.entries(p.installation.artifacts)) {
    assert.ok(Array.isArray(files));
    const seen = new Set();
    for (const { path, sha256 } of files) {
      localPath(path);
      assert.ok(!seen.has(path), 'Duplicate artifact path');
      seen.add(path);
      artifacts['node_modules/' + name + '/' + path] = sha256;
    }
  }
  return merge(
    p.copied,
    p.compiler.inputs,
    p.bundler.inputs,
    artifacts,
    record.tools,
    record.derived,
    { [localPath(p.compiler.executable)]: p.compiler.executableSha256 }
  );
}
function expectedFiles(record) {
  assert.equal(record.version, 1, 'Unsupported retained build');
  const p = record.provenance;
  assert.equal(
    p.configuration,
    'production',
    'Only production builds can be retained'
  );
  assert.deepEqual(Object.keys(p.packages).sort(), locals);
  assert.deepEqual(Object.keys(record.archives).sort(), locals);
  const archives = {};
  for (const name of locals) {
    const entry = record.archives[name];
    assert.equal(
      entry.path,
      'archives/' + name.slice('@threadplane/'.length) + '.tgz'
    );
    assert.ok(
      typeof entry.original === 'string' &&
        /^file:.*\.tgz$/.test(entry.original)
    );
    archives[entry.path.slice('archives/'.length)] = p.packages[name];
  }
  assert.equal(
    record.derived['package-lock.json'],
    p.installation.derivedLockSha256,
    'Derived lock hash'
  );
  assert.deepEqual(Object.keys(record.derived).sort(), [
    'package-lock.json',
    'package.json',
  ]);
  for (const path of Object.keys(record.tools))
    assert.match(path, /^node_modules\/(typescript|vite)\//);
  const groups = {
    source: p.inputs,
    'build-inputs': p.buildInputs,
    consumer: expectedConsumer(record),
    archives,
    output: p.outputs,
  };
  const expected = {};
  for (const [group, files] of Object.entries(groups))
    for (const [path, digest] of Object.entries(recordMap(files)))
      expected[group + '/' + path] = digest;
  return expected;
}

// Synchronous capture runs inside buildConsumer's awaited hook. The returned
// discard is used only if the enclosing build fails after this capture succeeds.
export function captureRetainedBuild(directory, context) {
  directory = resolve(directory);
  noLinks(dirname(directory));
  mkdirSync(directory); // Exclusive ownership; an existing target is never touched.
  try {
    const {
      root,
      buildRoot,
      temporary,
      consumer,
      packages,
      provenance,
      bundle,
    } = context;
    assert.deepEqual(provenance.installation, context.installation);
    assert.deepEqual(provenance.compiler, context.compilation);
    assert.deepEqual(provenance.bundler.inputs, bundle.inputs);
    assert.deepEqual(provenance.packages, packages.hashes);
    const record = {
      version: 1,
      provenance: structuredClone(provenance),
      archives: {},
      tools: merge(
        ...['typescript', 'vite'].map((name) =>
          Object.fromEntries(
            Object.entries(inventory(join(consumer, 'node_modules', name))).map(
              ([path, digest]) => ['node_modules/' + name + '/' + path, digest]
            )
          )
        )
      ),
      derived: Object.fromEntries(
        ['package.json', 'package-lock.json'].map((path) => [
          path,
          hash(file(consumer, path)),
        ])
      ),
    };
    assert.deepEqual(Object.keys(packages.tarballs).sort(), locals);
    for (const name of locals)
      record.archives[name] = {
        original: packages.tarballs[name],
        path: 'archives/' + name.slice('@threadplane/'.length) + '.tgz',
      };
    const expected = expectedFiles(record);
    assert.deepEqual(
      inventory(bundle.output),
      provenance.outputs,
      'Complete emitted output inventory'
    );
    assertInstalledArtifacts(consumer, provenance.installation.artifacts);
    const roots = {
      source: root,
      'build-inputs': buildRoot,
      consumer,
      output: bundle.output,
    };
    for (const [path, digest] of Object.entries(expected)) {
      const slash = path.indexOf('/'),
        group = path.slice(0, slash),
        local = path.slice(slash + 1);
      let bytes;
      if (group === 'archives') {
        const entry = Object.values(record.archives).find(
          (entry) => entry.path === path
        );
        const archive = entry.original.slice(5);
        const confined = relative(noLinks(temporary), resolve(archive));
        assert.ok(
          confined &&
            !confined.startsWith('..' + sep) &&
            confined !== '..' &&
            !isAbsolute(confined),
          'Archive outside owned preparation'
        );
        bytes = file(temporary, confined.replaceAll(sep, '/'));
      } else bytes = file(roots[group], local);
      assert.equal(hash(bytes), digest, `Capture bytes changed: ${path}`);
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), bytes);
    }
    writeFileSync(
      join(directory, 'retained.json'),
      JSON.stringify(record, null, 2) + '\n'
    );
    readRetainedBuild(directory);
    return {
      directory,
      discard() {
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

// Hashes provide local integrity evidence, not cryptographic authenticity.
// No original source, installation, or archive path is dereferenced on review.
export function readRetainedBuild(directory) {
  noLinks(directory);
  const record = JSON.parse(file(directory, 'retained.json'));
  const expected = expectedFiles(record),
    actual = inventory(directory);
  delete actual['retained.json'];
  assert.deepEqual(
    actual,
    expected,
    'Retained byte hashes and complete inventory must match'
  );
  const consumer = join(directory, 'consumer');
  assertInstalledArtifacts(consumer, record.provenance.installation.artifacts);
  const lock = JSON.parse(file(consumer, 'package-lock.json'));
  const manifest = JSON.parse(file(consumer, 'package.json'));
  for (const name of locals) {
    const original = record.archives[name].original;
    assert.equal(
      manifest.dependencies[name],
      original,
      'Original manifest archive mapping'
    );
    assert.equal(
      lock.packages[''].dependencies[name],
      original,
      'Original lock archive mapping'
    );
    assert.equal(
      lock.packages['node_modules/' + name].resolved,
      original,
      'Original lock resolution'
    );
  }
  const buffers = new Map(
    Object.entries(record.provenance.outputs).map(([path, digest]) => {
      const bytes = file(directory, 'output/' + path);
      assert.equal(hash(bytes), digest, 'Output hash changed while reading');
      return [path, bytes];
    })
  );
  const outputs = Object.freeze([...buffers.keys()]);
  return Object.freeze({
    outputs,
    readOutput(path) {
      const bytes = buffers.get(path);
      return bytes && Buffer.from(bytes);
    },
  });
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
export async function startRetainedServer({
  directory,
  target,
  apiKey = '',
  port = 0,
}) {
  const retained = readRetainedBuild(directory);
  return startCheckedServer({ retained, target, apiKey, port });
}

export async function startCheckedServer({
  retained,
  target,
  apiKey = '',
  port = 0,
}) {
  const assets = new Map();
  for (const path of retained.outputs) {
    // Build diagnostics are retained for review but never exposed to the browser.
    if (path === 'build-inputs.json' || path === 'provenance.json') continue;
    assert.ok(
      path !== 'api' && !path.startsWith('api/'),
      'Output cannot shadow API'
    );
    const extension = path.slice(path.lastIndexOf('.'));
    assets.set('/' + path, {
      bytes: retained.readOutput(path),
      contentType: contentTypes[extension] ?? 'application/octet-stream',
    });
  }
  assert.ok(assets.has('/index.html'), 'Retained application needs index.html');
  assets.set('/', assets.get('/index.html'));
  return startProxy({ target, apiKey, port, assets });
}
