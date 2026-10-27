import assert from 'node:assert/strict';
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
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { packLocalArtifacts, runConsumer } from './verify-packages.mjs';
import { fileHashes, sha256 } from './langgraph-candidate-package.mjs';
import { assertInstalledInputs } from './ag-ui-candidate-package.mjs';
import { checkTypes } from './verify-langgraph-candidate.mjs';
import {
  a2uiSurfacesPresentationSeeds,
  installPresentationConsumer,
  presentationConfiguration,
  readPresentation,
} from './markdown-presentation-build.mjs';
import {
  assertArtifactFiles,
  retainMarkdownSources,
  verifyMarkdownBrowser,
} from './verify-markdown.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
export const sequence = [
  'Stage',
  'Commit root',
  'Update',
  'Delete',
  'Recreate',
  'Switch owner',
  'Apply old',
  'Commit new',
  'Switch again',
  'Apply second old',
  'Commit third',
  'Remove React',
  'Update absent React',
  'Mount React',
  'Remove Angular',
  'Update absent Angular',
  'Mount Angular',
  'Dispose',
  'Try disposed',
  'Teardown',
];
const shell = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Installed A2UI observations</title>
<style>body{font:16px system-ui,sans-serif;line-height:1.5;margin:24px;color:#222;background:#fafafa}main{max-width:1080px;margin:auto}h1{font-size:1.8rem}h2{font-size:1.2rem}button{font:inherit;padding:6px 10px;margin:3px;border:1px solid #aaa;border-radius:4px}button:enabled{background:#164544;color:white}.panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.panels article{min-width:0;border:1px solid #ccc;background:white;padding:16px;border-radius:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}#evidence{font-size:12px;padding:16px;border:1px solid #ddd;background:white}@media(max-width:600px){.panels{grid-template-columns:minmax(0,1fr)}}</style>
<main><h1>Application-owned A2UI surfaces</h1><p>Raw text/data observation only. No catalog, form, action or backend.</p><h2>Caller controls</h2><div id="controls"></div><div class="panels"><article><h2>React observation</h2><div id="react"></div></article><article><h2>Angular observation</h2><div id="angular"></div></article></div><h2>Ownership evidence</h2><pre id="evidence"></pre></main></html>`;

export function assertFeatureInputs(inputs) {
  for (const required of [
    'node_modules/@threadplane/content/src/a2ui/create-surfaces.js',
    'node_modules/@threadplane/react/src/use-agent.js',
    'node_modules/@threadplane/angular/fesm2022/threadplane-angular.mjs',
  ])
    assert.ok(
      inputs.includes(required),
      'Installed implementation required: ' + required
    );
  for (const path of inputs) {
    assert.doesNotMatch(path, /(?:^|\/)libs\//, 'No workspace source aliases');
    assert.doesNotMatch(
      path,
      /node_modules\/@threadplane\/a2ui\//,
      'Protocol imports are type-only'
    );
    assert.doesNotMatch(
      path,
      /(?:\/markdown\/|@cacheplane\/|@json-render\/|@threadplane\/(?:ag-ui|langgraph|render|chat|debug)\/)/,
      'Unrelated runtime feature input'
    );
  }
}
export function requestPolicy(origin, limit = 16) {
  assert.equal(new URL(origin).protocol, 'http:', 'Owned HTTP origin required');
  assert.equal(
    new URL(origin).hostname,
    '127.0.0.1',
    'Owned loopback origin required'
  );
  assert.ok(Number.isInteger(limit) && limit > 0);
  let count = 0;
  return (url, method) =>
    ++count <= limit && method === 'GET' && new URL(url).origin === origin;
}
export function assertOwnerAccounting(evidence) {
  assert.equal(
    evidence.owners[evidence.selected]?.id,
    evidence.selected,
    'Selected owner identity required'
  );
  evidence.owners.forEach((owner, id) => {
    assert.equal(owner.id, id);
    assert.ok(
      Number.isInteger(owner.apply) && owner.apply >= 0,
      'Nonnegative command count'
    );
    assert.ok(
      Number.isInteger(owner.dispose) &&
        owner.dispose >= 0 &&
        owner.dispose <= 1,
      'Single caller disposal'
    );
    for (const framework of ['react', 'angular']) {
      const counts = owner[framework];
      for (const key of [
        'registrations',
        'cleanups',
        'outstanding',
        'notifications',
      ])
        assert.ok(
          Number.isInteger(counts[key]) && counts[key] >= 0,
          'Nonnegative integer observer counter: ' + key
        );
      assert.equal(
        counts.registrations - counts.cleanups,
        counts.outstanding,
        'Independent cleanup handles'
      );
      assert.ok(counts.outstanding >= 0 && counts.outstanding <= 1);
      if (id !== evidence.selected)
        assert.equal(
          counts.outstanding,
          0,
          'Previous owner observation released'
        );
    }
  });
}

// Assertions shared by the real browser run and focused mutation tests. The
// browser separately reads actual native DOM; this validates owner transitions.
export function assertSurfaceTransition(before, evidence, action) {
  const owner = evidence.owners[evidence.selected];
  const values = {
    'Commit root': 'staged',
    Update: 'updated',
    Recreate: 'recreated',
    'Commit new': 'second',
    'Commit third': 'third',
    'Update absent React': 'absent-react',
    'Update absent Angular': 'absent-angular',
  };
  if (action === 'Stage') {
    assert.deepEqual(evidence.snapshot, before.snapshot);
    assert.equal(owner.apply, 2);
  }
  if (action in values) {
    assert.equal(evidence.snapshot.surfaces.length, 1);
    assert.equal(evidence.snapshot.surfaces[0].dataModel.value, values[action]);
  }
  if (action === 'Delete') assert.deepEqual(evidence.snapshot.surfaces, []);
  if (action.startsWith('Switch')) {
    assert.equal(evidence.selected, before.selected + 1);
    assert.deepEqual(evidence.snapshot.surfaces, []);
    assert.equal(evidence.owners[before.selected].dispose, 0);
    assert.equal(owner.apply, 0);
    assert.equal(owner.dispose, 0);
  }
  if (action === 'Apply old' || action === 'Apply second old') {
    assert.deepEqual(evidence.snapshot, before.snapshot);
    assert.deepEqual(owner.react, before.owners[evidence.selected].react);
    assert.deepEqual(owner.angular, before.owners[evidence.selected].angular);
    assert.equal(
      evidence.owners[evidence.selected - 1].snapshot.surfaces[0].dataModel
        .value,
      action === 'Apply old' ? 'old-alive' : 'second-old-alive'
    );
  }
  return action in values || action === 'Delete';
}

export function buildA2uiPresentation(consumer, expected) {
  const sourceFiles = [
    'state.ts',
    'browser.tsx',
    'angular.ts',
    'installed-types.ts',
  ];
  for (const file of sourceFiles)
    cpSync(
      join(root, 'fixtures/react-parity/a2ui-surfaces', file),
      join(consumer, file)
    );
  writeFileSync(join(consumer, 'presentation.html'), shell);
  const { workspace, typescript } = presentationConfiguration();
  const options = workspace.projects.presentation.architect.build.options;
  options.browser = 'browser.tsx';
  options.optimization = false;
  options.define = { 'process.env.NODE_ENV': '"development"' };
  typescript.files = ['browser.tsx', 'installed-types.ts'];
  writeJson(join(consumer, 'angular.json'), workspace);
  writeJson(join(consumer, 'tsconfig.presentation.json'), typescript);
  const types = checkTypes(consumer, 'tsconfig.presentation.json');
  assertInstalledInputs(
    consumer,
    types.map((record) => record.path),
    expected
  );
  for (const path of [
    'node_modules/@threadplane/content/src/a2ui/types.d.ts',
    'node_modules/@threadplane/a2ui/src/index.d.ts',
  ])
    assert.ok(
      types.some((record) => record.path === path),
      'Strict declaration compilation reaches ' + path
    );
  console.log(
    runConsumer(
      process.execPath,
      ['node_modules/@angular/cli/bin/ng.js', 'build', 'presentation'],
      consumer
    )
  );
  const stats = json(join(consumer, 'presentation-output/stats.json'));
  const inputs = Object.keys(stats.inputs);
  assertInstalledInputs(consumer, inputs, expected);
  assertFeatureInputs(inputs);
  assert.ok(
    inputs.some((path) => path.endsWith('/react.development.js')),
    'Development React build required'
  );
  assert.ok(
    inputs.some((path) => path.endsWith('/react-dom-client.development.js')),
    'Development React DOM build required'
  );
  const outputs = fileHashes(join(consumer, 'presentation-output')).map(
    (record) => ({ ...record, path: 'presentation-output/' + record.path })
  );
  return {
    types,
    inputs,
    outputs,
    inputHashes: inputs.map((path) => ({
      path,
      sha256: sha256(readFileSync(resolve(consumer, path))),
    })),
    files: [
      ...sourceFiles,
      'presentation.html',
      'angular.json',
      'tsconfig.presentation.json',
    ].map((path) => ({
      path,
      sha256: sha256(readFileSync(join(consumer, path))),
    })),
    shell: 'presentation-output/browser/index.html',
    assets: outputs.filter(
      (record) =>
        record.path.startsWith('presentation-output/browser/') &&
        !record.path.endsWith('/index.html')
    ),
  };
}

export async function verifyA2uiBrowser(browser, url, { screenshot } = {}) {
  const page = await browser.newPage();
  const problems = [],
    rejected = [],
    requests = [],
    steps = [];
  const allow = requestPolicy(url);
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()))
      problems.push(message.text());
  });
  await page.route('**/*', (route) => {
    const request = route.request();
    requests.push({ url: request.url(), method: request.method() });
    if (!allow(request.url(), request.method())) {
      rejected.push(request.url());
      return route.abort();
    }
    return route.continue();
  });
  const read = () => page.evaluate(() => window.__a2ui());
  const settle = () =>
    page.waitForFunction(
      () =>
        window.__a2ui?.().ready &&
        !window.__a2ui().busy &&
        window.__a2ui().sameReference
    );
  const dom = async (evidence) => {
    for (const framework of ['react', 'angular']) {
      const panel = page.getByRole('region', {
        name:
          (framework === 'react' ? 'React' : 'Angular') + ' A2UI observation',
      });
      assert.equal(await panel.count(), evidence.mounted[framework] ? 1 : 0);
      if (evidence.mounted[framework])
        assert.deepEqual(
          JSON.parse(await panel.locator('pre').textContent()),
          evidence.snapshot,
          framework + ' actual DOM snapshot'
        );
    }
  };
  try {
    await page.goto(url + '/presentation');
    await settle();
    await page.waitForFunction(
      () =>
        window.__a2ui().owners[0].react.registrations >= 2 &&
        window.__a2ui().owners[0].react.cleanups >= 1
    );
    let evidence = await read();
    assertOwnerAccounting(evidence);
    await dom(evidence);
    assert.equal(evidence.owners[0].apply, 0);
    assert.equal(evidence.owners[0].dispose, 0);
    assert.deepEqual(evidence.snapshot.surfaces, []);
    for (const framework of ['react', 'angular']) {
      assert.equal(evidence.owners[0][framework].notifications, 0);
      assert.equal(evidence.owners[0][framework].outstanding, 1);
    }
    const replay = evidence.owners[0].react;
    steps.push({ action: 'Initial development replay', ...evidence });
    for (const [index, action] of sequence.entries()) {
      const before = await read();
      await page.getByRole('button', { name: action, exact: true }).click();
      await page.waitForFunction(
        (step) => window.__a2ui().step === step,
        index + 1
      );
      await settle();
      evidence = await read();
      assertOwnerAccounting(evidence);
      await dom(evidence);
      assert.equal(evidence.stableRead, true);
      assert.equal(evidence.retainedStable, true);
      assert.equal(evidence.frozenSnapshot, true);
      const owner = evidence.owners[evidence.selected],
        prior = before.owners[before.selected];
      const publishes = assertSurfaceTransition(before, evidence, action);
      if (
        [
          'Remove React',
          'Mount React',
          'Remove Angular',
          'Mount Angular',
          'Dispose',
        ].includes(action)
      ) {
        assert.equal(owner.apply, prior.apply);
        assert.deepEqual(evidence.snapshot, before.snapshot);
        assert.equal(owner.dispose, action === 'Dispose' ? 1 : 0);
      }
      if (action === 'Try disposed') {
        assert.match(evidence.error, /disposed/i);
        assert.deepEqual(evidence.snapshot, before.snapshot);
      }
      for (const framework of ['react', 'angular']) {
        assert.equal(
          owner[framework].outstanding,
          evidence.mounted[framework] ? 1 : 0
        );
        if (evidence.selected === before.selected) {
          assert.equal(
            owner[framework].notifications - prior[framework].notifications,
            publishes && before.mounted[framework] ? 1 : 0,
            action + ' ' + framework + ' notifications'
          );
        }
      }
      if (action === 'Teardown')
        for (const generation of evidence.owners) {
          assert.equal(generation.dispose, 1);
          assert.equal(generation.react.outstanding, 0);
          assert.equal(generation.angular.outstanding, 0);
        }
      steps.push({ action, ...evidence });
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth
        ),
        true,
        'Raw fixture data must stay within the page width'
      );
      if (screenshot && action === 'Update')
        await page.screenshot({ path: screenshot, fullPage: true });
    }
    assert.deepEqual(problems, []);
    assert.deepEqual(rejected, []);
    assert.ok(requests.length <= 16);
    return { replay, requests, rejected, problems, steps };
  } finally {
    await page.close();
  }
}

// launch is the shared owned-browser test/evidence seam. The default launches
// actual Playwright Chromium; the shared finally always awaits its close.
export async function verifyA2uiSurfaces({ retain, launch } = {}) {
  const temporary = retain
    ? resolve(retain)
    : mkdtempSync(join(tmpdir(), 'owned-a2ui-'));
  if (retain) {
    assert.equal(existsSync(temporary), false, 'Retain requires NEW_DIRECTORY');
    mkdirSync(temporary);
  }
  try {
    const tarballs = packLocalArtifacts(
      root,
      temporary,
      ['core', 'content', 'react', 'angular', 'a2ui'],
      { optionalPeers: ['a2ui'] }
    );
    assert.deepEqual(
      readFileSync(join(temporary, 'packed-a2ui/package/README.md')),
      readFileSync(join(root, 'libs/a2ui/README.md')),
      'Actual packed protocol README equals source bytes'
    );
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
      { seeds: a2uiSurfacesPresentationSeeds, profile: 'a2ui-surfaces' }
    );
    for (const [name, files] of Object.entries(expected))
      assertArtifactFiles(join(consumer, 'node_modules', name), files);
    const presentation = buildA2uiPresentation(consumer, expected);
    const frozen = presentation.outputs.map((record) => ({
      ...record,
      path: 'consumer/' + record.path,
    }));
    const sources = retainMarkdownSources(root, temporary, [
      'libs/a2ui/project.json',
      'libs/a2ui/README.md',
      ...[
        'verify-a2ui-surfaces.mjs',
        'verify-a2ui-surfaces.spec.mjs',
        'verify-markdown.mjs',
        'verify-packages.mjs',
        'markdown-presentation-build.mjs',
        'verify-langgraph-candidate.mjs',
        'langgraph-candidate-package.mjs',
        'ag-ui-candidate-package.mjs',
      ].map((file) => 'scripts/react-parity/' + file),
      ...[
        'state.ts',
        'browser.tsx',
        'angular.ts',
        'installed-types.ts',
        'README.md',
      ].map((file) => 'fixtures/react-parity/a2ui-surfaces/' + file),
    ]);
    const provenance = {
      rootLockSha256,
      installation,
      expected,
      presentation,
      frozen,
      sources,
      node: process.version,
    };
    writeJson(join(temporary, 'provenance.json'), provenance);
    const assets = readPresentation(temporary, provenance);
    const result = await verifyMarkdownBrowser('', {
      launch,
      presentation: assets,
      check: (browser, url) =>
        verifyA2uiBrowser(browser, url, {
          screenshot: join(temporary, 'native-updated.png'),
        }),
    });
    for (const [name, files] of Object.entries(expected))
      assertArtifactFiles(join(consumer, 'node_modules', name), files);
    assert.equal(
      sha256(readFileSync(join(root, 'package-lock.json'))),
      rootLockSha256
    );
    writeJson(join(temporary, 'browser-result.json'), result);
    console.log('Installed A2UI observation verified: ' + temporary);
    return { temporary: realpathSync(temporary), provenance, result };
  } finally {
    if (!retain) rmSync(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.ok(
    process.argv.length === 2 ||
      (process.argv.length === 4 && process.argv[2] === '--retain'),
    'Usage: verify-a2ui-surfaces.mjs [--retain NEW_DIRECTORY]'
  );
  await verifyA2uiSurfaces({ retain: process.argv[3] });
}
