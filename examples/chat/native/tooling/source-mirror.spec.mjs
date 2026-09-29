import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync,
  symlinkSync,
  existsSync,
  statSync,
  watch,
  realpathSync,
  utimesSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { inputFingerprint } from './consumer.mjs';
import { startSourceMirror, frozenInputFingerprint } from './source-mirror.mjs';

const native = 'examples/chat/native/';
const app = native + 'react/src/app.tsx';
const tokens = 'libs/design-tokens/src/lib/tokens.css';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await sleep(20);
  }
  assert.ok(check(), 'Expected filesystem state was not reached');
}
function put(root, path, value = 'original') {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
}
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'native-mirror-')));
  const root = join(base, 'root'),
    consumer = join(base, 'consumer');
  mkdirSync(root);
  mkdirSync(consumer);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const path of [
    app,
    native + 'shared/browser.ts',
    native + 'shared/browser-config.json',
    native + 'react/index.html',
    native + 'react/vite.config.mts',
    native + 'react/tsconfig.app.json',
    native + 'react/project.json',
    native + 'tooling/run.mjs',
    tokens,
    'libs/core/src/index.ts',
    'libs/content/project.json',
    'libs/react/src/index.ts',
    'libs/langgraph/src/runtime.ts',
    'scripts/react-parity/build.mjs',
    'package.json',
    'package-lock.json',
    'nx.json',
    'tsconfig.base.json',
  ])
    put(root, path);
  return { root, consumer, base };
}
async function start(t, fixture, options = {}) {
  const failures = [];
  const mirror = startSourceMirror({
    ...fixture,
    initialFrozen: frozenInputFingerprint(fixture.root),
    onFailure: (error) => failures.push(error),
    ...options,
  });
  t.after(() => mirror.close());
  await mirror.ready;
  return { mirror, failures };
}
const contents = (root, path) =>
  existsSync(join(root, path))
    ? readFileSync(join(root, path), 'utf8')
    : undefined;

test('copies only authored mutable files, preserving generated and installed files', async (t) => {
  const f = fixture(t);
  put(f.root, native + 'react/public/images/icon.svg', '<svg/>');
  put(f.root, native + 'shared/tokens.css', 'must not replace foundation');
  for (const path of [
    'react/src/.env',
    'shared/.local.env',
    'react/public/private.pem',
    'react/src/node_modules/no.ts',
    'react/src/dist/no.ts',
  ])
    put(f.root, native + path, 'secret');
  put(f.consumer, 'shared/browser-config.json', 'generated');
  put(f.consumer, 'node_modules/installed/index.js', 'installed');
  put(f.consumer, 'react/src/unrelated.txt', 'untouched');
  await start(t, f);
  assert.equal(contents(f.consumer, 'react/src/app.tsx'), 'original');
  assert.equal(contents(f.consumer, 'react/public/images/icon.svg'), '<svg/>');
  assert.equal(contents(f.consumer, 'shared/tokens.css'), 'original');
  assert.equal(contents(f.consumer, 'shared/browser-config.json'), 'generated');
  assert.equal(
    contents(f.consumer, 'node_modules/installed/index.js'),
    'installed'
  );
  assert.equal(contents(f.consumer, 'react/src/unrelated.txt'), 'untouched');
  for (const path of [
    'react/src/.env',
    'shared/.local.env',
    'react/public/private.pem',
    'react/src/node_modules/no.ts',
    'react/src/dist/no.ts',
    'react/vite.config.mts',
    'package.json',
  ])
    assert.equal(contents(f.consumer, path), undefined, path);
});

test('Angular mirror selects its mutable roots and freezes Angular configuration and binding', async (t) => {
  const f = fixture(t);
  for (const path of [
    'angular/src/app.component.ts',
    'angular/src/app.html',
    'angular/src/app.css',
    'angular/angular.json',
    'angular/tsconfig.app.json',
  ])
    put(f.root, native + path);
  put(f.root, 'libs/angular/src/index.ts');
  const initialFrozen = frozenInputFingerprint(f.root, 'angular');
  assert.equal(
    initialFrozen[native + 'angular/src/app.component.ts'],
    undefined
  );
  assert.ok(initialFrozen[native + 'angular/angular.json']);
  assert.ok(initialFrozen['libs/angular/src/index.ts']);
  assert.equal(initialFrozen['libs/react/src/index.ts'], undefined);
  const { failures } = await start(t, f, {
    framework: 'angular',
    initialFrozen,
  });
  assert.equal(
    contents(f.consumer, 'angular/src/app.component.ts'),
    'original'
  );
  assert.equal(contents(f.consumer, 'react/src/app.tsx'), undefined);
  put(f.root, native + 'angular/src/app.html', 'edited template');
  await until(
    () => contents(f.consumer, 'angular/src/app.html') === 'edited template'
  );
  put(f.root, native + 'angular/angular.json', 'frozen edit');
  await until(() => failures.length > 0);
  assert.match(
    failures[0].message,
    /Frozen development inputs changed.*restart/
  );
});

