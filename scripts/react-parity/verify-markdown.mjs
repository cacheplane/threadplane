import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import {
  fileHashes,
  sha256,
  lockedVendorGraph,
  vendorOverrides,
} from './langgraph-candidate-package.mjs';
import { assertInstalledInputs } from './ag-ui-candidate-package.mjs';
import { checkTypes } from './verify-langgraph-candidate.mjs';
import {
  packLocalArtifacts,
  runConsumer,
  validatePackage,
  assertParserFreeInputs,
} from './verify-packages.mjs';
import { verifyBoundaries } from './verify-boundaries.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
export const buildCommand =
  'NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p content,core,react,angular --skip-nx-cache --outputStyle=stream';
export const sequence = [
  'Append',
  'Remove React',
  'Append more',
  'Mount React',
  'Remove Angular',
  'Complete',
  'Mount Angular',
  'New generation',
  'Dispose',
  'Try disposed',
];
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Owned Markdown observation</title><style>body{font:16px system-ui;background:#faf8f3;color:#222;margin:2rem;line-height:1.5}main{max-width:1100px;margin:auto}h1{font-size:2rem}button{padding:.65rem;margin:.3rem;border:1px solid #666;border-radius:6px}button:enabled{background:#183d3d;color:white;cursor:pointer}.panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}.panel{border:1px solid #ccc;background:white;padding:1rem;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}#evidence{background:#eef1ed;padding:1rem}</style><main><h1>One owned Markdown document, two observers</h1><p>This fixture shows literal input and owned node summaries. It does not render Markdown or call a backend. React and Angular borrow the same content owner.</p><p><a href="/provenance" target="_blank" rel="noreferrer">Installed artifact provenance</a></p><section aria-label="Walkthrough"><h2>Owner controls</h2><p id="next"></p><div id="controls"></div></section><div class="panels"><div class="panel"><h2>React observation</h2><div id="react"></div></div><div class="panel"><h2>Angular observation</h2><div id="angular"></div></div></div><h2>Ownership evidence</h2><p>View removal releases observation. Only the controls update or dispose the owner. Retained snapshots stay unchanged.</p><pre id="evidence"></pre></main><script type="module" src="/app.js"></script></html>`;

export function validateMarkdown(root) {
  const directory = join(root, 'dist/libs/content');
  const manifest = json(join(directory, 'package.json'));
  assert.ok(
    manifest.exports?.['./markdown'],
    'Markdown feature export required'
  );
  assert.deepEqual(
    validatePackage(directory),
    [],
    'Valid content export targets required'
  );
  const errors = verifyBoundaries({
    root,
    mode: 'built',
    projects: ['content'],
  });
  assert.deepEqual(errors, [], errors.join('\n'));
}
export function assertArtifactFiles(directory, expected) {
  assert.deepEqual(
    fileHashes(directory),
    expected,
    'Installed artifact bytes equal the actual unpacked tarball'
  );
}
export function assertMarkdownRootInputs(inputs) {
  assert.ok(!Array.isArray(inputs), 'Metafile input map required');
  const paths = Object.keys(inputs);
  assertParserFreeInputs(inputs);
  assert.ok(
    !paths.some((path) => /\/markdown\//.test(path)),
    'Root does not reach Markdown feature'
  );
}
export function assertFrozen(directory, records) {
  directory = realpathSync(directory);
  for (const record of records) {
    const path = realpathSync(resolve(directory, record.path));
    assert.ok(
      path.startsWith(directory + '/'),
      'Frozen artifact path escapes retained directory'
    );
    assert.equal(
      sha256(readFileSync(path)),
      record.sha256,
      `Frozen artifact bytes differ: ${record.path}`
    );
  }
}
export async function serveMarkdown({
  bundle,
  shell = html,
  provenance,
  signal,
}) {
  assert.equal(signal?.aborted ?? false, false, 'Review startup aborted');
  const controller = new AbortController();
  const server = createServer((request, response) => {
    const route = new URL(request.url, 'http://127.0.0.1').pathname;
    const entry =
      request.method === 'GET'
        ? {
            '/': ['text/html', shell],
            '/app.js': ['text/javascript', bundle],
            '/provenance': ['application/json', JSON.stringify(provenance)],
            '/favicon.ico': ['image/x-icon', ''],
          }[route]
        : undefined;
    response.writeHead(entry ? 200 : 404, {
      'content-type': entry?.[0] ?? 'text/plain',
      'cache-control': 'no-store',
    });
    response.end(entry?.[1] ?? 'Not found');
  });
  let timer, closing;
  const close = () =>
    (closing ??= new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error('Owned review shutdown exceeded deadline')),
        3000
      );
      server.close((error) => {
        clearTimeout(deadline);
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else resolve();
      });
      server.closeAllConnections();
    }));
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    await new Promise((resolve, reject) => {
      const cancelled = () => reject(new Error('Review startup aborted'));
      controller.signal.addEventListener('abort', cancelled, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Owned review startup exceeded deadline'));
      }, 3000);
      server.once('error', reject);
      server.listen(
        { port: 0, host: '127.0.0.1', signal: controller.signal },
        () => {
          controller.signal.removeEventListener('abort', cancelled);
          resolve();
        }
      );
    });
    return {
      url: `http://127.0.0.1:${server.address().port}`,
      close: async () => {
        signal?.removeEventListener('abort', stop);
        await close();
      },
    };
  } catch (error) {
    signal?.removeEventListener('abort', stop);
    controller.abort();
    await close();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function browserProof(consumer, expected) {
  cpSync(
    join(root, 'fixtures/react-parity/markdown/browser.tsx'),
    join(consumer, 'browser.tsx')
  );
  writeJson(join(consumer, 'tsconfig.browser.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM'],
      jsx: 'react-jsx',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      types: [],
    },
    files: ['browser.tsx'],
  });
  const types = checkTypes(consumer, 'tsconfig.browser.json');
  const build = buildSync({
    absWorkingDir: consumer,
    entryPoints: ['browser.tsx'],
    tsconfig: join(consumer, 'tsconfig.browser.json'),
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  const inputs = Object.keys(build.metafile.inputs),
    bundle = build.outputFiles[0].text;
  assertInstalledInputs(consumer, inputs, expected);
  assertInstalledInputs(
    consumer,
    types.map((file) => file.path),
    expected
  );
  for (const file of [
    'node_modules/@threadplane/content/src/markdown/create-markdown.js',
    'node_modules/@threadplane/react/src/use-agent.js',
    'node_modules/@threadplane/angular/fesm2022/threadplane-angular.mjs',
  ])
    assert.ok(
      inputs.includes(file),
      `Installed implementation required: ${file}`
    );
  assert.ok(
    inputs.some((file) =>
      file.includes('node_modules/@cacheplane/partial-markdown/')
    )
  );
  writeFileSync(join(consumer, 'browser.js'), bundle);
  writeFileSync(join(consumer, 'index.html'), html);
  const result = await verifyMarkdownBrowser(bundle, { shell: html });
  return {
    inputs,
    inputHashes: inputs.map((path) => ({
      path,
      sha256: sha256(readFileSync(resolve(consumer, path))),
    })),
    types,
    bundleSha256: sha256(bundle),
    shellSha256: sha256(html),
    result,
  };
}

// A narrow seam for proving owned browser/server teardown without Chromium.
export async function verifyMarkdownBrowser(
  bundle,
  {
    shell = html,
    launch = async () => (await import('@playwright/test')).chromium.launch(),
    check = verifyBrowser,
  } = {}
) {
  const server = await serveMarkdown({
    bundle,
    shell,
    provenance: { installed: true, bundleSha256: sha256(bundle) },
  });
  let browser;
  try {
    browser = await launch(server.url);
    return await check(browser, server.url);
  } finally {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
}
export async function verifyBrowser(browser, url) {
  const page = await browser.newPage(),
    problems = [],
    external = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()))
      problems.push(message.text());
  });
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== url) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const read = () => page.evaluate(() => window.__markdownReview());
  const panel = (framework) =>
    page.getByRole('region', { name: framework + ' Markdown observation' });
  try {
    await page.goto(url);
    await page.waitForFunction(
      () =>
        window.__markdownReview?.().observed.react &&
        window.__markdownReview().observed.angular &&
        window.__markdownReview().subscriptions.react.outstanding === 1 &&
        window.__markdownReview().subscriptions.angular.outstanding === 1 &&
        window.__markdownReview().sameReference
    );
    let evidence = await read();
    assert.equal(evidence.commands, 0);
    assert.equal(evidence.summary.root, null);
    const initialReact = await panel('React').elementHandle(),
      initialAngular = await panel('Angular').elementHandle();
    let removedReactRenders, removedAngularRenders;
    for (const [index, action] of sequence.entries()) {
      const before = await read();
      await page.getByRole('button', { name: action, exact: true }).click();
      await page.waitForFunction(
        (step) =>
          window.__markdownReview().step === step &&
          !window.__markdownReview().busy &&
          window.__markdownReview().sameReference,
        index + 1
      );
      evidence = await read();
      assert.equal(evidence.stableRead, true);
      assert.equal(evidence.retainedStable, true);
      if (
        [
          'Remove React',
          'Mount React',
          'Remove Angular',
          'Mount Angular',
          'Dispose',
        ].includes(action)
      ) {
        assert.deepEqual(evidence.document, before.document);
        assert.equal(evidence.commands, before.commands);
      }
      if (action === 'Append') {
        assert.equal(
          evidence.document.content,
          '# Owned <b>literal</b>\n\n- ['
        );
        assert.equal(
          await initialReact.evaluate((node) => node.isConnected),
          true
        );
        assert.equal(
          await initialAngular.evaluate((node) => node.isConnected),
          true
        );
      }
      if (action === 'Remove React') {
        removedReactRenders = evidence.renders.react;
        assert.equal(
          await initialReact.evaluate((node) => node.isConnected),
          false
        );
      }
      if (action === 'Append more') {
        assert.equal(evidence.renders.react, removedReactRenders);
        assert.equal(evidence.summary.imageStatus, 'streaming');
      }
      if (action === 'Mount React') {
        await page.waitForFunction(
          () =>
            Boolean(window.__markdownReview().observed.react) &&
            window.__markdownReview().subscriptions.react.outstanding === 1
        );
        assert.equal(
          await initialReact.evaluate((node) => node.isConnected),
          false
        );
      }
      if (action === 'Remove Angular') {
        removedAngularRenders = evidence.renders.angular;
        assert.equal(
          await initialAngular.evaluate((node) => node.isConnected),
          false
        );
      }
      if (action === 'Complete') {
        assert.equal(evidence.renders.angular, removedAngularRenders);
        assert.equal(evidence.document.phase, 'complete');
        assert.equal(evidence.summary.imageStatus, 'complete');
      }
      if (action === 'Mount Angular') {
        await page.waitForFunction(
          () =>
            Boolean(window.__markdownReview().observed.angular) &&
            window.__markdownReview().subscriptions.angular.outstanding === 1
        );
        assert.equal(
          await initialAngular.evaluate((node) => node.isConnected),
          false
        );
      }
      if (action === 'New generation') {
        assert.equal(evidence.document.generation, 'review-2');
        assert.equal(evidence.summary.definitions[0][1].url, '/owned');
      }
      if (action === 'Try disposed') {
        assert.match(evidence.error, /disposed/);
        assert.deepEqual(evidence.document, before.document);
      }
      evidence = await read();
      for (const framework of ['react', 'angular']) {
        const counts = evidence.subscriptions[framework],
          prior = before.subscriptions[framework];
        assert.equal(
          counts.outstanding,
          evidence.mounted[framework] ? 1 : 0,
          `${framework} outstanding delegated cleanup handles`
        );
        assert.equal(
          counts.registrations - counts.cleanups,
          counts.outstanding,
          `${framework} distinct registration cleanup accounting`
        );
        const acceptsUpdate = [
          'Append',
          'Append more',
          'Complete',
          'New generation',
        ].includes(action);
        assert.equal(
          counts.notifications - prior.notifications,
          acceptsUpdate && evidence.mounted[framework] ? 1 : 0,
          `${framework} notifications during ${action}`
        );
        if (action === `Remove ${framework === 'react' ? 'React' : 'Angular'}`)
          assert.equal(
            counts.cleanups,
            prior.cleanups + 1,
            `${framework} removal releases registration`
          );
      }
      for (const framework of ['React', 'Angular'])
        if (evidence.mounted[framework.toLowerCase()]) {
          await page.waitForFunction(
            () => window.__markdownReview().sameReference
          );
          assert.equal(
            await panel(framework)
              .locator('[data-field=content]')
              .textContent(),
            evidence.document.content
          );
          assert.equal(
            await panel(framework).locator('[data-field=phase]').textContent(),
            evidence.document.phase
          );
          assert.equal(
            await panel(framework)
              .locator('[data-field=generation]')
              .textContent(),
            evidence.document.generation
          );
        }
    }
    assert.deepEqual(problems, []);
    assert.deepEqual(external, []);
    return { controls: sequence.length, ...(await read()), problems, external };
  } finally {
    await page.close();
  }
}

