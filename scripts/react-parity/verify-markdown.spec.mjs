import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fileHashes, sha256 } from './langgraph-candidate-package.mjs';
import * as markdownVerifier from './verify-markdown.mjs';
import {
  validateMarkdown,
  assertArtifactFiles,
  assertFrozen,
  serveMarkdown,
  verifyMarkdownBrowser,
  reviewMarkdown,
  assertMarkdownRootInputs,
} from './verify-markdown.mjs';

test('retains proof source bytes for frozen provenance, including the presentation installer', (t) => {
  const { retainMarkdownSources } = markdownVerifier;
  assert.equal(typeof retainMarkdownSources, 'function', 'Source retention helper required');
  const temporary = mkdtempSync(join(tmpdir(), 'markdown-sources-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'root'), retained = join(temporary, 'retained');
  mkdirSync(join(root, 'scripts/react-parity'), { recursive: true });
  mkdirSync(retained);
  const path = 'scripts/react-parity/markdown-presentation-build.mjs';
  writeFileSync(join(root, path), 'export const proof = true;');
  const frozen = retainMarkdownSources(root, retained, [path]);
  assert.deepEqual(frozen, [{ path: 'sources/' + path, sha256: sha256('export const proof = true;') }]);
  assertFrozen(retained, frozen);
  writeFileSync(join(retained, 'sources', path), 'tampered');
  assert.throws(() => assertFrozen(retained, frozen), /Frozen artifact bytes differ/);
});

test('content Markdown feature exports exactly the owner factory and URL helper', () => {
  assert.equal(typeof markdownVerifier.assertMarkdownFeatureExports, 'function');
  assert.throws(() => markdownVerifier.assertMarkdownFeatureExports({ createMarkdown() {} }), /markdownUrl/);
  assert.throws(() => markdownVerifier.assertMarkdownFeatureExports({ markdownUrl() {} }), /createMarkdown/);
  assert.throws(() => markdownVerifier.assertMarkdownFeatureExports({ createMarkdown() {}, markdownUrl() {}, extra() {} }), /unexpected/);
  assert.doesNotThrow(() => markdownVerifier.assertMarkdownFeatureExports({ createMarkdown() {}, markdownUrl() {} }));
});

test('Markdown root caller rejects actual parser and feature paths in the metafile input map', () => {
  const root = {
    'node_modules/@threadplane/content/src/index.js': {
      bytes: 11,
      imports: [],
    },
  };
  assertMarkdownRootInputs(root);
  assert.throws(
    () =>
      assertMarkdownRootInputs({
        ...root,
        'node_modules/@cacheplane/partial-markdown/dist/index.mjs': {
          bytes: 100,
          imports: [],
        },
      }),
    /content parser inputs.*partial-markdown/
  );
  assert.throws(
    () =>
      assertMarkdownRootInputs({
        ...root,
        'node_modules/@threadplane/content/src/markdown/index.js': {
          bytes: 40,
          imports: [],
        },
      }),
    /Root does not reach Markdown feature/
  );
  assert.throws(
    () => assertMarkdownRootInputs(Object.keys(root)),
    /Metafile input map required/
  );
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'markdown-package-')),
    directory = join(root, 'dist/libs/content');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(directory, 'src/markdown'), { recursive: true });
  writeFileSync(join(directory, 'README.md'), 'fixture');
  writeFileSync(join(directory, 'LICENSE.md'), 'MIT');
  for (const ext of ['js', 'd.ts']) {
    writeFileSync(join(directory, 'src/index.' + ext), 'export {};');
    writeFileSync(
      join(directory, 'src/markdown/index.' + ext),
      ext === 'js'
        ? 'export function createMarkdown() {}'
        : 'export declare function createMarkdown(): void;'
    );
  }
  const conditions = (path) => ({
    types: path + '.d.ts',
    import: path + '.js',
    default: path + '.js',
  });
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: '@threadplane/content',
      version: '0.0.0',
      private: true,
      type: 'module',
      license: 'MIT',
      exports: {
        '.': conditions('./src/index'),
        './markdown': conditions('./src/markdown/index'),
      },
    })
  );
  return { root, directory };
}
test('actual artifact policy accepts a valid feature and rejects missing, escaping and source exports', (t) => {
  const { root, directory } = fixture(t);
  validateMarkdown(root);
  const file = join(directory, 'package.json'),
    manifest = JSON.parse(readFileSync(file));
  delete manifest.exports['./markdown'];
  writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => validateMarkdown(root), /Markdown feature/);
  manifest.exports['./markdown'] = {
    types: '../outside.d.ts',
    import: '../outside.js',
    default: '../outside.js',
  };
  writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => validateMarkdown(root), /export target/);
});
test('artifact verification rejects altered installed bytes and extra source composition', (t) => {
  const { directory } = fixture(t),
    expected = fileHashes(directory);
  assertArtifactFiles(directory, expected);
  writeFileSync(
    join(directory, 'src/markdown/index.js'),
    'export const copied = true;'
  );
  assert.throws(
    () => assertArtifactFiles(directory, expected),
    /artifact bytes/
  );
  writeFileSync(join(directory, 'src/private.ts'), 'export {};');
  assert.throws(
    () => assertArtifactFiles(directory, expected),
    /artifact bytes/
  );
});
for (const ext of ['js', 'd.ts']) {
  test(`installed root ${ext} rejects indirect feature/parser leakage`, (t) => {
    const { root, directory } = fixture(t);
    writeFileSync(
      join(directory, 'src/index.' + ext),
      "export * from './bridge.js';"
    );
    writeFileSync(
      join(directory, 'src/bridge.' + ext),
      "export * from './markdown/index.js';"
    );
    assert.throws(() => validateMarkdown(root), /content root dependency/);
  });
}
test(
  'static review serves only owned fixed routes and closes idempotently',
  { timeout: 8000 },
  async () => {
    const server = await serveMarkdown({
      bundle: 'export const proof = true;',
      provenance: { fixture: true },
      signal: new AbortController().signal,
    });
    try {
      const response = await fetch(server.url + '/app.js', {
        signal: AbortSignal.timeout(1000),
      });
      assert.equal(await response.text(), 'export const proof = true;');
      const rejected = await fetch(server.url + '/unrelated', {
        signal: AbortSignal.timeout(1000),
      });
      assert.equal(rejected.status, 404);
    } finally {
      await server.close();
      await server.close();
    }
    await assert.rejects(
      fetch(server.url, { signal: AbortSignal.timeout(1000) })
    );
  }
);
test('review startup rejects an already-aborted signal without opening a server', async () => {
  const controller = new AbortController();
  controller.abort();
  let opened;
  try {
    await assert.rejects(async () => {
      opened = await serveMarkdown({
        bundle: '',
        provenance: {},
        signal: controller.signal,
      });
    }, /abort/i);
  } finally {
    await opened?.close();
  }
});
test('retained artifact validation rejects tampered tarballs and escaping paths', (t) => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'content.tgz'), 'original');
  const records = [{ path: 'content.tgz', sha256: sha256('original') }];
  assertFrozen(root, records);
  writeFileSync(join(root, 'content.tgz'), 'changed');
  assert.throws(() => assertFrozen(root, records), /Frozen artifact bytes/);
  const outside = mkdtempSync(join(tmpdir(), 'markdown-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'file'), 'outside');
  assert.throws(
    () =>
      assertFrozen(root, [
        { path: join(outside, 'file'), sha256: sha256('outside') },
      ]),
    /escapes/
  );
});
test('retained review rejects changed or unrecorded HTML/CSS before opening a server', async (t) => {
  const { root } = fixture(t),
    shell = '<style>body{color:blue}</style>',
    bundle = 'export {};';
  mkdirSync(join(root, 'consumer'));
  writeFileSync(join(root, 'consumer/browser.js'), bundle);
  writeFileSync(join(root, 'consumer/index.html'), shell);
  const provenance = {
    browser: { bundleSha256: sha256(bundle), shellSha256: sha256(shell) },
    frozen: [
      { path: 'consumer/browser.js', sha256: sha256(bundle) },
      { path: 'consumer/index.html', sha256: sha256(shell) },
    ],
  };
  writeFileSync(join(root, 'provenance.json'), JSON.stringify(provenance));
  writeFileSync(join(root, 'consumer/index.html'), shell + '<p>changed</p>');
  await assert.rejects(
    reviewMarkdown(root, new AbortController().signal),
    /Frozen artifact bytes differ: consumer\/index.html/
  );
  writeFileSync(join(root, 'consumer/index.html'), shell);
  provenance.frozen.pop();
  writeFileSync(join(root, 'provenance.json'), JSON.stringify(provenance));
  await assert.rejects(
    reviewMarkdown(root, new AbortController().signal),
    /Served file requires matching frozen bytes: consumer\/index.html/
  );
});
for (const phase of ['launch', 'check', 'close']) {
  test(
    `browser ${phase} failure closes the actual owned server`,
    { timeout: 5000 },
    async () => {
      let url,
        closes = 0;
      const browser = {
        close: async () => {
          closes++;
          if (phase === 'close') throw new Error('close failed');
        },
      };
      await assert.rejects(
        verifyMarkdownBrowser('', {
          launch: async (value) => {
            url = value;
            if (phase === 'launch') throw new Error('launch failed');
            return browser;
          },
          check: async () => {
            if (phase === 'check') throw new Error('check failed');
          },
        }),
        new RegExp(phase + ' failed')
      );
      assert.equal(closes, phase === 'launch' ? 0 : 1);
      await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
    }
  );
}

