import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { buildInputRoots } from './build-workspace.mjs';
import { mirrorDestination, excludedSourcePath } from './source-policy.mjs';

const native = 'examples/chat/native/';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function stat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
function assertPath(root, path) {
  const local = relative(root, path);
  assert.ok(
    !isAbsolute(local) && !local.split(sep).includes('..'),
    `Path escapes owned root: ${path}`
  );
  let current = root;
  for (const part of ['', ...local.split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    assert.ok(
      !stat(current)?.isSymbolicLink(),
      `No source or destination links: ${current}`
    );
  }
}

function tree(root) {
  const files = new Map(),
    watchPaths = new Map();
  const addWatchPath = (path, info) =>
    watchPaths.set(path, `${info.dev}:${info.ino}`);
  function visit(path) {
    const local = relative(root, path).split(sep).join('/');
    if (excludedSourcePath(local)) return;
    const info = stat(path);
    if (!info) return;
    assert.ok(!info.isSymbolicLink(), `No source links: ${path}`);
    if (info.isDirectory()) {
      addWatchPath(path, info);
      let names;
      try {
        names = readdirSync(path);
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      for (const name of names.sort()) visit(join(path, name));
    } else {
      assert.ok(
        info.isFile(),
        `Only regular source files are supported: ${path}`
      );
      files.set(local, path);
      // Direct mutable/root-config watches cover immediate macOS edits using
      // kqueue. Library files use directory events plus the bounded safety scan
      // to avoid consuming one descriptor per installed-library source file.
      if (mirrorDestination(local) || !local.includes('/'))
        addWatchPath(path, info);
    }
  }
  // Foundation configuration is frozen; its plain CSS is the one mutable input.
  for (const local of new Set([
    ...buildInputRoots(root),
    'libs/design-tokens',
  ])) {
    let parent = dirname(join(root, local));
    while (parent === root || parent.startsWith(root + sep)) {
      assertPath(root, parent);
      const info = stat(parent);
      if (info?.isDirectory()) addWatchPath(parent, info);
      if (parent === root) break;
      parent = dirname(parent);
    }
    assertPath(root, join(root, local));
    visit(join(root, local));
  }
  return { files, watchPaths };
}
function frozen(files) {
  const result = {};
  for (const [local, path] of [...files].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (!mirrorDestination(local)) result[local] = digest(readFileSync(path));
  }
  return result;
}

// Capture BEFORE build/pack/install, and pass this exact value to the mirror.
// Fresh content hashes include additions/deletions, not just previously known files.
export function frozenInputFingerprint(root) {
  return frozen(tree(realpathSync(root)).files);
}
async function readSourceFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await file.readFile();
  } finally {
    await file.close();
  }
}
function ownedPath(path) {
  return (
    path === 'shared/tokens.css' || mirrorDestination(native + path) === path
  );
}

/** One consumer generation; no installation or process ownership.
 * initialFiles accepts copyApplication's copied map so preparation-time deletions
 * remain owned. Generated config and non-mirror paths are ignored.
 * The filesystem adapters permit coordinating I/O without a watcher framework.
 */
