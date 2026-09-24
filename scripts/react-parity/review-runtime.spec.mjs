import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const script = resolve('scripts/react-parity/review-runtime.mjs');
function fixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'review-source-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const kind of ['core', 'angular', 'react']) {
    const directory = join(root, 'dist/libs', kind);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), '{}');
  }
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  for (const path of ['scripts/react-parity/checkpoint-execution.mjs', 'fixtures/react-parity/runtime/scenarios.ts']) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), `fixture ${path}`);
  }
  git('init');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'Fixture'
  );
  return root;
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function worker(t, body = '') {
  const directory = mkdtempSync(join(tmpdir(), 'manual-review-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'worker.mjs');
  writeFileSync(
    path,
    `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const [, , mode, kind, root, temporary] = process.argv;
if (mode !== '--prepare') throw new Error('Expected preparation child');
${body}
const directory = join(temporary, kind, 'dist');
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'index.html'), kind);
const tarball = join(temporary, kind + '.tgz');
writeFileSync(tarball, kind);
writeFileSync(join(temporary, kind + '.json'), JSON.stringify({ directory, observedEnv: process.env.NODE_ENV, artifacts: [{ name: '@threadplane/' + kind, path: tarball, sha256: createHash('sha256').update(kind).digest('hex') }] }));
`
  );
  return { path, directory };
}

test('importing the runner is inert even without artifacts or a project cwd', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const before = process.env.NODE_ENV; await import(${JSON.stringify(
        pathToFileURL(script).href
      )}); if (process.env.NODE_ENV !== before) throw new Error('environment changed'); console.log('imported');`,
    ],
    { cwd: tmpdir(), encoding: 'utf8', timeout: 5000 }
  );
  assert.equal(output, 'imported\n');
});

test('missing prebuilt artifacts fail with a build command before preparation', async (t) => {
  const { startRuntimeReview } = await import('./review-runtime.mjs');
  const fake = worker(t, "throw new Error('must not prepare');");
  await assert.rejects(
    startRuntimeReview({ root: fake.directory, worker: fake.path, log() {} }),
    /Prebuilt.*nx run-many.*core,angular,react/s
  );
});

test('workers have isolated unset build environments, e2e runs before fresh manual servers, and close is idempotent', async (t) => {
  const { startRuntimeReview } = await import('./review-runtime.mjs');
  const root = fixtureRoot(t);
  const fake = worker(
    t,
    "if (process.env.NODE_ENV !== undefined) throw new Error('inherited NODE_ENV'); if (process.env.npm_config_include !== 'dev' || process.env.npm_config_omit || process.env.NPM_CONFIG_PRODUCTION) throw new Error('dev tools omitted'); if (process.env.TMPDIR !== temporary) throw new Error('unowned worker temporary directory'); if (kind === 'react') process.env.NODE_ENV = 'production';"
  );
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    npm_config_omit: process.env.npm_config_omit,
    NPM_CONFIG_PRODUCTION: process.env.NPM_CONFIG_PRODUCTION,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.NODE_ENV = 'production';
  process.env.npm_config_omit = 'dev';
  process.env.NPM_CONFIG_PRODUCTION = 'true';
  const before = process.env.NODE_ENV;
  const events = [];
  const logs = [];
  const review = await startRuntimeReview({
    root,
    worker: fake.path,
    log: (line) => logs.push(line),
    verify: async (_directory, kind) => events.push(`verify ${kind}`),
    serve: async (_directory, kind) => {
      events.push(`serve ${kind}`);
      return {
        url: `http://127.0.0.1:${kind === 'react' ? 1234 : 1235}`,
        close: async () => events.push(`close ${kind}`),
      };
    },
  });
  t.after(() => review.close());
  assert.equal(process.env.NODE_ENV, before);
  assert.equal(process.env.npm_config_omit, 'dev');
  assert.equal(process.env.NPM_CONFIG_PRODUCTION, 'true');
  assert.equal(
    JSON.parse(readFileSync(join(review.temporary, 'angular.json')))
      .observedEnv,
    undefined
  );
  assert.deepEqual(events, [
    'verify react',
    'verify angular',
    'serve react',
    'serve angular',
  ]);
  assert.equal(
    review.provenance.head,
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  );
  assert.equal(review.artifacts.length, 2);
  assert.ok(Array.isArray(review.provenance.inputs), 'review provenance includes input hashes');
  for (const path of ['scripts/react-parity/checkpoint-execution.mjs', 'fixtures/react-parity/runtime/scenarios.ts']) {
    assert.match(review.provenance.inputs.find(input => input.path === path)?.sha256 ?? '', /^[a-f0-9]{64}$/, `${path} has review input evidence`);
  }
  assert.match(review.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(
    logs.some(
      (line) => line.includes('prebuilt artifacts') && line.includes('HEAD')
    )
  );
  assert.ok(
    logs.some((line) => line.includes('three Load') && line.includes('restart'))
  );
  await Promise.all([review.close(), review.close()]);
  assert.deepEqual(events.slice(-2), ['close react', 'close angular']);
  assert.equal(existsSync(review.temporary), false);
});