export async function verifyMarkdown({ retain } = {}) {
  for (const project of ['content', 'core', 'react', 'angular'])
    assert.ok(
      existsSync(join(root, 'dist/libs', project, 'package.json')),
      `Missing prerequisites. Run: ${buildCommand}`
    );
  let temporary;
  if (retain) {
    assert.equal(existsSync(retain), false, 'Retain requires a NEW_DIRECTORY');
    mkdirSync(retain);
    temporary = realpathSync(retain);
  } else
    temporary = realpathSync(mkdtempSync(join(tmpdir(), 'owned-markdown-')));
  let success = false;
  try {
    validateMarkdown(root);
    const tarballs = packLocalArtifacts(root, temporary, [
      'content',
      'core',
      'react',
      'angular',
    ]);
    const expected = Object.fromEntries(
      Object.keys(tarballs).map((name) => [
        name,
        fileHashes(join(temporary, 'packed-' + name.split('/')[1], 'package')),
      ])
    );
    const consumer = join(temporary, 'consumer');
    mkdirSync(consumer);
    const lock = json(join(root, 'package-lock.json'));
    const names = [
      '@cacheplane/partial-markdown',
      '@angular/core',
      '@angular/common',
      '@angular/compiler',
      '@angular/platform-browser',
      'react',
      'react-dom',
      'rxjs',
      'tslib',
      '@types/react',
      '@types/react-dom',
      '@types/node',
      'typescript',
    ];
    const vendors = lockedVendorGraph(lock, names),
      vendorNames = vendors.map((vendor) => vendor.name);
    assert.equal(
      new Set(vendorNames).size,
      vendorNames.length,
      'Review conflicting vendor versions instead of flattening them'
    );
    writeJson(join(consumer, 'package.json'), {
      private: true,
      type: 'module',
      dependencies: {
        ...Object.fromEntries(
          names.map((name) => [
            name,
            lock.packages['node_modules/' + name].version,
          ])
        ),
        ...tarballs,
      },
      overrides: {
        ...vendorOverrides(vendors, vendorNames),
        ...Object.fromEntries(
          Object.keys(tarballs).map((name) => [name, '$' + name])
        ),
      },
    });
    console.log(
      runConsumer(
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
        consumer
      )
    );
    const installedLock = json(join(consumer, 'package-lock.json'));
    assert.deepEqual(
      lockedVendorGraph(installedLock, names),
      vendors,
      'Exact owner-relative installed vendor graph'
    );
    for (const [path, pkg] of Object.entries(installedLock.packages))
      if (path.includes('node_modules/@threadplane/'))
        assert.ok(
          Object.keys(tarballs).includes(path.split('node_modules/').at(-1)) &&
            !pkg.link &&
            /^file:.*\.tgz$/.test(pkg.resolved),
          'Only actual local Threadplane tarballs'
        );
    for (const [name, files] of Object.entries(expected))
      assertArtifactFiles(join(consumer, 'node_modules', name), files);
    cpSync(
      join(root, 'fixtures/react-parity/markdown/installed-types.ts'),
      join(consumer, 'installed-types.ts')
    );
    const types = {};
    for (const mode of ['NodeNext', 'Bundler']) {
      writeJson(join(consumer, `tsconfig.${mode}.json`), {
        compilerOptions: {
          target: 'ES2022',
          module: mode === 'NodeNext' ? mode : 'ESNext',
          moduleResolution: mode,
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          types: [],
          lib: ['ES2022', 'DOM'],
        },
        files: ['installed-types.ts'],
      });
      types[mode] = checkTypes(consumer, `tsconfig.${mode}.json`);
      assertInstalledInputs(
        consumer,
        types[mode].map((file) => file.path),
        expected
      );
    }
    writeFileSync(
      join(consumer, 'node-probe.mjs'),
      `import assert from 'node:assert/strict';
const original = globalThis.fetch; let calls = 0;
globalThis.fetch = () => { calls++; throw new Error('Unexpected content I/O'); };
try {
  const root = await import('@threadplane/content'); assert.deepEqual(Object.keys(root), []);
  const feature = await import('@threadplane/content/markdown'); assert.deepEqual(Object.keys(feature), ['createMarkdown']);
  const owner = feature.createMarkdown({generation:'a',phase:'streaming',content:''}); const first = owner.getSnapshot(); assert.equal(first.root,null);
  let notifications=0; const release=owner.subscribe(()=>notifications++); assert.equal(owner.getSnapshot(),first);
  owner.update({generation:'a',phase:'streaming',content:'![alt](/url)'}); const partial=owner.getSnapshot();
  owner.update({generation:'a',phase:'complete',content:'![alt](/url)'}); assert.equal(partial.root.children[0].children[0].status,'streaming'); assert.equal(owner.getSnapshot().root.children[0].children[0].status,'complete');
  owner.update({generation:'b',phase:'complete',content:'new'}); release(); const last=owner.getSnapshot(); owner.dispose(); assert.equal(owner.getSnapshot(),last); assert.throws(()=>owner.update({generation:'c',phase:'streaming',content:''}),/disposed/);
  assert.equal(notifications,3);assert.equal(calls,0);console.log(JSON.stringify({fetches:calls,notifications,retained:true}));
} finally {globalThis.fetch=original;}`
    );
    const nodeResult = JSON.parse(
      runConsumer(process.execPath, ['node-probe.mjs'], consumer)
    );
    const rootBundle = buildSync({
      absWorkingDir: consumer,
      stdin: {
        contents: "export * from '@threadplane/content';",
        resolveDir: consumer,
      },
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      platform: 'browser',
      logLevel: 'silent',
    });
    const rootInputs = Object.keys(rootBundle.metafile.inputs);
    assertMarkdownRootInputs(rootBundle.metafile.inputs);
    const browser = await browserProof(consumer, expected);
    const sourcePaths = execFileSync(
      'git',
      [
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'libs/content',
        'fixtures/react-parity/markdown',
        'scripts/react-parity/verify-markdown.mjs',
      ],
      { cwd: root, encoding: 'utf8' }
    )
      .split('\0')
      .filter(Boolean)
      .sort();
    const frozenInputs = [
      ...new Map(
        [
          ...types.NodeNext,
          ...types.Bundler,
          ...browser.types,
          ...browser.inputHashes,
        ].map((record) => [record.path, record])
      ).values(),
    ];
    const frozen = [
      ...new Map(
        [
          ...Object.entries(expected).flatMap(([name, files]) =>
            files.map((file) => ({
              path: 'consumer/node_modules/' + name + '/' + file.path,
              sha256: file.sha256,
            }))
          ),
          ...Object.values(tarballs).map((value) => ({
            path: relative(temporary, value.slice(5)),
            sha256: sha256(readFileSync(value.slice(5))),
          })),
          ...[
            'browser.js',
            'index.html',
            'browser.tsx',
            'installed-types.ts',
            'node-probe.mjs',
            'tsconfig.browser.json',
            'tsconfig.NodeNext.json',
            'tsconfig.Bundler.json',
            'package.json',
            'package-lock.json',
          ].map((path) => ({
            path: 'consumer/' + path,
            sha256: sha256(readFileSync(join(consumer, path))),
          })),
          ...frozenInputs.map((record) => ({
            path: 'consumer/' + record.path,
            sha256: record.sha256,
          })),
        ].map((record) => [record.path, record])
      ).values(),
    ].sort((left, right) => left.path.localeCompare(right.path));
    const provenance = {
      head: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      packageLockSha256: sha256(readFileSync(join(root, 'package-lock.json'))),
      installedLockSha256: sha256(
        readFileSync(join(consumer, 'package-lock.json'))
      ),
      sources: [...new Set(sourcePaths)].map((path) => ({
        path,
        sha256: sha256(readFileSync(join(root, path))),
      })),
      vendors,
      installed: expected,
      types,
      nodeResult,
      rootInputs,
      browser,
      frozen,
    };
    writeJson(join(temporary, 'provenance.json'), provenance);
    assertFrozen(temporary, frozen);
    success = true;
    console.log(
      JSON.stringify({
        mode: 'verified-owned-markdown',
        node: nodeResult,
        browser: browser.result,
        bundleSha256: browser.bundleSha256,
        retained: Boolean(retain),
      })
    );
    return { temporary, provenance };
  } finally {
    if (!retain || !success)
      rmSync(temporary, { recursive: true, force: true });
  }
}
export async function reviewMarkdown(directory, signal) {
  assert.equal(signal.aborted, false, 'Review startup aborted');
  directory = realpathSync(directory);
  const provenance = json(join(directory, 'provenance.json'));
  assertFrozen(directory, provenance.frozen);
  const readChecked = (path) => {
    const bytes = readFileSync(join(directory, path));
    assert.equal(
      sha256(bytes),
      provenance.frozen.find((record) => record.path === path)?.sha256,
      `Served file requires matching frozen bytes: ${path}`
    );
    return bytes;
  };
  const server = await serveMarkdown({
    bundle: readChecked('consumer/browser.js'),
    shell: readChecked('consumer/index.html'),
    provenance,
    signal,
  });
  try {
    console.log(
      JSON.stringify({
        mode: 'review-owned-markdown',
        url: server.url,
        sequence,
        bundleSha256: provenance.browser.bundleSha256,
        shellSha256: provenance.browser.shellSha256,
      })
    );
    if (!signal.aborted)
      await new Promise((resolve) =>
        signal.addEventListener('abort', resolve, { once: true })
      );
  } finally {
    await server.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (
      process.argv.length === 2 ||
      (process.argv.length === 4 && process.argv[2] === '--retain')
    )
      await verifyMarkdown({ retain: process.argv[3] });
    else if (process.argv.length === 4 && process.argv[2] === '--review') {
      const controller = new AbortController(),
        stop = () => controller.abort();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      try {
        await reviewMarkdown(process.argv[3], controller.signal);
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
    } else if (process.argv.length === 3 && process.argv[2] === '--help')
      console.log(
        `Prerequisites: ${buildCommand}\nVerify: node scripts/react-parity/verify-markdown.mjs [--retain NEW_DIRECTORY]\nReview: node scripts/react-parity/verify-markdown.mjs --review RETAINED_DIRECTORY`
      );
    else
      throw new Error(
        'Expected no arguments, --retain NEW_DIRECTORY, --review RETAINED_DIRECTORY or --help'
      );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