export function startSourceMirror({
  root,
  consumer,
  initialFrozen,
  initialFiles = {},
  onFailure,
  readSource = readSourceFile,
  watchPath = watch,
}) {
  const watchers = new Map(),
    owned = new Map(),
    retained = new Map();
  let closed = false,
    dirty = true,
    active,
    scheduled,
    safetyScan,
    readySettled = false;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  function stop() {
    closed = true;
    clearImmediate(scheduled);
    clearInterval(safetyScan);
    for (const { watcher } of watchers.values()) watcher.close();
    watchers.clear();
  }
  function fail(error) {
    if (closed) return;
    stop();
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    onFailure?.(error);
  }
  function changed() {
    if (closed) return;
    dirty = true;
    if (!active && !scheduled) scheduled = setImmediate(run);
  }
  function register(paths) {
    for (const [path, entry] of watchers) {
      if (paths.get(path) !== entry.identity) {
        entry.watcher.close();
        watchers.delete(path);
      }
    }
    for (const [path, identity] of paths) {
      if (watchers.has(path)) continue;
      let watcher;
      try {
        watcher = watchPath(path, changed);
      } catch (error) {
        // A save/delete may remove a just-enumerated path. The parent watch
        // remains registered; rescan instead of failing a mutable edit.
        if (error.code !== 'ENOENT') throw error;
        dirty = true;
        continue;
      }
      watchers.set(path, { identity, watcher });
      watcher.on('error', fail);
    }
  }
  function checkFrozen(files) {
    const guidance =
      'Frozen development inputs changed; restart the native example to rebuild and reinstall';
    let current;
    try {
      current = frozen(files);
    } catch (error) {
      throw new Error(guidance, { cause: error });
    }
    assert.ok(isDeepStrictEqual(current, initialFrozen), guidance);
  }
  async function capture() {
    const scanned = tree(root);
    register(scanned.watchPaths);
    // Preparation is checked before the first copy and after its final read.
    // Active generations need one fresh frozen hash at the end of each pass.
    if (!readySettled) checkFrozen(scanned.files);
    const sources = new Map();
    for (const [local, path] of scanned.files) {
      const target = mirrorDestination(local);
      if (!target) continue;
      assertPath(root, path);
      try {
        sources.set(target, await readSource(path));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        dirty = true;
      }
      if (closed) return sources;
    }
    return sources;
  }
  function destination(path) {
    assert.ok(ownedPath(path), `Not an owned mirror path: ${path}`);
    const target = join(consumer, path);
    assertPath(consumer, target);
    return target;
  }
  function copy(path, bytes) {
    const target = destination(path);
    mkdirSync(dirname(target), { recursive: true });
    const temporary = join(dirname(target), `.mirror-${randomUUID()}`);
    try {
      writeFileSync(temporary, bytes, { flag: 'wx' });
      assertPath(consumer, target);
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  function apply(sources) {
    for (const [path, bytes] of sources) {
      if (retained.get(path)?.equals(bytes)) continue;
      // Initial hashes establish deletion ownership, not an attestation of the
      // current consumer. Validate its path and bytes before preserving a copy.
      const target = destination(path);
      const current = retained.has(path)
        ? retained.get(path)
        : stat(target)
        ? readFileSync(target)
        : undefined;
      const hash = digest(bytes);
      if (!current?.equals(bytes)) copy(path, bytes);
      owned.set(path, hash);
      retained.set(path, bytes);
    }
    for (const path of owned.keys()) {
      if (!sources.has(path)) {
        rmSync(destination(path), { force: true });
        owned.delete(path);
        retained.delete(path);
      }
    }
  }
  async function reconcile() {
    // At most eight passes per event-loop batch; sustained edits yield before
    // repeating. Exactly one pass runs at a time, including initial readiness.
    for (let pass = 0; pass < 8 && dirty && !closed; pass++) {
      dirty = false;
      const before = await capture();
      if (closed) return;
      // A parent directory can be replaced while source reads are awaiting I/O.
      // Validate the source tree again before any captured bytes reach consumer.
      const final = tree(root);
      apply(before);
      // The last source read is asynchronous: freeze validation must also run
      // after it. This final synchronous snapshot also catches missed source
      // edits/additions without opening another asynchronous readiness gap.
      register(final.watchPaths);
      const latest = new Map();
      for (const [local, path] of final.files) {
        const target = mirrorDestination(local);
        if (!target) continue;
        try {
          latest.set(target, readFileSync(path));
        } catch (error) {
          // A mutable file can disappear after enumeration, including while
          // its watch is registered. Reconcile again before accepting ready.
          if (error.code !== 'ENOENT') throw error;
          dirty = true;
        }
      }
      checkFrozen(final.files);
      if (!isDeepStrictEqual(retained, latest)) dirty = true;
    }
    if (!closed && !dirty && !readySettled) {
      readySettled = true;
      resolveReady();
    }
  }
  function run() {
    scheduled = undefined;
    if (closed) return;
    active = reconcile()
      .catch(fail)
      .finally(() => {
        active = undefined;
        if (dirty && !closed) scheduled = setImmediate(run);
      });
  }
  scheduled = setImmediate(() => {
    scheduled = undefined;
    try {
      assert.ok(
        initialFrozen && typeof initialFrozen === 'object',
        'A pre-preparation frozen fingerprint is required'
      );
      root = realpathSync(root);
      consumer = realpathSync(consumer);
      assert.ok(
        root !== consumer &&
          !root.startsWith(consumer + sep) &&
          !consumer.startsWith(root + sep),
        'Source root and owned consumer must not overlap'
      );
      for (const [path, hash] of Object.entries(initialFiles)) {
        assert.ok(
          !isAbsolute(path) &&
            !path.split(/[\\/]/).includes('..') &&
            !path.includes('\\'),
          `Not an owned mirror path: ${path}`
        );
        if (ownedPath(path)) owned.set(path, hash);
      }
      // fs.watch can drop/coalesce structural events, particularly while the
      // macOS FSEvents stream registers new directories. A bounded safety scan
      // uses the same serialized queue; notifications still provide fast edits.
      safetyScan = setInterval(changed, 2000);
      run();
    } catch (error) {
      fail(error);
    }
  });
  return {
    ready,
    snapshot: () => Object.fromEntries(owned),
    async close() {
      stop();
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error('Source mirror closed before readiness'));
      }
      await active;
    },
  };
}