test('failed second preparation removes the first preparation and starts no servers', async (t) => {
  const { startRuntimeReview } = await import('./review-runtime.mjs');
  const root = fixtureRoot(t);
  const marker = join(tmpdir(), `review-failure-${process.pid}.json`);
  t.after(() => rmSync(marker, { force: true }));
  const fake = worker(
    t,
    `writeFileSync(${JSON.stringify(
      marker
    )}, temporary); if (kind === 'angular') throw new Error('second preparation failed');`
  );
  let served = false;
  await assert.rejects(
    startRuntimeReview({
      root,
      worker: fake.path,
      log() {},
      verify: async () => undefined,
      serve: async () => {
        served = true;
      },
    }),
    /angular.*preparation.*failed/i
  );
  assert.equal(served, false);
  assert.equal(existsSync(readFileSync(marker, 'utf8')), false);
});

test('a second server failure closes the first server before deleting prepared files', async (t) => {
  const { startRuntimeReview } = await import('./review-runtime.mjs');
  const root = fixtureRoot(t);
  const fake = worker(t);
  let firstDirectory;
  let closed = false;
  await assert.rejects(
    startRuntimeReview({
      root,
      worker: fake.path,
      log() {},
      verify: async () => undefined,
      serve: async (directory, kind) => {
        if (kind === 'angular') throw new Error('second server failed');
        firstDirectory = directory;
        return {
          url: 'http://127.0.0.1:1234',
          close: async () => {
            assert.ok(existsSync(directory));
            closed = true;
          },
        };
      },
    }),
    /second server failed/
  );
  assert.equal(closed, true);
  assert.equal(existsSync(firstDirectory), false);
});

test('abort during e2e waits for its cleanup and never starts manual servers', async (t) => {
  const { startRuntimeReview } = await import('./review-runtime.mjs');
  const root = fixtureRoot(t);
  const fake = worker(t);
  const entered = deferred();
  const finish = deferred();
  const controller = new AbortController();
  let directory;
  let served = false;
  const starting = startRuntimeReview({
    root,
    worker: fake.path,
    signal: controller.signal,
    log() {},
    verify: async (path) => {
      directory = path;
      entered.resolve();
      await finish.promise;
      assert.ok(existsSync(path));
    },
    serve: async () => {
      served = true;
    },
  });
  const rejected = assert.rejects(starting, /abort/i);
  await entered.promise;
  controller.abort();
  assert.ok(existsSync(directory));
  finish.resolve();
  await rejected;
  assert.equal(served, false);
  assert.equal(existsSync(directory), false);
});

