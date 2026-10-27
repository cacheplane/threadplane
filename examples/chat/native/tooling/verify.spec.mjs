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
import { inventory } from './retained-build.mjs';

const module = await import('./verify.mjs').catch(() => ({}));
const fixture = (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-verify-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
for (const path of ['../react/index.html', '../angular/src/index.html'])
  test(`${path} declares a self-contained SVG favicon`, () => {
    const html = readFileSync(new URL(path, import.meta.url), 'utf8');
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
test('CLI selects Angular for fresh verify/retain and leaves review selection to evidence', () => {
  assert.deepEqual(module.parseArguments(['--framework=angular']), {
    mode: 'verify',
    framework: 'angular',
  });
  assert.deepEqual(module.parseArguments(['--framework=react']), {
    mode: 'verify',
    framework: 'react',
  });
  assert.deepEqual(
    module.parseArguments(['--retain', '/tmp/new', '--framework=angular']),
    {
      mode: 'verify',
      framework: 'angular',
      directory: join(realpathSync('/tmp'), 'new'),
      retain: true,
    }
  );
  for (const args of [
    ['--framework=vue'],
    ['--framework=angular', '--framework=angular'],
    ['--framework=react', '--framework=angular'],
    ['--review', '/tmp', '--framework=angular'],
  ])
    assert.throws(() => module.parseArguments(args));
});
test('selected framework reaches build and installed tests before failure cleanup', async (t) => {
  const root = fixture(t),
    directory = join(root, 'proof');
  const calls = [];
  await assert.rejects(
    module.verify({
      root,
      directory,
      retain: true,
      framework: 'angular',
      operations: {
        async build({ framework, capture }) {
          calls.push(framework);
          await capture({});
        },
        captureApp: mkdirSync,
        captureView: mkdirSync,
        installed(framework) {
          calls.push(framework);
          throw Error('stop after selected test');
        },
      },
    }),
    /stop after selected test/
  );
  assert.deepEqual(calls, ['angular', 'angular']);
  assert.equal(existsSync(directory), false);
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
  writeFileSync(join(root, 'results.json'), '{}');
  writeFileSync(
    join(root, 'verification.json'),
    JSON.stringify({ version: 2, files: inventory(root) })
  );
  rmSync(join(root, 'app', 'bytes'));
  assert.throws(() => module.readVerification(root), /inventory/i);
  writeFileSync(join(root, 'app', 'bytes'), 'app');
  writeFileSync(join(root, 'surprise'), 'extra');
  assert.throws(() => module.readVerification(root), /inventory/i);
  rmSync(join(root, 'surprise'));
  writeFileSync(join(root, 'results.json'), '{"changed":true}');
  assert.throws(() => module.readVerification(root), /inventory/i);
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
