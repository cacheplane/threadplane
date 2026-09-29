import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { hash } from './retained-build.mjs';
import { readViewProof } from './view-proof.mjs';

const module = await import('./verify.mjs').catch(() => ({}));
const fixture = (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-verify-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
test('authored application declares a self-contained SVG favicon', () => {
  const html = readFileSync(
    new URL('../react/index.html', import.meta.url),
    'utf8'
  );
  const icon = html.match(
    /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="([^"]+)"\s*\/>/
  );
  assert.ok(
    icon,
    'An explicit SVG icon prevents implicit /favicon.ico requests'
  );
  assert.match(icon[1], /^data:image\/svg\+xml,/);
  const svg = decodeURIComponent(icon[1].slice('data:image/svg+xml,'.length));
  assert.match(
    svg,
    /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 32 32">/
  );
  assert.match(svg, /<\/svg>$/);
  assert.doesNotMatch(svg, /script|href|url\(|<!DOCTYPE/i);
});
test('view evidence validates all inputs and outputs and keeps immutable checked buffers', (t) => {
  const root = fixture(t);
  const inputs = {
    'view-proof/entry.tsx': 'test entry',
    'react/src/app.tsx': 'authored App',
    'node_modules/typescript/bin/tsc': 'compiler',
  };
  for (const [path, bytes] of Object.entries(inputs)) {
    mkdirSync(join(root, 'inputs', path, '..'), { recursive: true });
    writeFileSync(join(root, 'inputs', path), bytes);
  }
  mkdirSync(join(root, 'output'));
  writeFileSync(join(root, 'output/index.html'), 'checked HTML');
  writeFileSync(
    join(root, 'view.json'),
    JSON.stringify({
      version: 1,
      entry: 'view-proof/entry.tsx',
      source: {
        path: 'examples/chat/native/tooling/view-entry.tsx',
        sha256: hash('test entry'),
      },
      compiler: {
        executable: 'node_modules/typescript/bin/tsc',
        executableSha256: hash('compiler'),
        inputs: Object.keys(inputs),
      },
      runtime: ['react/src/app.tsx'],
      inputs: Object.fromEntries(
        Object.entries(inputs).map(([path, bytes]) => [path, hash(bytes)])
      ),
      outputs: { 'index.html': hash('checked HTML') },
    })
  );
  const checked = readViewProof(root);
  checked.readOutput('index.html').fill(0);
  assert.equal(checked.readOutput('index.html').toString(), 'checked HTML');
  writeFileSync(join(root, 'output/index.html'), 'changed HTML');
  assert.equal(checked.readOutput('index.html').toString(), 'checked HTML');
  assert.throws(() => readViewProof(root), /inventory/);
  writeFileSync(join(root, 'output/index.html'), 'checked HTML');
  writeFileSync(join(root, 'inputs/view-proof/entry.tsx'), 'changed entry');
  assert.throws(() => readViewProof(root), /inventory/);
});
test('import is inert even with invalid environment and no command arguments', () => {
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(
        new URL('./verify.mjs', import.meta.url).href
      )}); console.log('imported');`,
    ],
    {
      timeout: 5000,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, NATIVE_LANGGRAPH_URL: 'invalid' },
    }
  );
  assert.equal(result.trim(), 'imported');
});
test('CLI accepts only the three concrete forms and canonicalizes the parent', () => {
  assert.equal(typeof module.parseArguments, 'function');
  assert.deepEqual(module.parseArguments([]), { mode: 'verify' });
  assert.deepEqual(module.parseArguments(['--retain', '/tmp/new']), {
    mode: 'verify',
    directory: join(realpathSync('/tmp'), 'new'),
    retain: true,
  });
  for (const args of [
    ['x'],
    ['--review'],
    ['--retain'],
    ['--review', 'x', 'extra'],
    ['--retain', '--review'],
  ])
    assert.throws(() => module.parseArguments(args));
});
test('capture saves app first, then view while consumer lives; rolls back its root if view throws', async (t) => {
  assert.equal(typeof module.captureVerification, 'function');
  const root = fixture(t),
    directory = join(root, 'proof'),
    calls = [];
  const context = { alive: true };
  await assert.rejects(
    module.captureVerification(directory, context, {
      captureApp(path, value) {
        assert.equal(value, context);
        calls.push('app');
        mkdirSync(path);
      },
      captureView(path, value) {
        assert.equal(value, context);
        calls.push('view');
        throw Error('view failed');
      },
    }),
    /view failed/
  );
  assert.deepEqual(calls, ['app', 'view']);
  assert.equal(existsSync(directory), false);
});
test('capture never touches an existing caller target and returns later-failure discard', async (t) => {
  assert.equal(typeof module.captureVerification, 'function');
  const root = fixture(t),
    directory = join(root, 'proof');
  mkdirSync(directory);
  writeFileSync(join(directory, 'mine'), 'keep');
  await assert.rejects(module.captureVerification(directory, {}, {}));
  assert.equal(existsSync(join(directory, 'mine')), true);
  const next = join(root, 'next');
  const capture = await module.captureVerification(
    next,
    {},
    {
      captureApp: mkdirSync,
      captureView: mkdirSync,
    }
  );
  capture.discard();
  assert.equal(existsSync(next), false);
});
test('complete root inventory detects extra files, changed results, and missing artifacts', async (t) => {
  assert.equal(typeof module.sealVerification, 'function');
  const root = fixture(t);
  mkdirSync(join(root, 'app'));
  mkdirSync(join(root, 'view-proof'));
  writeFileSync(join(root, 'app', 'bytes'), 'app');
  writeFileSync(join(root, 'view-proof', 'bytes'), 'view');
  module.sealVerification(root, { passed: ['browser', 'view'] });
  const readers = { readApp: () => 'app', readView: () => 'view' };
  assert.equal(module.readVerification(root, readers).app, 'app');
  rmSync(join(root, 'app', 'bytes'));
  assert.throws(() => module.readVerification(root, readers), /inventory/i);
  writeFileSync(join(root, 'app', 'bytes'), 'app');
  writeFileSync(join(root, 'surprise'), 'extra');
  assert.throws(() => module.readVerification(root, readers), /inventory/i);
  rmSync(join(root, 'surprise'));
  writeFileSync(join(root, 'results.json'), '{}');
  assert.throws(() => module.readVerification(root, readers), /inventory/i);
});
for (const stage of ['installed', 'browser', 'afterCapture'])
  test(`orchestration removes its owned root after ${stage} failure`, async (t) => {
    const root = fixture(t),
      directory = join(root, 'proof'),
      calls = [];
    const operations = {
      async build({ capture }) {
        calls.push('build');
        const captured = await capture({});
        if (stage === 'afterCapture') {
          captured.discard();
          throw Error('afterCapture failed');
        }
      },
      captureApp(path) {
        calls.push('app');
        mkdirSync(path);
      },
      captureView(path) {
        calls.push('view');
        mkdirSync(path);
      },
      installed() {
        calls.push('installed');
        if (stage === 'installed') throw Error('installed failed');
        return {};
      },
      browser() {
        calls.push('browser');
        throw Error('browser failed');
      },
    };
    await assert.rejects(
      module.verify({ root, directory, retain: true, operations }),
      new RegExp(stage + ' failed')
    );
    assert.equal(existsSync(directory), false);
    assert.deepEqual(calls.slice(0, 3), ['build', 'app', 'view']);
  });
