import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  APPLICATIONS,
  checkBudgets,
  externalDependencies,
  initialScripts,
  pinnedVersions,
} from './initial-load.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function dist(t, files) {
  const directory = mkdtempSync(join(tmpdir(), 'footprint-spec-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), contents);
  }
  return directory;
}

test('initial JS is the entry scripts, module preloads and their static imports only', async (t) => {
  const directory = dist(t, {
    'index.html':
      '<html><head><link rel="modulepreload" href="shared.js"><link rel="stylesheet" href="styles.css"></head>' +
      '<body><script src="main.js" type="module"></script><script src="legacy.js" nomodule></script></body></html>',
    'main.js':
      'import "./shared.js"; import { a } from "./nested/a.js"; import("./lazy.js"); console.log(a, import.meta.url);',
    'shared.js': 'export const s = 1;',
    'nested/a.js': 'import "../shared.js"; export const a = 2;',
    'lazy.js': 'import "./only-lazy.js"; export const lazy = 3;',
    'only-lazy.js': 'export const x = 4;',
    'legacy.js': 'var legacy = 5;',
    'styles.css': 'body{}',
  });
  const result = await initialScripts(directory);
  assert.deepEqual(result.files.map((file) => file.path).sort(), [
    'main.js',
    'nested/a.js',
    'shared.js',
  ]);
  assert.equal(
    result.bytes,
    ['main.js', 'nested/a.js', 'shared.js']
      .map((path) => readFileSync(join(directory, path)).length)
      .reduce((a, b) => a + b, 0)
  );
  assert.ok(result.gzipBytes > 0);
});

test('Vite root-relative entry paths resolve inside the output directory', async (t) => {
  const directory = dist(t, {
    'index.html':
      '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
    'assets/index-abc.js': 'import "/assets/vendor-def.js";',
    'assets/vendor-def.js': 'export {};',
  });
  const result = await initialScripts(directory);
  assert.deepEqual(result.files.map((file) => file.path).sort(), [
    'assets/index-abc.js',
    'assets/vendor-def.js',
  ]);
});

test('a missing initial file or an output with no module script fails instead of measuring less', async (t) => {
  await assert.rejects(
    initialScripts(
      dist(t, {
        'index.html': '<script type="module" src="main.js"></script>',
        'main.js': 'import "./gone.js";',
      })
    ),
    /missing file: gone\.js/
  );
  await assert.rejects(
    initialScripts(dist(t, { 'index.html': '<body></body>' })),
    /no module script/
  );
});

test('budgets fail when exceeded, and suggest a lower budget when well under it', () => {
  const budgets = {
    angular: { initialBytes: 1000 },
    react: { initialBytes: 1000 },
  };
  assert.deepEqual(
    checkBudgets({ angular: { bytes: 1000 }, react: { bytes: 990 } }, budgets),
    {
      errors: [],
      notes: [],
    }
  );
  const over = checkBudgets({ angular: { bytes: 1001 } }, budgets);
  assert.match(
    over.errors[0],
    /angular: initial JS is 1001 bytes, over its 1000 byte budget by 1/
  );
  const under = checkBudgets({ react: { bytes: 800 } }, budgets);
  assert.deepEqual(under.errors, []);
  assert.match(
    under.notes[0],
    /react: 200 bytes under budget; lower initialBytes to about 816/
  );
  assert.throws(
    () => checkBudgets({ vue: { bytes: 1 } }, budgets),
    /no initialBytes for vue/
  );
});

test('installs pin the root lockfile and leave optional peers out', () => {
  const lock = {
    packages: {
      'node_modules/zod': { version: '4.1.0' },
      'node_modules/rxjs': { version: '7.8.2' },
    },
  };
  assert.deepEqual(pinnedVersions(lock, ['zod', 'rxjs', 'zod']), {
    rxjs: '7.8.2',
    zod: '4.1.0',
  });
  assert.throws(
    () => pinnedVersions(lock, ['missing']),
    /no version for missing/
  );
  assert.deepEqual(
    externalDependencies([
      {
        dependencies: { '@threadplane/core': '0.3.7', marked: '^16.0.0' },
        peerDependencies: {
          rxjs: '~7.8.0',
          katex: '*',
          '@threadplane/a2ui': '0.3.7',
        },
        peerDependenciesMeta: { katex: { optional: true } },
      },
    ]).sort(),
    ['marked', 'rxjs']
  );
});

test('the committed budgets cover every measured application', () => {
  const budgets = JSON.parse(readFileSync(join(here, 'budgets.json'), 'utf8'));
  assert.deepEqual(
    Object.keys(budgets).sort(),
    Object.keys(APPLICATIONS).sort()
  );
  for (const budget of Object.values(budgets))
    assert.ok(Number.isInteger(budget.initialBytes) && budget.initialBytes > 0);
});