test('frozen fingerprint excludes explicit mutable source while full build fingerprint retains it', async (t) => {
  const f = fixture(t);
  const frozen = frozenInputFingerprint(f.root),
    full = inputFingerprint(f.root);
  for (const path of [
    app,
    native + 'shared/browser.ts',
    native + 'react/index.html',
    native + 'react/public/new.svg',
    tokens,
  ])
    put(f.root, path, 'changed');
  assert.deepEqual(frozenInputFingerprint(f.root), frozen);
  assert.notDeepEqual(inputFingerprint(f.root), full);
  for (const path of [
    'package-lock.json',
    'libs/core/src/new.ts',
    native + 'react/vite.config.mts',
    native + 'tooling/new.mjs',
    native + 'shared/browser-config.json',
    'tsconfig.new.json',
  ]) {
    const before = frozenInputFingerprint(f.root);
    put(f.root, path, 'frozen change');
    assert.notDeepEqual(frozenInputFingerprint(f.root), before, path);
    const added = frozenInputFingerprint(f.root);
    rmSync(join(f.root, path));
    assert.notDeepEqual(
      frozenInputFingerprint(f.root),
      added,
      path + ' deletion'
    );
  }
});

test('real watches converge across add/change/delete, atomic save, nested additions, bursts and removed source roots', async (t) => {
  const events = [];
  const f = fixture(t),
    { failures } = await start(t, f, {
      watchPath: (path, callback) =>
        watch(path, (...args) => {
          events.push(path);
          callback(...args);
        }),
    });
  events.length = 0;
  put(f.root, app, 'changed');
  await until(() => contents(f.consumer, 'react/src/app.tsx') === 'changed');
  assert.ok(
    events.length > 0,
    'A real filesystem notification drove the source edit'
  );
  put(f.root, native + 'react/src/save.tsx', 'atomic');
  renameSync(join(f.root, native + 'react/src/save.tsx'), join(f.root, app));
  await until(() => contents(f.consumer, 'react/src/app.tsx') === 'atomic');
  for (let i = 0; i < 40; i++)
    put(f.root, native + 'react/src/nested/deeper/new.ts', String(i));
  await until(
    () => contents(f.consumer, 'react/src/nested/deeper/new.ts') === '39'
  );
  rmSync(join(f.root, native + 'react/src/nested'), { recursive: true });
  await until(
    () => !existsSync(join(f.consumer, 'react/src/nested/deeper/new.ts'))
  );
  rmSync(join(f.root, native + 'react/src'), { recursive: true });
  await until(() => !existsSync(join(f.consumer, 'react/src/app.tsx')));
  put(f.root, app, 'recreated');
  await until(() => contents(f.consumer, 'react/src/app.tsx') === 'recreated');
  put(f.root, tokens, 'new plain CSS');
  await until(
    () => contents(f.consumer, 'shared/tokens.css') === 'new plain CSS'
  );
  assert.deepEqual(failures, []);
});

test('bounded safety scans recover a dropped structural notification', async (t) => {
  const f = fixture(t);
  await start(t, f, {
    watchPath: () => {
      const watcher = new EventEmitter();
      watcher.close = () => {};
      return watcher;
    },
  });
  put(f.root, native + 'react/src/new/deep/file.ts', 'missed notification');
  await until(
    () =>
      contents(f.consumer, 'react/src/new/deep/file.ts') ===
      'missed notification'
  );
});

test('close stops safety scans and all later reads or copies', async (t) => {
  const f = fixture(t);
  let reads = 0;
  const { mirror } = await start(t, f, {
    readSource: async (path) => {
      reads++;
      return readFile(path);
    },
  });
  await mirror.close();
  const before = reads;
  put(f.root, app, 'after close');
  await sleep(2100);
  assert.equal(reads, before);
  assert.equal(contents(f.consumer, 'react/src/app.tsx'), 'original');
});

