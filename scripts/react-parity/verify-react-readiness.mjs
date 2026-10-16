import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  lstatSync,
  readdirSync,
  readlinkSync,
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packLocalArtifacts } from './verify-packages.mjs';
import { fileHashes, sha256 } from './langgraph-candidate-package.mjs';
import { assertInstalledInputs } from './ag-ui-candidate-package.mjs';
import { checkTypes } from './verify-langgraph-candidate.mjs';
import {
  reactRenderPresentationSeeds,
  installPresentationConsumer,
  readPresentation,
} from './markdown-presentation-build.mjs';
import {
  assertArtifactFiles,
  assertFrozen,
  retainMarkdownSources,
  verifyMarkdownBrowser,
} from './verify-markdown.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
export function assertReadinessInputs(modules) {
  const executed = modules
    .filter((m) => m.renderedLength > 0)
    .map((m) => m.path);
  for (const required of [
    'node_modules/@threadplane/content/src/render-state/create-render-state.js',
    'node_modules/@threadplane/content/src/render-state/owned-value.js',
    'node_modules/@threadplane/react/src/use-agent.js',
    'node_modules/@threadplane/react/src/render/render-spec.js',
    'node_modules/@threadplane/react/src/render/readiness.js',
    'node_modules/@json-render/core/dist/index.mjs',
    'node_modules/react/cjs/react.development.js',
    'node_modules/react-dom/cjs/react-dom-client.development.js',
  ])
    assert.ok(
      executed.includes(required),
      'Executed installed implementation required: ' + required
    );
  for (const path of executed) {
    assert.doesNotMatch(path, /(?:^|\/)libs\//, 'No workspace alias');
    assert.doesNotMatch(
      path,
      /@angular\/|@threadplane\/(?:angular|a2ui|render|chat|ag-ui|langgraph|debug)\/|@(?:cacheplane|langchain|ag-ui|anthropic-ai|mastra)\/|node_modules\/(?:openai|langchain)\/|@threadplane\/content\/src\/(?:a2ui|json|markdown|messages)\//,
      'Forbidden executed runtime'
    );
  }
}
export function assertReadinessArtifacts(tarballs, profile) {
  assert.equal(profile, 'react-render', 'Native React render package profile');
  assert.deepEqual(
    Object.keys(tarballs).sort(),
    ['@threadplane/content', '@threadplane/core', '@threadplane/react'],
    'Exactly three local artifacts'
  );
  assert.equal(
    new Set(Object.values(tarballs)).size,
    3,
    'Distinct actual tarballs'
  );
  for (const path of Object.values(tarballs))
    assert.match(path, /^file:\/.+\.tgz$/, 'Actual packed artifact');
}
export function requestPolicy(origin, assets = [], limit = 16) {
  const base = new URL(origin);
  assert.equal(base.protocol, 'http:');
  assert.equal(base.hostname, '127.0.0.1');
  assert.equal(base.origin, origin);
  assert.ok(Number.isInteger(limit) && limit > 0);
  for (const path of assets)
    assert.match(path, /^\/presentation-assets\/[A-Za-z0-9_./-]+$/);
  const paths = new Set(['/presentation', ...assets]);
  let count = 0;
  return (url, method) => {
    if (++count > limit || method !== 'GET') return false;
    try {
      const target = new URL(url);
      return (
        target.origin === origin &&
        !target.search &&
        !target.hash &&
        url === origin + target.pathname &&
        paths.has(target.pathname)
      );
    } catch {
      return false;
    }
  };
}
export function assertOwnership(e, { uncommitted = false } = {}) {
  assert.equal(e.constructed, 1, 'One application-created actual owner');
  for (const key of [
    'set',
    'update',
    'dispose',
    'registrations',
    'cleanups',
    'outstanding',
    'notifications',
  ])
    assert.ok(
      Number.isInteger(e[key]) && e[key] >= 0,
      'Actual nonnegative counter ' + key
    );
  assert.equal(
    e.registrations - e.cleanups,
    e.outstanding,
    'Independent subscription release accounting'
  );
  assert.equal(
    e.outstanding,
    e.mounted ? 1 : 0,
    'Only mounted observer subscribes'
  );
  assert.equal(
    e.dispose,
    e.mounted ? 0 : e.dispose,
    'Mounted observer never disposes owner'
  );
  assert.ok(e.dispose <= 1, 'Only application final teardown disposes');
  if (e.mounted && !uncommitted)
    assert.equal(
      e.observedId,
      e.snapshotId,
      'Committed observer borrows exact actual snapshot'
    );
}
const updateValues = {
  'Suspend candidate': { payload: 'suspend', label: 'candidate' },
  'Cancel candidate': { payload: null, label: 'initial' },
  Ready: { payload: 'complete', label: 'ready' },
  'Later missing': { payload: null, label: 'later' },
  'Ready again': { payload: 'complete-2', label: 'again' },
  'Missing while hidden': { payload: null, label: 'hidden' },
  'Ready after remount': { payload: 'remounted', label: 'final' },
};
export const sequence = [
  'Suspend candidate',
  'Cancel candidate',
  'Ready',
  'Later missing',
  'Descriptor only',
  'Replace pending predicate',
  'Ready again',
  'Replace ready predicate',
  'Replace type',
  'Replace key',
  'Replace component',
  'Hide',
  'Missing while hidden',
  'Show pending',
  'Null fallback',
  'Remount pending',
  'Ready after remount',
  'Reorder rows',
  'Unmount',
  'Remount',
  'Teardown',
];
export function assertTransition(before, next, action) {
  assert.ok(sequence.includes(action), 'Known application control');
  assert.equal(next.step, before.step + 1);
  assert.equal(next.constructed, 1);
  const updating = Object.hasOwn(updateValues, action),
    setting = ['Hide', 'Show pending', 'Reorder rows'].includes(action);
  assert.equal(
    next.update,
    before.update + (updating ? 1 : 0),
    'Exactly one caller batch'
  );
  assert.equal(
    next.set,
    before.set + (setting ? 1 : 0),
    'Exactly one caller set'
  );
  assert.equal(
    next.dispose,
    before.dispose + (action === 'Teardown' ? 1 : 0),
    'Application-only final disposal'
  );
  assert.equal(
    next.notifications,
    before.notifications + (updating || setting ? 1 : 0),
    'One actual owner publication'
  );
  const expected = structuredClone(before.snapshot);
  if (updating) Object.assign(expected, updateValues[action]);
  if (action === 'Hide') expected.show = false;
  if (action === 'Show pending') expected.show = true;
  if (action === 'Reorder rows')
    expected.rows = [
      { id: 'b', value: null },
      { id: 'a', value: 'A-current' },
    ];
  assert.deepEqual(
    next.snapshot,
    expected,
    'Literal actual state for ' + action
  );
  if (updating || setting)
    assert.notEqual(
      next.snapshotId,
      before.snapshotId,
      'Accepted state gets actual new reference'
    );
  else
    assert.equal(
      next.snapshotId,
      before.snapshotId,
      'Lifecycle retains actual snapshot'
    );
  if (['Later missing', 'Descriptor only', 'Reorder rows'].includes(action))
    assert.equal(
      next.predicateCalls,
      before.predicateCalls,
      'Committed gate skips further predicate'
    );
}
export function assertProcessAbsent(pid, kill = process.kill) {
  try {
    kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return;
    throw error;
  }
  assert.fail('Owned browser process still exists: ' + pid);
}
const shell =
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="icon" href="data:,"><title>Installed native React readiness</title><style>body{font:16px system-ui;margin:24px;line-height:1.5;color:#143333;background:#f7faf8}main{max-width:1000px;margin:auto}button,input{font:inherit;padding:6px;margin:4px}button{border:1px solid #567}section{padding:12px;border:1px solid #abc;margin:12px 0}label{display:inline-block;padding:8px}</style><main><h1>Native React admission and local state</h1><p>The application owns the real state. Inputs belong to the admitted React views.</p><div id="controls"></div><div id="react"></div></main><script type="module" src="/react.tsx"></script></html>';
export async function buildReadinessPresentation(consumer, expected) {
  const files = ['state.ts', 'react.tsx', 'installed-types.ts'];
  for (const file of files)
    cpSync(
      join(root, 'fixtures/react-parity/react-readiness', file),
      join(consumer, file)
    );
  writeFileSync(join(consumer, 'index.html'), shell);
  writeJson(join(consumer, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'ESNext.Disposable', 'DOM'],
      jsx: 'react-jsx',
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      types: ['react', 'react-dom'],
    },
    files: ['react.tsx', 'installed-types.ts'],
  });
  const types = checkTypes(consumer, 'tsconfig.json');
  assertInstalledInputs(
    consumer,
    types.map((m) => m.path),
    expected
  );
  for (const path of [
    'node_modules/@threadplane/content/src/render-state/create-render-state.d.ts',
    'node_modules/@threadplane/react/src/use-agent.d.ts',
    'node_modules/@threadplane/react/src/render/types.d.ts',
    'node_modules/@threadplane/react/src/render/render-spec.d.ts',
    'node_modules/@json-render/core/dist/index.d.ts',
  ])
    assert.ok(
      types.some((m) => m.path === path),
      'Installed declaration required: ' + path
    );
  const { build } = await import(
    pathToFileURL(join(consumer, 'node_modules/vite/dist/node/index.js')).href
  );
  const transformedModules = [];
  const result = await build({
    plugins: [
      {
        name: 'readiness-transformed-provenance',
        generateBundle() {
          for (const id of this.getModuleIds()) {
            const info = this.getModuleInfo(id);
            if (typeof info?.code === 'string')
              transformedModules.push({
                path: id.replaceAll(consumer, '<consumer>'),
                sha256: sha256(info.code),
              });
          }
        },
      },
    ],
    configFile: false,
    envFile: false,
    root: consumer,
    base: '/presentation-assets/',
    mode: 'development',
    define: { 'process.env.NODE_ENV': '"development"' },
    esbuild: { jsx: 'automatic' },
    build: {
      outDir: join(consumer, 'presentation-output/browser'),
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
    },
  });
  const allModules = (Array.isArray(result) ? result : [result])
    .flatMap((m) => m.output)
    .flatMap((chunk) => Object.entries(chunk.modules ?? {}))
    .map(([path, module]) => ({ path, renderedLength: module.renderedLength }));
  const partition = partitionViteInputs(allModules);
  const virtualModules = partition.virtual.map((m) => {
    const path = m.path.replaceAll(consumer, '<consumer>');
    const transformed = transformedModules.find(
      (record) => record.path === path
    );
    assert.ok(
      transformed,
      'Transformed code hash required for virtual module ' + path
    );
    return {
      ...m,
      path,
      transformedCodeSha256: transformed.sha256,
      origin: 'Vite generated module; generator bytes frozen in installedFiles',
    };
  });
  const modules = partition.physical
    .map((m) => ({ ...m, path: relative(consumer, m.path) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const inputs = modules.map((m) => m.path);
  assertInstalledInputs(consumer, inputs, expected);
  assertReadinessInputs([...modules, ...virtualModules]);
  const outputs = fileHashes(join(consumer, 'presentation-output')).map(
    (m) => ({ ...m, path: 'presentation-output/' + m.path })
  );
  return {
    types,
    modules,
    virtualModules,
    transformedModules,
    inputs,
    inputHashes: inputs.map((path) => ({
      path,
      sha256: sha256(readFileSync(join(consumer, path))),
    })),
    outputs,
    files: [...files, 'index.html', 'tsconfig.json'].map((path) => ({
      path,
      sha256: sha256(readFileSync(join(consumer, path))),
    })),
    shell: 'presentation-output/browser/index.html',
    assets: outputs.filter(
      (m) => m.path !== 'presentation-output/browser/index.html'
    ),
  };
}
export async function verifyReadinessBrowser(
  browser,
  url,
  { assets = [], directory } = {}
) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const problems = [],
    requests = [],
    rejected = [],
    steps = [];
  const allow = requestPolicy(url, assets);
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()))
      problems.push(message.text());
  });
  await page.route('**/*', (route) => {
    const r = route.request();
    requests.push({ url: r.url(), method: r.method() });
    if (!allow(r.url(), r.method())) {
      rejected.push(r.url());
      return route.abort();
    }
    return route.continue();
  });
  const read = () => page.evaluate(() => window.__readiness());
  const view = page.getByTestId('main-view'),
    input = page.getByRole('textbox', {
      name: 'Main local input',
      exact: true,
    });
  const identity = async (handle, same) =>
    assert.equal(
      await handle.evaluate(
        (node) =>
          node === document.querySelector('[aria-label="Main local input"]')
      ),
      same,
      'Actual input DOM identity'
    );
  const expectedDOM = async ({
    real,
    pending = false,
    value = null,
    title = '',
    loading = true,
    key = 'main',
    local = 'seed',
    visible = true,
  }) => {
    assert.equal(await view.count(), real ? 1 : 0);
    assert.equal(await page.getByTestId('pending').count(), pending ? 1 : 0);
    assert.equal(
      await page.getByTestId('child').count(),
      real ? 1 : 0,
      'Pending children withheld'
    );
    if (pending) {
      assert.equal(
        await page.getByTestId('pending').getAttribute('data-children'),
        '0'
      );
      assert.equal(
        await page.getByTestId('pending').getAttribute('data-value'),
        JSON.stringify(value)
      );
    }
    if (real) {
      assert.equal(await input.inputValue(), local);
      for (const [attr, expected] of Object.entries({
        'data-value': JSON.stringify(value),
        'data-title': title,
        'data-loading': String(loading),
        'data-element': key,
        'data-binding': '/label',
        'data-frozen': 'true',
      }))
        assert.equal(await view.getAttribute(attr), expected, attr);
    }
    if (visible)
      for (const name of ['direct-memo', 'direct-forward'])
        assert.equal(
          await page.getByTestId(name).textContent(),
          'undefined',
          'Direct exotic component preserves undefined'
        );
  };
  const screenshot = async (action, index) => {
    if (directory)
      await page.screenshot({
        path: join(
          directory,
          String(index).padStart(2, '0') +
            '-' +
            action.toLowerCase().replaceAll(' ', '-') +
            '.png'
        ),
        fullPage: true,
      });
  };
  try {
    await page.goto(url + '/presentation');
    await page.waitForFunction(
      () =>
        window.__readiness?.().observedId === window.__readiness().snapshotId &&
        window.__readiness().registrations >= 2
    );
    let e = await read();
    assertOwnership(e);
    assert.equal(e.set, 0);
    assert.equal(e.update, 0);
    assert.equal(e.dispose, 0);
    assert.equal(e.notifications, 0);
    assert.ok(e.cleanups >= 1, 'Actual development StrictMode replay');
    await expectedDOM({ real: false, pending: true });
    steps.push({
      action: 'Initial StrictMode pending',
      expectedCounts: assertLiteralCounts(0, e),
      expected: { real: false, pending: true },
      evidence: e,
    });
    await screenshot('initial', 0);
    let previousInput,
      rowA,
      rowB,
      current = { real: false, pending: true };
    for (const [index, action] of sequence.entries()) {
      const before = await read();
      await page.getByRole('button', { name: action, exact: true }).click();
      await page.waitForFunction(
        (step) => window.__readiness().step === step,
        index + 1
      );
      if (action === 'Suspend candidate')
        await page.getByTestId('suspended').waitFor();
      else if (!['Unmount', 'Teardown'].includes(action))
        await page.waitForFunction(
          () =>
            window.__readiness().observedId === window.__readiness().snapshotId
        );
      e = await read();
      assertOwnership(e, { uncommitted: action === 'Suspend candidate' });
      assertTransition(before, e, action);
      if (action === 'Suspend candidate') {
        assert.ok(e.suspendedAttempts > 0, 'Real view actually suspended');
        assert.equal(await view.count(), 0);
        current = { real: false, pending: false };
      }
      if (action === 'Cancel candidate') {
        assert.ok(
          e.predicateCalls > before.predicateCalls,
          'Uncommitted candidate never admits later missing data'
        );
        current = { real: false, pending: true };
      }
      if (action === 'Ready') {
        current = {
          real: true,
          pending: false,
          value: 'complete',
          title: 'ready',
          loading: false,
        };
        await expectedDOM(current);
        await input.fill('edited-main');
        previousInput = await input.elementHandle();
        current.local = 'edited-main';
        rowA = await page
          .getByRole('textbox', { name: 'Row a', exact: true })
          .elementHandle();
        rowB = await page
          .getByRole('textbox', { name: 'Row b', exact: true })
          .elementHandle();
        await page
          .getByRole('textbox', { name: 'Row a', exact: true })
          .fill('edited-a');
        await page
          .getByRole('textbox', { name: 'Row b', exact: true })
          .fill('edited-b');
      }
      if (action === 'Later missing') {
        await identity(previousInput, true);
        current = { ...current, value: null, title: 'later', loading: true };
      }
      if (action === 'Descriptor only') await identity(previousInput, true);
      if (action === 'Replace pending predicate') {
        await identity(previousInput, false);
        current = { real: false, pending: true };
      }
      if (action === 'Ready again') {
        current = {
          real: true,
          value: 'complete-2',
          title: 'again',
          loading: false,
        };
        await expectedDOM(current);
        previousInput = await input.elementHandle();
        await input.fill('before-contract');
        current.local = 'before-contract';
      }
      if (
        [
          'Replace ready predicate',
          'Replace type',
          'Replace key',
          'Replace component',
        ].includes(action)
      ) {
        await identity(previousInput, false);
        current = {
          real: true,
          value: 'complete-2',
          title: 'again',
          loading: false,
          key: ['Replace key', 'Replace component'].includes(action)
            ? 'replacement'
            : 'main',
        };
        await expectedDOM(current);
        previousInput = await input.elementHandle();
        await input.fill('before-contract');
        current.local = 'before-contract';
      }
      if (action === 'Hide') {
        await identity(previousInput, false);
        current = { real: false };
      }
      if (action === 'Missing while hidden') current = { real: false };
      if (action === 'Show pending')
        current = { real: false, pending: true, value: null };
      if (['Null fallback', 'Remount pending'].includes(action))
        current = { real: false };
      if (action === 'Ready after remount') {
        current = {
          real: true,
          value: 'remounted',
          title: 'final',
          loading: false,
          key: 'replacement',
        };
        await expectedDOM(current);
        previousInput = await input.elementHandle();
        await input.fill('final-edit');
        current.local = 'final-edit';
      }
      if (action === 'Reorder rows') {
        await identity(previousInput, true);
        assert.equal(
          await rowA.evaluate(
            (node) => node === document.querySelector('[aria-label="Row a"]')
          ),
          true
        );
        assert.equal(
          await rowB.evaluate(
            (node) => node === document.querySelector('[aria-label="Row b"]')
          ),
          true
        );
        assert.deepEqual(
          await page
            .locator('[data-row]')
            .evaluateAll((nodes) =>
              nodes.map((n) => n.getAttribute('data-row'))
            ),
          ['b', 'a']
        );
        assert.equal(
          await page
            .getByRole('textbox', { name: 'Row a', exact: true })
            .inputValue(),
          'edited-a'
        );
        assert.equal(
          await page
            .getByRole('textbox', { name: 'Row b', exact: true })
            .inputValue(),
          'edited-b'
        );
        assert.equal(
          await page.locator('[data-row="a"]').textContent(),
          'A-current'
        );
        assert.equal(
          await page.locator('[data-row="b"]').textContent(),
          'null'
        );
      }
      if (['Unmount', 'Teardown'].includes(action)) {
        await identity(previousInput, false);
        current = { real: false, visible: false };
        assert.equal(e.outstanding, 0);
      }
      if (action === 'Remount') {
        current = {
          real: true,
          value: 'remounted',
          title: 'final',
          loading: false,
          key: 'replacement',
        };
        await expectedDOM(current);
        previousInput = await input.elementHandle();
        assert.ok(
          e.registrations - before.registrations >= 2,
          'Actual development remount replay'
        );
      }
      if (action !== 'Suspend candidate') await expectedDOM(current);
      await screenshot(action, index + 1);
      steps.push({
        action,
        expectedCounts: assertLiteralCounts(index + 1, e),
        expected: current,
        evidence: e,
      });
      if (directory) writeJson(join(directory, 'browser-steps.json'), steps);
    }
    assert.equal(e.set, 3);
    assert.equal(e.update, 7);
    assert.equal(e.dispose, 1);
    assert.equal(e.notifications, 10);
    assert.equal(e.outstanding, 0);
    assert.deepEqual(problems, []);
    assert.deepEqual(rejected, []);
    assert.ok(requests.length <= 16);
    return { steps, requests, rejected, problems };
  } finally {
    await page.close();
  }
}
async function ownedLaunch(cleanup) {
  const { chromium } = await import('@playwright/test');
  const server = await chromium.launchServer();
  const child = server.process();
  cleanup.pid = child.pid;
  cleanup.profile = child.spawnargs
    .find((arg) => arg.startsWith('--user-data-dir='))
    ?.slice('--user-data-dir='.length);
  const close = async () => {
    await server.close();
    cleanup.exitCode = child.exitCode;
    cleanup.signalCode = child.signalCode;
    assert.ok(
      child.exitCode !== null || child.signalCode !== null,
      'Actual browser exit'
    );
    assertProcessAbsent(child.pid);
    cleanup.browserAbsent = true;
    cleanup.profileRemoved = !existsSync(cleanup.profile);
    assert.equal(cleanup.profileRemoved, true);
  };
  try {
    assert.ok(cleanup.profile);
    const browser = await chromium.connect(server.wsEndpoint());
    return {
      newPage: (...args) => browser.newPage(...args),
      close: async () => {
        try {
          await browser.close();
        } finally {
          await close();
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
export async function verifyReactReadiness({ retain } = {}) {
  const temporary = retain
    ? resolve(retain)
    : mkdtempSync(join(tmpdir(), 'native-react-readiness-'));
  if (retain) {
    assert.equal(existsSync(temporary), false, 'Retain requires NEW_DIRECTORY');
    mkdirSync(temporary);
  }
  const cleanup = { retainedConsumer: Boolean(retain) };
  let origin;
  try {
    const tarballs = packLocalArtifacts(root, temporary, [
      'core',
      'content',
      'react',
    ]);
    assertReadinessArtifacts(tarballs, 'react-render');
    const expected = Object.fromEntries(
      Object.keys(tarballs).map((name) => [
        name,
        fileHashes(join(temporary, 'packed-' + name.split('/')[1], 'package')),
      ])
    );
    const consumer = join(temporary, 'consumer');
    mkdirSync(consumer);
    const rootLockSha256 = sha256(
      readFileSync(join(root, 'package-lock.json'))
    );
    const installation = installPresentationConsumer(
      consumer,
      json(join(root, 'package-lock.json')),
      tarballs,
      { seeds: reactRenderPresentationSeeds, profile: 'react-render' }
    );
    assertReadinessArtifacts(tarballs, installation.profile);
    for (const [name, files] of Object.entries(expected))
      assertArtifactFiles(join(consumer, 'node_modules', name), files);
    const presentation = await buildReadinessPresentation(consumer, expected);
    const paths = execFileSync(
      'git',
      [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'libs/core',
        'libs/content',
        'libs/react',
        'fixtures/react-parity/react-readiness',
        'scripts/react-parity',
        'scripts/ci-workflow.spec.mjs',
        'package-lock.json',
        'package.json',
        'tsconfig.base.json',
        'nx.json',
        '.github/workflows/ci.yml',
      ],
      { cwd: root, encoding: 'utf8' }
    )
      .trim()
      .split('\n');
    const sources = retainMarkdownSources(
      root,
      temporary,
      [...new Set(paths)].sort()
    );
    const installedFiles = installedFileRecords(join(consumer, 'node_modules'));
    const frozen = [
      ...sources,
      ...installedFiles.map((m) => ({
        ...m,
        path: 'consumer/node_modules/' + m.path,
      })),
      ...[
        ...presentation.outputs,
        ...presentation.files,
        ...presentation.types,
        ...presentation.inputHashes,
      ].map((m) => ({ ...m, path: 'consumer/' + m.path })),
      ...Object.values(tarballs).map((path) => ({
        path: relative(temporary, path.slice(5)),
        sha256: sha256(readFileSync(path.slice(5))),
      })),
      ...['package.json', 'package-lock.json'].map((path) => ({
        path: 'consumer/' + path,
        sha256: sha256(readFileSync(join(consumer, path))),
      })),
    ];
    const provenance = {
      rootLockSha256,
      installation,
      expected,
      presentation,
      installedFiles,
      sources,
      frozen,
      node: process.version,
      head: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
    };
    writeJson(join(temporary, 'provenance.json'), provenance);
    const assets = readPresentation(temporary, provenance);
    const result = await verifyMarkdownBrowser('', {
      launch: async (url) => {
        origin = url;
        return ownedLaunch(cleanup);
      },
      presentation: assets,
      check: (browser, url) =>
        verifyReadinessBrowser(browser, url, {
          assets: Object.keys(assets.assets),
          directory: temporary,
        }),
    });
    for (const [name, files] of Object.entries(expected))
      assertArtifactFiles(join(consumer, 'node_modules', name), files);
    assertFrozen(temporary, frozen);
    assert.deepEqual(
      installedFileRecords(join(consumer, 'node_modules')),
      installedFiles,
      'Complete installed files remain frozen'
    );
    for (const record of sources)
      assert.equal(
        sha256(readFileSync(join(root, record.path.slice('sources/'.length)))),
        record.sha256,
        'Fresh source fingerprint after browser suite: ' + record.path
      );
    assert.equal(
      sha256(readFileSync(join(root, 'package-lock.json'))),
      rootLockSha256
    );
    writeJson(join(temporary, 'browser-result.json'), result);
    console.log('Installed native React readiness verified: ' + temporary);
    return { temporary: realpathSync(temporary), provenance, result };
  } catch (error) {
    writeJson(join(temporary, 'failure.json'), {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    try {
      if (origin) {
        cleanup.origin = origin;
        try {
          await fetch(origin);
          assert.fail('Owned socket still open');
        } catch (error) {
          assert.equal(
            error.cause?.code,
            'ECONNREFUSED',
            'Actual owned socket refused after close'
          );
          cleanup.serverClosed = true;
        }
      }
    } finally {
      writeJson(join(temporary, 'cleanup.json'), cleanup);
      if (!retain) rmSync(temporary, { recursive: true, force: true });
    }
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.ok(
    process.argv.length === 2 ||
      (process.argv.length === 4 && process.argv[2] === '--retain'),
    'Usage: verify-react-readiness.mjs [--retain NEW_DIRECTORY]'
  );
  await verifyReactReadiness({ retain: process.argv[3] });
}

export function partitionViteInputs(modules) {
  const generated = (record) =>
    record.path.startsWith('\0') || record.path.includes('?');
  return {
    physical: modules.filter((record) => !generated(record)),
    virtual: modules.filter(generated),
  };
}

export function installedFileRecords(directory) {
  const base = realpathSync(directory),
    records = [];
  const visit = (path) => {
    const absolute = join(base, path),
      stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(absolute);
      assert.ok(
        target.startsWith(base + '/'),
        'Installed link escapes bounded tree: ' + path
      );
      assert.equal(
        lstatSync(target).isFile(),
        true,
        'Installed link must resolve to regular file'
      );
      records.push({
        path,
        link: readlinkSync(absolute),
        sha256: sha256(readFileSync(target)),
      });
    } else if (stat.isDirectory())
      for (const name of readdirSync(absolute).sort())
        visit(path ? path + '/' + name : name);
    else {
      assert.equal(stat.isFile(), true, 'Installed entry must be regular file');
      records.push({ path, sha256: sha256(readFileSync(absolute)) });
    }
  };
  visit('');
  return records;
}

export function assertLiteralCounts(step, evidence) {
  const literal = [
    [0, 0, 0, 0],
    [0, 1, 0, 1],
    [0, 2, 0, 2],
    [0, 3, 0, 3],
    [0, 4, 0, 4],
    [0, 4, 0, 4],
    [0, 4, 0, 4],
    [0, 5, 0, 5],
    [0, 5, 0, 5],
    [0, 5, 0, 5],
    [0, 5, 0, 5],
    [0, 5, 0, 5],
    [1, 5, 0, 6],
    [1, 6, 0, 7],
    [2, 6, 0, 8],
    [2, 6, 0, 8],
    [2, 6, 0, 8],
    [2, 7, 0, 9],
    [3, 7, 0, 10],
    [3, 7, 0, 10],
    [3, 7, 0, 10],
    [3, 7, 1, 10],
  ];
  assert.ok(
    Number.isInteger(step) && step >= 0 && step < literal.length,
    'Known browser milestone'
  );
  const expected = Object.fromEntries(
    ['set', 'update', 'dispose', 'notifications'].map((key, index) => [
      key,
      literal[step][index],
    ])
  );
  for (const [key, value] of Object.entries(expected))
    assert.equal(
      evidence[key],
      value,
      'Independent literal ' + key + ' at step ' + step
    );
  return expected;
}