test('import is inert and does not need build artifacts or a browser', () => {
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { Server } from 'node:http';
    Server.prototype.listen = () => { throw new Error('Unexpected server on import'); };
    await import(${JSON.stringify(
      new URL('./verify-markdown.mjs', import.meta.url).href
    )});
  `,
    ],
    { cwd: tmpdir(), timeout: 5000, stdio: 'pipe' }
  );
});

test('serves the native generated shell and only explicit presentation assets alongside original routes', async () => {
  const server = await serveMarkdown({ bundle: 'old bundle', shell: 'old shell', provenance: {}, presentation: {
    shell: 'generated shell', assets: { '/presentation-assets/main-ABC.js': ['text/javascript', 'generated bundle'] },
  } });
  try {
    for (const [route, value] of [['/', 'old shell'], ['/app.js', 'old bundle'], ['/presentation', 'generated shell'], ['/presentation-assets/main-ABC.js', 'generated bundle']])
      assert.equal(await (await fetch(server.url + route)).text(), value);
    for (const route of ['/presentation-assets/unlisted.js', '/presentation-assets/%2e%2e/package.json']) assert.equal((await fetch(server.url + route)).status, 404);
  } finally { await server.close(); }
});

test(
  'retained review CLI preserves its frozen HTML/CSS instead of the current default and SIGTERM closes its server',
  { timeout: 8000 },
  async (t) => {
    const { root } = fixture(t),
      bundle = 'export {};',
      shell =
        '<!doctype html><style>body{color:rebeccapurple}</style><p>Previously verified shell</p>';
    mkdirSync(join(root, 'consumer'));
    writeFileSync(join(root, 'consumer/browser.js'), bundle);
    writeFileSync(join(root, 'consumer/index.html'), shell);
    writeFileSync(
      join(root, 'provenance.json'),
      JSON.stringify({
        browser: { bundleSha256: sha256(bundle) },
        frozen: [
          { path: 'consumer/browser.js', sha256: sha256(bundle) },
          { path: 'consumer/index.html', sha256: sha256(shell) },
        ],
      })
    );
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('./verify-markdown.mjs', import.meta.url)),
        '--review',
        root,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let deadline;
    const exited = new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal }))
    );
    try {
      const startup = await new Promise((resolve, reject) => {
        let output = '';
        deadline = setTimeout(
          () => reject(new Error('Review startup did not finish')),
          4000
        );
        child.once('error', reject);
        child.once('exit', () =>
          reject(new Error('Review exited before startup'))
        );
        child.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.includes('\n')) {
            clearTimeout(deadline);
            resolve(JSON.parse(output.split('\n')[0]));
          }
        });
      });
      assert.equal(
        await (
          await fetch(startup.url, { signal: AbortSignal.timeout(1000) })
        ).text(),
        shell
      );
      assert.equal(
        await (
          await fetch(startup.url + '/app.js', {
            signal: AbortSignal.timeout(1000),
          })
        ).text(),
        bundle
      );
      child.kill('SIGTERM');
      const stopped = await Promise.race([
        exited,
        new Promise((_, reject) => {
          deadline = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('Review shutdown exceeded deadline'));
          }, 2000);
        }),
      ]);
      clearTimeout(deadline);
      assert.deepEqual(stopped, { code: 0, signal: null });
      await assert.rejects(
        fetch(startup.url, { signal: AbortSignal.timeout(1000) })
      );
    } finally {
      clearTimeout(deadline);
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL');
      await exited;
    }
  }
);