test('unchanged files are not recopied on unrelated source changes', async (t) => {
  const f = fixture(t);
  await start(t, f);
  const originalTime = statSync(join(f.consumer, 'react/src/app.tsx')).mtimeMs;
  put(f.root, native + 'shared/new.ts', 'new shared');
  await until(() => contents(f.consumer, 'shared/new.ts') === 'new shared');
  assert.equal(
    statSync(join(f.consumer, 'react/src/app.tsx')).mtimeMs,
    originalTime
  );
});

test('registration race is reconciled again before readiness, without needing a notification', async (t) => {
  const f = fixture(t);
  let edited = false;
  await start(t, f, {
    watchPath: (path, callback) => {
      const watcher = watch(path, callback);
      if (!edited) {
        edited = true;
        put(f.root, app, 'during registration');
      }
      return watcher;
    },
  });
  assert.equal(
    contents(f.consumer, 'react/src/app.tsx'),
    'during registration'
  );
});

test('change during reconciliation repeats serially and copied hashes describe copied bytes', async (t) => {
  const f = fixture(t);
  let release,
    blocked = false,
    active = 0,
    peak = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { mirror } = await start(t, f, {
    readSource: async (path) => {
      active++;
      peak = Math.max(peak, active);
      const bytes = await readFile(path);
      if (path === join(f.root, app) && bytes.toString() === 'held') {
        blocked = true;
        await gate;
      }
      active--;
      return bytes;
    },
  });
  put(f.root, app, 'held');
  await until(() => blocked);
  put(f.root, app, 'latest');
  release();
  await until(() => contents(f.consumer, 'react/src/app.tsx') === 'latest');
  assert.equal(peak, 1);
  assert.equal(
    mirror.snapshot()['react/src/app.tsx'],
    createHash('sha256').update('latest').digest('hex')
  );
});

test('initial ownership removes a file deleted during preparation without deleting unrelated files', async (t) => {
  const f = fixture(t);
  put(f.consumer, 'react/src/removed.ts', 'old');
  put(f.consumer, 'react/src/unrelated.ts', 'keep');
  await start(t, f, {
    initialFiles: {
      'react/src/removed.ts': 'old-hash',
      'shared/browser-config.json': 'generated-hash',
    },
  });
  assert.equal(contents(f.consumer, 'react/src/removed.ts'), undefined);
  assert.equal(contents(f.consumer, 'react/src/unrelated.ts'), 'keep');
});

for (const state of ['missing', 'changed', 'same', 'symlink'])
  test(`initial ownership verifies ${state} destination bytes before trusting a recorded hash`, async (t) => {
    const f = fixture(t),
      path = 'react/src/app.tsx';
    const hash = createHash('sha256').update('original').digest('hex');
    if (state !== 'missing')
      put(f.consumer, path, state === 'same' ? 'original' : 'tampered');
    const originalTime =
      state === 'same' ? statSync(join(f.consumer, path)).mtimeMs : undefined;
    const outside = join(f.base, 'outside.ts');
    writeFileSync(outside, 'outside');
    if (state === 'symlink') {
      rmSync(join(f.consumer, path));
      symlinkSync(outside, join(f.consumer, path));
    }
    const mirror = startSourceMirror({
      ...f,
      initialFrozen: frozenInputFingerprint(f.root),
      initialFiles: { [path]: hash },
    });
    t.after(() => mirror.close());
    if (state === 'symlink') await assert.rejects(mirror.ready, /link/i);
    else {
      await mirror.ready;
      assert.equal(contents(f.consumer, path), 'original');
      if (state === 'same')
        assert.equal(statSync(join(f.consumer, path)).mtimeMs, originalTime);
    }
    assert.equal(readFileSync(outside, 'utf8'), 'outside');
  });

for (const path of [
  'package-lock.json',
  'libs/core/src/index.ts',
  'libs/react/src/new.ts',
])
  test(`preparation change to ${path} rejects readiness even without watch events`, async (t) => {
    const f = fixture(t);
    const initialFrozen = frozenInputFingerprint(f.root),
      watchers = [],
      failures = [];
    put(f.root, path, 'during preparation');
    const mirror = startSourceMirror({
      ...f,
      initialFrozen,
      onFailure: (error) => failures.push(error),
      watchPath: () => {
        const watcher = new EventEmitter();
        watcher.closed = false;
        watcher.close = () => {
          watcher.closed = true;
        };
        watchers.push(watcher);
        return watcher;
      },
    });
    t.after(() => mirror.close());
    await assert.rejects(mirror.ready, /restart/i);
    assert.equal(failures.length, 1);
    assert.ok(watchers.every((w) => w.closed));
  });

