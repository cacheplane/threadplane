import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import {
  captureRetainedBuild,
  readRetainedBuild,
  startRetainedServer,
} from './retained-build.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('import performs no build, installation, or server startup', () => {
  assert.equal(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(
          new URL('./retained-build.mjs', import.meta.url).href
        )}); console.log('imported');`,
      ],
      {
        encoding: 'utf8',
        timeout: 5000,
        env: { PATH: process.env.PATH, NATIVE_LANGGRAPH_URL: 'invalid' },
      }
    ).trim(),
    'imported'
  );
});
function put(root, path, bytes) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
  return hash(bytes);
}
function fixture(t) {
  const base = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-retention-test-'))
  );
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'source'),
    temporary = join(base, 'temporary'),
    buildRoot = join(temporary, 'build'),
    consumer = join(temporary, 'consumer'),
    output = join(consumer, 'react/dist');
  const inputs = {
    'react/src/main.tsx': put(root, 'react/src/main.tsx', 'authored'),
    'package-lock.json': put(root, 'package-lock.json', '{}'),
  };
  const buildInputs = {
    'package-lock.json': put(buildRoot, 'package-lock.json', '{}'),
  };
  const copied = {
    'react/src/main.tsx': put(consumer, 'react/src/main.tsx', 'authored'),
    'shared/browser-config.json': put(
      consumer,
      'shared/browser-config.json',
      '{"assistantId":"","apiBase":"/api"}'
    ),
  };
  const tarballs = {},
    hashes = {},
    artifacts = {},
    dependencies = {},
    lockPackages = {};
  for (const name of ['core', 'content', 'react', 'langgraph']) {
    const packageName = '@threadplane/' + name,
      file = join(temporary, name + '.tgz');
    hashes[packageName] = put(temporary, name + '.tgz', 'archive-' + name);
    tarballs[packageName] = 'file:' + file;
    dependencies[packageName] = tarballs[packageName];
    lockPackages['node_modules/' + packageName] = {
      resolved: tarballs[packageName],
    };
    artifacts[packageName] = [
      {
        path: 'index.js',
        sha256: put(
          consumer,
          'node_modules/' + packageName + '/index.js',
          'runtime-' + name
        ),
      },
    ];
  }
  put(consumer, 'package.json', JSON.stringify({ dependencies }));
  const derivedLockSha256 = put(
    consumer,
    'package-lock.json',
    JSON.stringify({ packages: { '': { dependencies }, ...lockPackages } })
  );
  const executable = 'node_modules/typescript/bin/tsc';
  const executableSha256 = put(consumer, executable, 'compiler');
  put(consumer, 'node_modules/typescript/package.json', '{"version":"1"}');
  put(consumer, 'node_modules/vite/package.json', '{"version":"1"}');
  put(consumer, 'node_modules/vite/bin/vite.js', 'bundler');
  const compilation = {
    executable,
    executableSha256,
    inputs: {
      'react/src/main.tsx': copied['react/src/main.tsx'],
      'node_modules/vendor/index.d.ts': put(
        consumer,
        'node_modules/vendor/index.d.ts',
        'type'
      ),
    },
  };
  const bundle = {
    output,
    inputs: {
      'node_modules/vendor/index.js': put(
        consumer,
        'node_modules/vendor/index.js',
        'runtime'
      ),
    },
  };
  const outputs = {
    'index.html': put(
      output,
      'index.html',
      '<script src="/assets/main.js"></script>'
    ),
    'assets/main.js': put(output, 'assets/main.js', 'console.log("app")'),
    'build-inputs.json': put(output, 'build-inputs.json', '[]'),
  };
  const installation = { artifacts, derivedLockSha256 };
  const provenance = {
    configuration: 'production',
    inputs,
    buildInputs,
    copied,
    packages: hashes,
    installation,
    compiler: compilation,
    bundler: { inputs: bundle.inputs },
    outputs,
  };
  return {
    base,
    directory: join(base, 'retained'),
    root,
    temporary,
    buildRoot,
    consumer,
    compilation,
    bundle,
    installation,
    packages: { tarballs, hashes },
    provenance,
  };
}

test('retains actual bytes and original lock, verifies after original temporary cleanup, and returns copy-on-read assets', (t) => {
  const f = fixture(t),
    originalLock = readFileSync(join(f.consumer, 'package-lock.json'));
  captureRetainedBuild(f.directory, f);
  rmSync(f.temporary, { recursive: true });
  rmSync(f.root, { recursive: true });
  const retained = readRetainedBuild(f.directory);
  assert.deepEqual(
    readFileSync(join(f.directory, 'consumer/package-lock.json')),
    originalLock
  );
  assert.equal(
    retained.readOutput('assets/main.js').toString(),
    'console.log("app")'
  );
  retained.readOutput('assets/main.js').fill(0);
  writeFileSync(join(f.directory, 'output/assets/main.js'), 'after validation');
  assert.equal(
    retained.readOutput('assets/main.js').toString(),
    'console.log("app")'
  );
  assert.equal(retained.readOutput('../consumer/package.json'), undefined);
  assert.ok(Object.isFrozen(retained));
});

for (const path of [
  'source/react/src/main.tsx',
  'source/package-lock.json',
  'build-inputs/package-lock.json',
  'consumer/shared/browser-config.json',
  'archives/core.tgz',
  'consumer/node_modules/vendor/index.d.ts',
  'consumer/node_modules/@threadplane/react/index.js',
  'consumer/package-lock.json',
  'output/assets/main.js',
])
  test(`rejects retained byte drift: ${path}`, (t) => {
    const f = fixture(t);
    captureRetainedBuild(f.directory, f);
    writeFileSync(join(f.directory, path), 'tampered');
    assert.throws(
      () => readRetainedBuild(f.directory),
      /hash|bytes|inventory/i
    );
  });

for (const mutation of [
  'missing chunk',
  'unexpected output',
  'unexpected source',
  'unexpected root property',
  'symlink file',
  'symlink parent',
  'unsafe record',
  'output hash mismatch',
])
  test(`rejects ${mutation} before exposing any retained output`, (t) => {
    const f = fixture(t);
    captureRetainedBuild(f.directory, f);
    if (mutation === 'missing chunk')
      rmSync(join(f.directory, 'output/assets/main.js'));
    if (mutation === 'unexpected output')
      put(f.directory, 'output/secret.txt', 'secret');
    if (mutation === 'unexpected source')
      put(f.directory, 'source/new.ts', 'new');
    if (mutation === 'unexpected root property')
      put(f.directory, '__proto__', 'unexpected');
    if (mutation === 'symlink file') {
      rmSync(join(f.directory, 'output/assets/main.js'));
      symlinkSync(
        join(f.root, 'react/src/main.tsx'),
        join(f.directory, 'output/assets/main.js')
      );
    }
    if (mutation === 'symlink parent') {
      rmSync(join(f.directory, 'output/assets'), { recursive: true });
      symlinkSync(f.root, join(f.directory, 'output/assets'));
    }
    if (mutation === 'unsafe record' || mutation === 'output hash mismatch') {
      const path = join(f.directory, 'retained.json'),
        record = JSON.parse(readFileSync(path));
      record.provenance.outputs[
        mutation === 'unsafe record' ? '../outside' : 'assets/main.js'
      ] = hash('bad');
      writeFileSync(path, JSON.stringify(record));
    }
    assert.throws(() => readRetainedBuild(f.directory));
  });

test('requires a new target and failed capture cleans only its own new target', (t) => {
  const f = fixture(t);
  mkdirSync(f.directory);
  put(f.directory, 'keep', 'owner');
  assert.throws(() => captureRetainedBuild(f.directory, f), /exist/i);
  assert.equal(readFileSync(join(f.directory, 'keep'), 'utf8'), 'owner');
  const failed = join(f.base, 'failed');
  writeFileSync(
    join(f.consumer, 'node_modules/@threadplane/react/index.js'),
    'drift'
  );
  assert.throws(() => captureRetainedBuild(failed, f));
  assert.equal(existsSync(failed), false);
});

test('capture rejects symlink target ancestors and archive paths outside the owned preparation', (t) => {
  const f = fixture(t);
  symlinkSync(f.base, join(f.base, 'alias'));
  assert.throws(
    () => captureRetainedBuild(join(f.base, 'alias/retained'), f),
    /link/i
  );
  const outside = join(f.base, 'outside.tgz');
  writeFileSync(outside, 'archive-core');
  f.packages.tarballs['@threadplane/core'] = 'file:' + outside;
  assert.throws(
    () => captureRetainedBuild(f.directory, f),
    /outside|escape|confined/i
  );
  assert.equal(existsSync(f.directory), false);
});

function request(url, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { path, method }, (res) => {
      const bytes = [];
      res.on('data', (b) => bytes.push(b));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          bytes: Buffer.concat(bytes),
          headers: res.headers,
        })
      );
    });
    req.on('error', reject);
    req.end();
  });
}
test('HTTP serves only validated exact output routes and owns API forwarding; disk edits cannot affect running assets', async (t) => {
  const f = fixture(t);
  captureRetainedBuild(f.directory, f);
  let calls = 0;
  const backend = http.createServer((req, res) => {
    calls++;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(req.url);
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        backend.close(resolve);
        backend.closeAllConnections();
      })
  );
  const server = await startRetainedServer({
    directory: f.directory,
    target: `http://127.0.0.1:${backend.address().port}`,
  });
  t.after(() => server.close());
  assert.equal((await request(server.url, '/')).status, 200);
  assert.equal(
    (await request(server.url, '/?thread=garden&unrelated=kept')).status,
    200
  );
  assert.equal(
    (await request(server.url, '/assets/main.js?revision=1')).status,
    200
  );
  const before = await request(server.url, '/assets/main.js');
  assert.match(before.headers['content-type'], /javascript/);
  writeFileSync(join(f.directory, 'output/assets/main.js'), 'changed');
  assert.deepEqual(
    (await request(server.url, '/assets/main.js')).bytes,
    before.bytes
  );
  assert.equal(
    (await request(server.url, '/assets/main.js', 'HEAD')).bytes.length,
    0
  );
  for (const path of [
    '/consumer/package-lock.json',
    '/archives/core.tgz',
    '/source/react/src/main.tsx',
    '/retained.json',
    '/provenance.json',
    '/build-inputs.json',
    '/missing',
    '/assets/%6dain.js',
    '/assets/../index.html',
    '/assets/%2e%2e/index.html',
    '//index.html',
    '/api-other',
  ])
    assert.ok(
      [400, 404].includes((await request(server.url, path)).status),
      path
    );
  assert.equal(
    (await request(server.url, '/assets/main.js', 'POST')).status,
    405
  );
  assert.equal(calls, 0);
  const forwarded = await request(server.url, '/api/threads?limit=1');
  assert.equal(forwarded.status, 200);
  assert.equal(forwarded.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(forwarded.bytes.toString(), '/threads?limit=1');
  assert.equal(calls, 1);
});