test('abort terminates preparation descendants and awaits their close before deleting owned files', async (t) => {
  const { startRuntimeReview } = await import('./review-runtime.mjs');
  const root = fixtureRoot(t);
  const fake = worker(t);
  const finished = join(fake.directory, `descendant-'quote"-\\backslash`);
  const ready = deferred();
  const controller = new AbortController();
  writeFileSync(
    join(fake.directory, 'paths.json'),
    JSON.stringify({ finished })
  );
  writeFileSync(
    join(fake.directory, 'descendant.mjs'),
    `import { writeFileSync, existsSync } from 'node:fs';
const [, , temporary, finished] = process.argv;
process.on('SIGTERM', () => setTimeout(() => {
  writeFileSync(finished, String(existsSync(temporary)));
  process.exit(0);
}, 30));
console.log('DESCENDANT_READY');
setInterval(() => {}, 1000);`
  );
  writeFileSync(
    fake.path,
    `import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { finished } = JSON.parse(readFileSync(new URL('./paths.json', import.meta.url), 'utf8'));
spawn(process.execPath, [fileURLToPath(new URL('./descendant.mjs', import.meta.url)), process.argv[5], finished], { stdio: ['ignore', 'inherit', 'inherit'] });
setInterval(() => {}, 1000);`
  );
  const starting = startRuntimeReview({
    root,
    worker: fake.path,
    signal: controller.signal,
    log() {},
    onWorkerOutput: (text) => {
      if (text.split('\n').includes('DESCENDANT_READY')) ready.resolve();
    },
    verify: async () => undefined,
  });
  const rejected = assert.rejects(starting, /abort/i);
  await ready.promise;
  controller.abort();
  await rejected;
  assert.equal(readFileSync(finished, 'utf8'), 'true');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} closes a ready review through registered handlers`, async (t) => {
    const { startRuntimeReview } = await import('./review-runtime.mjs');
    const root = fixtureRoot(t);
    const fake = worker(t);
    const signals = new EventEmitter();
    let closed = 0;
    const review = await startRuntimeReview({
      root,
      worker: fake.path,
      signals,
      log() {},
      verify: async () => undefined,
      serve: async () => ({
        url: 'http://127.0.0.1:1234',
        close: async () => {
          closed++;
        },
      }),
    });
    signals.emit(signal);
    await review.closed;
    assert.equal(closed, 2);
    assert.equal(existsSync(review.temporary), false);
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  });
}

test('abort awaits ignored-stdio descendants after the worker has exited', async (t) => {
  const { startRuntimeReview } = await import('./review-runtime.mjs');
  const root = fixtureRoot(t);
  const fake = worker(t);
  const readyFile = join(fake.directory, 'ready');
  const finished = join(fake.directory, 'finished');
  const ready = deferred();
  const controller = new AbortController();
  writeFileSync(
    join(fake.directory, 'paths.json'),
    JSON.stringify({ finished, readyFile })
  );
  writeFileSync(
    join(fake.directory, 'descendant.mjs'),
    `import { writeFileSync, existsSync } from 'node:fs';
const [, , temporary, finished, readyFile] = process.argv;
process.on('SIGTERM', () => setTimeout(() => {
  writeFileSync(finished, String(existsSync(temporary)));
  process.exit(0);
}, 150));
writeFileSync(readyFile, 'ready');
setInterval(() => {}, 1000);`
  );
  writeFileSync(
    fake.path,
    `import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { finished, readyFile } = JSON.parse(readFileSync(new URL('./paths.json', import.meta.url), 'utf8'));
spawn(process.execPath, [fileURLToPath(new URL('./descendant.mjs', import.meta.url)), process.argv[5], finished, readyFile], { stdio: 'ignore' });
const timer = setInterval(() => { if (existsSync(readyFile)) { clearInterval(timer); console.log('DESCENDANT_READY'); } }, 10);
setInterval(() => {}, 1000);`
  );
  const starting = startRuntimeReview({
    root,
    worker: fake.path,
    signal: controller.signal,
    log() {},
    onWorkerOutput: (text) => {
      if (text.split('\n').includes('DESCENDANT_READY')) ready.resolve();
    },
    verify: async () => undefined,
  });
  const rejected = assert.rejects(starting, /abort/i);
  await ready.promise;
  controller.abort();
  await rejected;
  // Wait for the independent marker even when a broken runner returns early.
  const deadline = Date.now() + 2000;
  while (!existsSync(finished) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(readFileSync(finished, 'utf8'), 'true');
});

test('failed workers retain ownership until surviving descendants exit', async (t) => {
  const { startRuntimeReview } = await import('./review-runtime.mjs');
  const root = fixtureRoot(t);
  const fake = worker(t);
  const readyFile = join(fake.directory, 'ready');
  const finished = join(fake.directory, 'finished');
  writeFileSync(
    join(fake.directory, 'paths.json'),
    JSON.stringify({ finished, readyFile })
  );
  writeFileSync(
    join(fake.directory, 'descendant.mjs'),
    `import { writeFileSync, existsSync } from 'node:fs';
const [, , temporary, finished, readyFile] = process.argv;
const finish = () => {
  writeFileSync(finished, String(existsSync(temporary)));
  process.exit(0);
};
process.on('SIGTERM', () => setTimeout(finish, 50));
writeFileSync(readyFile, 'ready');
setTimeout(finish, 500);`
  );
  writeFileSync(
    fake.path,
    `import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { finished, readyFile } = JSON.parse(readFileSync(new URL('./paths.json', import.meta.url), 'utf8'));
spawn(process.execPath, [fileURLToPath(new URL('./descendant.mjs', import.meta.url)), process.argv[5], finished, readyFile], { stdio: 'ignore' });
setInterval(() => { if (existsSync(readyFile)) process.exit(1); }, 10);`
  );
  await assert.rejects(
    startRuntimeReview({
      root,
      worker: fake.path,
      log() {},
      verify: async () => undefined,
    }),
    /preparation failed/
  );
  const deadline = Date.now() + 2000;
  while (!existsSync(finished) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(readFileSync(finished, 'utf8'), 'true');
});

for (const deniedSignal of ['SIGTERM', 0, 'SIGKILL']) {
  test(`cleanup retries transient EPERM at ${deniedSignal} until ESRCH`, async (t) => {
    const { startRuntimeReview } = await import('./review-runtime.mjs');
    const root = fixtureRoot(t);
    const fake = worker(t);
    const groups = new Map();
    const review = await startRuntimeReview({
      root,
      worker: fake.path,
      log() {},
      verify: async () => undefined,
      serve: async () => ({
        url: 'http://127.0.0.1:1234',
        close: async () => undefined,
      }),
      killProcessGroup: (pid, signal) => {
        assert.ok(pid < 0);
        const group = groups.get(pid) ?? { denied: false, confirmed: false };
        groups.set(pid, group);
        if (signal === deniedSignal && !group.denied) {
          group.denied = true;
          throw Object.assign(new Error('transient group denial'), {
            code: 'EPERM',
          });
        }
        // Keep the group present until the selected signal/probe was denied.
        if (signal === 0 && group.denied) {
          group.confirmed = true;
          throw Object.assign(new Error('group exited'), { code: 'ESRCH' });
        }
      },
    });
    t.after(() => review.close());
    assert.equal(groups.size, 2);
    assert.ok(
      [...groups.values()].every((group) => group.denied && group.confirmed)
    );
    await review.close();
    assert.equal(existsSync(review.temporary), false);
  });
}

test('persistent group permission denial rejects and retains owned files', async (t) => {
  const { startRuntimeReview } = await import('./review-runtime.mjs');
  const root = fixtureRoot(t);
  const fake = worker(t, "console.log('OWNED_ROOT ' + temporary);");
  let temporary;
  t.after(() => {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  });
  const signals = [];
  await assert.rejects(
    startRuntimeReview({
      root,
      worker: fake.path,
      log() {},
      onWorkerOutput: (text) => {
        if (text.startsWith('OWNED_ROOT '))
          temporary = text.trim().slice('OWNED_ROOT '.length);
      },
      verify: async () => undefined,
      serve: async () => ({
        url: 'http://127.0.0.1:1234',
        close: async () => undefined,
      }),
      killProcessGroup: (_pid, signal) => {
        signals.push(signal);
        assert.ok(existsSync(temporary));
        throw Object.assign(new Error('persistent group denial'), {
          code: 'EPERM',
        });
      },
    }).then((review) => {
      t.after(() => review.close());
      return review;
    }),
    (error) => {
      assert.match(
        error.message,
        /process group did not exit; temporary files retained/
      );
      assert.equal(error.cause.code, 'EPERM');
      return true;
    }
  );
  assert.ok(signals.includes('SIGTERM'));
  assert.ok(signals.includes('SIGKILL'));
  assert.ok(signals.includes(0));
  assert.ok(existsSync(temporary));
});