test('frozen additions fail an active generation and close its watchers', async (t) => {
  const f = fixture(t),
    watchers = [];
  const { failures, mirror } = await start(t, f, {
    watchPath: (path, callback) => {
      const watcher = watch(path, callback);
      let closed = false;
      const close = watcher.close.bind(watcher);
      watcher.close = () => {
        closed = true;
        close();
      };
      watchers.push(() => closed);
      return watcher;
    },
  });
  put(f.root, 'libs/core/src/added.ts', 'frozen');
  await until(() => failures.length === 1);
  assert.match(failures[0].message, /restart/i);
  assert.ok(watchers.every((closed) => closed()));
  await mirror.close();
  await mirror.close();
});

test('frozen deletion fails an active generation with restart guidance', async (t) => {
  const f = fixture(t),
    { failures } = await start(t, f);
  rmSync(join(f.root, 'package-lock.json'));
  await until(() => failures.length === 1);
  assert.match(failures[0].message, /restart/i);
});

test('source removal between enumeration and watch registration reconciles normally', async (t) => {
  const f = fixture(t);
  let removed = false;
  const { failures } = await start(t, f, {
    watchPath: (path, callback) => {
      if (!removed && path === join(f.root, app)) {
        removed = true;
        rmSync(path);
      }
      return watch(path, callback);
    },
  });
  assert.equal(contents(f.consumer, 'react/src/app.tsx'), undefined);
  assert.deepEqual(failures, []);
});

test('source removal during final watch registration repeats before readiness', async (t) => {
  const f = fixture(t);
  const added = native + 'react/src/added.tsx';
  let created = false,
    removed = false,
    appReads = 0;
  const { failures, mirror } = await start(t, f, {
    readSource: async (path) => {
      const bytes = await readFile(path);
      if (path === join(f.root, app)) {
        appReads++;
        if (!created) {
          created = true;
          put(f.root, added, 'transient source');
        }
      }
      return bytes;
    },
    watchPath: (path, callback) => {
      if (!removed && path === join(f.root, added)) {
        removed = true;
        rmSync(path);
      }
      return watch(path, callback);
    },
  });
  assert.ok(
    created && removed,
    'The source disappeared during final registration'
  );
  assert.ok(
    appReads >= 2,
    'A complete reconciliation followed the disappearance'
  );
  assert.equal(contents(f.consumer, 'react/src/app.tsx'), 'original');
  assert.equal(contents(f.consumer, 'react/src/added.tsx'), undefined);
  assert.equal(mirror.snapshot()['react/src/added.tsx'], undefined);
  assert.deepEqual(failures, []);
});

test('frozen removal between enumeration and watch registration keeps restart guidance', async (t) => {
  const f = fixture(t);
  let removed = false;
  const mirror = startSourceMirror({
    ...f,
    initialFrozen: frozenInputFingerprint(f.root),
    watchPath: (path, callback) => {
      if (!removed && path === join(f.root, 'package-lock.json')) {
        removed = true;
        rmSync(path);
      }
      return watch(path, callback);
    },
  });
  t.after(() => mirror.close());
  await assert.rejects(mirror.ready, /restart/i);
});

for (const mode of [
  'source',
  'source-ancestor',
  'destination',
  'intersection',
  'ownership-escape',
])
  test(`rejects ${mode} escape without writes outside consumer`, async (t) => {
    const f = fixture(t);
    const initialFrozen = frozenInputFingerprint(f.root),
      outside = join(f.base, 'outside');
    mkdirSync(outside);
    put(outside, 'app.tsx', 'untouched');
    let consumer = f.consumer,
      initialFiles;
    if (mode === 'source') {
      rmSync(join(f.root, app));
      symlinkSync(join(outside, 'app.tsx'), join(f.root, app));
    }
    if (mode === 'source-ancestor') {
      rmSync(join(f.root, native + 'react/src'), { recursive: true });
      symlinkSync(outside, join(f.root, native + 'react/src'));
    }
    if (mode === 'destination') {
      mkdirSync(join(consumer, 'react'));
      symlinkSync(outside, join(consumer, 'react/src'));
    }
    if (mode === 'intersection') consumer = join(f.root, native + 'react/src');
    if (mode === 'ownership-escape')
      initialFiles = { '../../outside/app.tsx': 'hash' };
    const failures = [];
    const mirror = startSourceMirror({
      ...f,
      consumer,
      initialFrozen,
      initialFiles,
      onFailure: (error) => failures.push(error),
    });
    t.after(() => mirror.close());
    await assert.rejects(mirror.ready, /link|overlap|owned|escape/i);
    assert.equal(contents(outside, 'app.tsx'), 'untouched');
    assert.equal(failures.length, 1);
  });

for (const late of [false, true])
  test(`${
    late ? 'late' : 'startup'
  } watcher error reports once and closes every owned watcher`, async (t) => {
    const f = fixture(t);
    const watchers = [],
      failures = [];
    const mirror = startSourceMirror({
      ...f,
      initialFrozen: frozenInputFingerprint(f.root),
      onFailure: (error) => failures.push(error),
      watchPath: () => {
        if (!late && watchers.length === 2)
          throw new Error('watch startup failed');
        const watcher = new EventEmitter();
        watcher.closed = false;
        watcher.close = () => {
          watcher.closed = true;
        };
        watchers.push(watcher);
        return watcher;
      },
    });
    t.after(() => mirror.close());
    if (late) {
      await mirror.ready;
      watchers[0].emit('error', new Error('watch late failed'));
    } else await assert.rejects(mirror.ready, /watch startup failed/);
    await until(() => failures.length === 1);
    assert.ok(watchers.every((watcher) => watcher.closed));
    await mirror.close();
    await mirror.close();
  });

test('final frozen validation catches a lock edit during the last source read even without an event', async (t) => {
  const f = fixture(t),
    initialFrozen = frozenInputFingerprint(f.root),
    failures = [],
    watchers = [];
  let reads = 0;
  const mirror = startSourceMirror({
    ...f,
    initialFrozen,
    onFailure: (error) => failures.push(error),
    watchPath: () => {
      const watcher = new EventEmitter();
      watcher.closed = false;
      watcher.close = () => {
        watcher.closed = true;
      };
      watchers.push(watcher);
      return watcher;
    },
    readSource: async (path) => {
      const bytes = await readFile(path);
      if (path.endsWith('/shared/browser.ts') && ++reads === 1)
        put(f.root, 'package-lock.json', 'during final read');
      return bytes;
    },
  });
  t.after(() => mirror.close());
  await assert.rejects(mirror.ready, /restart/i);
  assert.equal(failures.length, 1);
  assert.ok(watchers.every((watcher) => watcher.closed));
});

test('source edits and additions during the last read are copied before readiness even without an event', async (t) => {
  const f = fixture(t);
  let reads = 0;
  await start(t, f, {
    watchPath: () => {
      const watcher = new EventEmitter();
      watcher.close = () => {};
      return watcher;
    },
    readSource: async (path) => {
      const bytes = await readFile(path);
      if (path.endsWith('/shared/browser.ts') && ++reads === 1) {
        put(f.root, app, 'final edit');
        put(f.root, native + 'react/src/new.ts', 'final addition');
      }
      return bytes;
    },
  });
  assert.equal(contents(f.consumer, 'react/src/app.tsx'), 'final edit');
  assert.equal(contents(f.consumer, 'react/src/new.ts'), 'final addition');
});

test('same-size source and frozen edits with restored mtime are detected from bytes', async (t) => {
  const f = fixture(t),
    { failures } = await start(t, f);
  const sourceTime = statSync(join(f.root, app));
  put(f.root, app, 'newbytes');
  utimesSync(join(f.root, app), sourceTime.atime, sourceTime.mtime);
  await until(() => contents(f.consumer, 'react/src/app.tsx') === 'newbytes');
  const frozenTime = statSync(join(f.root, 'package-lock.json'));
  put(f.root, 'package-lock.json', 'newbytes');
  utimesSync(
    join(f.root, 'package-lock.json'),
    frozenTime.atime,
    frozenTime.mtime
  );
  await until(() => failures.length === 1);
  assert.match(failures[0].message, /restart/i);
});

test('hidden library build configuration is frozen, while editor temp files stay outside mirror inputs', (t) => {
  const f = fixture(t),
    before = frozenInputFingerprint(f.root);
  put(f.root, native + 'react/src/.app.tsx.swp', 'editor');
  assert.deepEqual(frozenInputFingerprint(f.root), before);
  put(f.root, 'libs/react/.swcrc', 'build configuration');
  assert.notDeepEqual(frozenInputFingerprint(f.root), before);
});

test('authored editor backups and swaps do not enter the frozen fingerprint', (t) => {
  const f = fixture(t),
    before = frozenInputFingerprint(f.root);
  for (const name of ['app.tsx~', 'app.tsx.swp', '#app.tsx#']) {
    put(f.root, native + 'react/src/' + name, 'editor recovery data');
    assert.deepEqual(frozenInputFingerprint(f.root), before, name);
  }
  put(f.root, 'libs/react/.swcrc', 'library build configuration');
  assert.notDeepEqual(frozenInputFingerprint(f.root), before);
});

test('creating and deleting editor backups preserves live mirroring', async (t) => {
  const f = fixture(t),
    { failures } = await start(t, f);
  const backups = ['app.tsx~', 'app.tsx.swp', '#app.tsx#'];
  for (const name of backups)
    put(f.root, native + 'react/src/' + name, 'editor recovery data');
  put(f.root, app, 'edited with backups');
  await until(
    () => contents(f.consumer, 'react/src/app.tsx') === 'edited with backups'
  );
  for (const name of backups) {
    assert.equal(contents(f.consumer, 'react/src/' + name), undefined);
    rmSync(join(f.root, native + 'react/src/' + name));
  }
  put(f.root, app, 'edited after backups');
  await until(
    () => contents(f.consumer, 'react/src/app.tsx') === 'edited after backups'
  );
  assert.deepEqual(failures, []);
});

test('close during a held read waits and prevents any later consumer writes', async (t) => {
  const f = fixture(t);
  let release,
    entered = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  t.after(release);
  const mirror = startSourceMirror({
    ...f,
    initialFrozen: frozenInputFingerprint(f.root),
    readSource: async (path) => {
      const bytes = await readFile(path);
      entered = true;
      await gate;
      return bytes;
    },
  });
  const rejected = assert.rejects(mirror.ready, /closed/i);
  await until(() => entered);
  const closed = mirror.close();
  release();
  await closed;
  await rejected;
  await mirror.close();
  assert.equal(contents(f.consumer, 'react/src/app.tsx'), undefined);
});

test('late source symlink fails once, closes watches and never copies its target', async (t) => {
  const f = fixture(t),
    { failures } = await start(t, f);
  const outside = join(f.base, 'outside.ts');
  writeFileSync(outside, 'private');
  rmSync(join(f.root, app));
  symlinkSync(outside, join(f.root, app));
  await until(() => failures.length === 1);
  assert.match(failures[0].message, /link/i);
  assert.notEqual(contents(f.consumer, 'react/src/app.tsx'), 'private');
});

test('parent source symlink introduced during an async read fails before copying outside bytes', async (t) => {
  const f = fixture(t),
    failures = [],
    watchers = [];
  const outside = join(f.base, 'outside-source');
  put(outside, 'app.tsx', 'outside-private-bytes');
  put(f.consumer, 'react/src/app.tsx', 'previous-safe-copy');
  let replaced = false,
    captured;
  const mirror = startSourceMirror({
    ...f,
    initialFrozen: frozenInputFingerprint(f.root),
    onFailure: (error) => failures.push(error),
    readSource: async (path) => {
      if (!replaced && path === join(f.root, app)) {
        replaced = true;
        const directory = join(f.root, native + 'react/src');
        rmSync(directory, { recursive: true });
        symlinkSync(outside, directory, 'dir');
        captured = await readFile(path);
        return captured;
      }
      return readFile(path);
    },
    watchPath: (path, callback) => {
      const watcher = watch(path, callback),
        close = watcher.close.bind(watcher);
      let closed = false;
      watcher.close = () => {
        closed = true;
        close();
      };
      watchers.push(() => closed);
      return watcher;
    },
  });
  t.after(() => mirror.close());
  await assert.rejects(mirror.ready, /link/i);
  assert.equal(
    captured.toString(),
    'outside-private-bytes',
    'The read crossed the replaced parent'
  );
  assert.equal(contents(f.consumer, 'react/src/app.tsx'), 'previous-safe-copy');
  assert.equal(contents(outside, 'app.tsx'), 'outside-private-bytes');
  assert.equal(failures.length, 1);
  assert.ok(watchers.every((closed) => closed()));
});
