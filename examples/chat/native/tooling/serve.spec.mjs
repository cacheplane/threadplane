import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startServe, developmentCommands } from './serve.mjs';
import { startProxy } from './proxy.mjs';

function fixture(t, behavior = {}) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-lifetime-test-'))
  );
  const root = join(directory, 'root');
  mkdirSync(root);
  writeFileSync(join(root, 'package.json'), '{}');
  const worker = join(directory, 'worker.mjs');
  writeFileSync(
    worker,
    `
    import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
    import { join } from 'node:path';
    import { spawn, spawnSync } from 'node:child_process';
    const temporary = process.argv[4];
    writeFileSync(join(temporary, 'worker-env.json'), JSON.stringify(process.env));
    ${behavior.preparation ?? ''}
    const consumer = join(temporary, 'consumer');
    const selected = ${JSON.stringify(behavior.framework ?? 'react')};
    writeFileSync(join(temporary, 'worker-options.json'), process.argv[5]);
    mkdirSync(join(consumer, selected), { recursive: true });
    for (const [path, code] of Object.entries(${JSON.stringify({
      'node_modules/vite/bin/vite.js':
        behavior.vite ??
        "console.log('  ➜  Local:   http://127.0.0.1:43219/'); setInterval(() => {}, 1000)",
      'node_modules/typescript/bin/tsc':
        behavior.checker ??
        "console.log('Found 0 errors. Watching for file changes.'); setInterval(() => {}, 1000)",
      'node_modules/@angular/cli/bin/ng.js':
        behavior.vite ??
        "console.log('Application bundle generation complete.'); console.log('Local: http://127.0.0.1:43219/'); setInterval(() => {}, 1000)",
      'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js':
        behavior.checker ??
        "console.log('Compilation complete. Watching for file changes.'); setInterval(() => {}, 1000)",
    })})) {
      mkdirSync(join(consumer, path, '..'), { recursive: true });
      writeFileSync(join(consumer, path), code);
    }
    writeFileSync(join(temporary, 'prepared.json'), JSON.stringify({ initialFiles: {} }));
  `
  );
  return { root, worker, temporaryParent: directory, directory };
}
const options = {
  configuration: 'development',
  assistantId: 'owned-assistant',
  port: 43219,
};
const env = {
  ...process.env,
  NATIVE_LANGGRAPH_URL: 'http://127.0.0.1:43218',
  NATIVE_LANGGRAPH_API_KEY: 'owned-lifetime-secret',
  VITE_SECRET: 'owned-lifetime-secret',
};
function launch(t, fixtureOptions = {}, overrides = {}) {
  const { expectCleanupFailure = false, ...serveOverrides } = overrides;
  const paths = fixture(t, fixtureOptions),
    output = [];
  const lifetime = startServe({
    ...paths,
    options,
    env,
    log: (line) => output.push(line),
    signals: new EventEmitter(),
    startupTimeout: 3000,
    ...serveOverrides,
  });
  t.after(async () => {
    if (expectCleanupFailure)
      await assert.rejects(
        lifetime.close(),
        /cleanup failed; temporary files retained/
      );
    else await lifetime.close();
    if (!existsSync(lifetime?.temporary ?? ''))
      rmSync(paths.directory, { recursive: true, force: true });
  });
  return { ...paths, lifetime, output };
}

test('serve owns preparation, sanitized child environments, readiness and idempotent cleanup', async (t) => {
  const { lifetime, output } = launch(t);
  assert.ok(
    lifetime?.ready instanceof Promise,
    'serve must expose owned readiness'
  );
  const ready = await lifetime.ready;
  assert.match(ready.url, /^http:\/\/127\.0\.0\.1:/);
  assert.ok(existsSync(ready.consumer));
  const actual = JSON.parse(
    readFileSync(join(lifetime.temporary, 'worker-env.json'), 'utf8')
  );
  assert.equal(actual.NATIVE_LANGGRAPH_API_KEY, '');
  assert.equal(actual.NATIVE_LANGGRAPH_URL, undefined);
  assert.equal(actual.VITE_SECRET, undefined);
  assert.equal(actual.NX_LOAD_DOT_ENV_FILES, 'false');
  assert.equal(
    output.filter((line) => line.startsWith('Native conversation ready:'))
      .length,
    1
  );
  const closing = lifetime.close();
  assert.equal(lifetime.close(), closing);
  await closing;
  await lifetime.closed;
  assert.equal(existsSync(lifetime.temporary), false);
});

test('Angular development selects installed ng serve and ngc with an owned proxy config', () => {
  const commands = developmentCommands(
    '/owned/consumer',
    { ...options, framework: 'angular' },
    'http://127.0.0.1:43217',
    env
  );
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0].args, [
    '/owned/consumer/node_modules/@angular/cli/bin/ng.js',
    'serve',
    'native-conversation-angular',
    '--configuration=development',
    '--host=127.0.0.1',
    '--port=43219',
    '--no-open',
    '--proxy-config=.native-proxy.json',
  ]);
  assert.deepEqual(commands[1].args, [
    '/owned/consumer/node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js',
    '-p',
    'tsconfig.app.json',
    '--noEmit',
    '--watch',
  ]);
  for (const command of commands) {
    assert.equal(command.cwd, '/owned/consumer/angular');
    assert.equal(command.env.CI, 'true');
    assert.equal(command.env.NATIVE_LANGGRAPH_API_KEY, '');
    assert.equal(command.env.NATIVE_PROXY_ORIGIN, undefined);
  }
});

test('Angular lifetime propagates selection and writes only local proxy address', async (t) => {
  const { lifetime } = launch(
    t,
    { framework: 'angular' },
    { options: { ...options, framework: 'angular' } }
  );
  const { consumer } = await lifetime.ready;
  assert.equal(
    JSON.parse(readFileSync(join(lifetime.temporary, 'worker-options.json')))
      .framework,
    'angular'
  );
  const config = readFileSync(
    join(consumer, 'angular/.native-proxy.json'),
    'utf8'
  );
  assert.match(config, /http:\/\/127\.0\.0\.1:\d+/);
  assert.doesNotMatch(config, /owned-lifetime-secret|43218/);
  await lifetime.close();
  await lifetime.closed;
});

for (const scenario of ['cli-failure', 'checker-failure'])
  test(`Angular readiness uses latest success after ${scenario}`, async (t) => {
    const gated = (before, after) =>
      `const fs = require('node:fs'); const path = require('node:path'); ${before}; console.log('owned waiting for green'); const timer = setInterval(() => { if (fs.existsSync(path.join(process.cwd(), '../..', 'release-green'))) { clearInterval(timer); ${after}; } }, 10); setInterval(() => {}, 1000);`;
    const { lifetime, output } = launch(
      t,
      {
        framework: 'angular',
        vite:
          scenario === 'cli-failure'
            ? gated(
                "console.log('Application bundle generation failed.'); console.log('Local: http://127.0.0.1:43219/'); console.log('owned CLI listening')",
                "console.log('Application bundle generation complete.')"
              )
            : "setTimeout(() => { console.log('Application bundle generation complete.'); console.log('Local: http://127.0.0.1:43219/'); console.log('owned CLI listening'); }, 150); setInterval(() => {}, 1000)",
        checker:
          scenario === 'checker-failure'
            ? gated(
                "console.log('Compilation complete. Watching for file changes.'); console.log('File change detected. Starting incremental compilation.'); console.log('error TS2322: owned diagnostic'); console.log('Compilation failed. Watching for file changes.')",
                "console.log('Compilation complete. Watching for file changes.')"
              )
            : undefined,
      },
      { options: { ...options, framework: 'angular' } }
    );
    let ready = false;
    void lifetime.ready.then(() => {
      ready = true;
    });
    await until(
      () =>
        output.includes('owned waiting for green') &&
        output.includes('owned CLI listening')
    );
    assert.equal(ready, false);
    assert.equal(
      output.some((line) => line.startsWith('Native conversation ready:')),
      false
    );
    writeFileSync(join(lifetime.temporary, 'release-green'), 'yes');
    await lifetime.ready;
    if (scenario === 'checker-failure')
      assert.ok(output.some((line) => line.includes('owned diagnostic')));
  });

for (const role of ['vite', 'checker'])
  test(`Angular ${role} child exit closes the generation`, async (t) => {
    const { lifetime } = launch(
      t,
      { framework: 'angular', [role]: 'process.exit(0)' },
      { options: { ...options, framework: 'angular' } }
    );
    await assert.rejects(lifetime.ready, /exited unexpectedly/);
    await assert.rejects(lifetime.closed, /exited unexpectedly/);
    assert.equal(existsSync(lifetime.temporary), false);
  });

test('Angular cancellation interrupts preparation before readiness', async (t) => {
  const controller = new AbortController();
  const { lifetime } = launch(
    t,
    {
      framework: 'angular',
      preparation:
        "writeFileSync(join(temporary, 'entered'), 'yes'); spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);",
    },
    { options: { ...options, framework: 'angular' }, signal: controller.signal }
  );
  await until(() => existsSync(join(lifetime.temporary, 'entered')));
  controller.abort();
  await assert.rejects(lifetime.ready, /aborted/);
  await lifetime.closed;
  assert.equal(existsSync(lifetime.temporary), false);
});

async function until(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline)
      assert.fail('Owned fixture condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

for (const event of ['SIGINT', 'SIGTERM', 'abort'])
  test(`${event} interrupts synchronous preparation and removes signal listeners`, async (t) => {
    const signals = new EventEmitter(),
      controller = new AbortController();
    const { lifetime } = launch(
      t,
      {
        preparation: `writeFileSync(join(temporary, 'entered'), 'yes'); spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);`,
      },
      { signals, signal: controller.signal }
    );
    await until(() => existsSync(join(lifetime.temporary, 'entered')));
    if (event === 'abort') controller.abort();
    else signals.emit(event);
    await assert.rejects(lifetime.ready, /aborted/);
    await lifetime.closed;
    assert.equal(existsSync(lifetime.temporary), false);
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  });

test('pre-aborted startup never spawns preparation', async (t) => {
  const controller = new AbortController();
  controller.abort();
  const { lifetime, output } = launch(t, {}, { signal: controller.signal });
  await assert.rejects(lifetime.ready, /aborted/);
  await lifetime.closed;
  assert.deepEqual(output, []);
  assert.equal(existsSync(lifetime.temporary), false);
});

test('exited worker retains temporary files until its ignored-stdio descendant exits', async (t) => {
  const { lifetime, directory } = launch(t, {
    preparation: `
    const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(
      "const fs = require('fs'); const path = require('path'); const temporary = process.argv[1]; process.on('SIGTERM', () => setTimeout(() => { fs.writeFileSync(path.join(temporary, '..', 'finished'), String(fs.existsSync(temporary))); process.exit(0); }, 150)); fs.writeFileSync(path.join(temporary, 'descendant-ready'), String(process.pid)); setInterval(() => {}, 1000);"
    )}, temporary], { stdio: 'ignore' });
    while (!existsSync(join(temporary, 'descendant-ready'))) await new Promise((resolve) => setTimeout(resolve, 10));
    process.exit(1);
  `,
  });
  await assert.rejects(lifetime.ready, /preparation exited/);
  await assert.rejects(lifetime.closed, /preparation exited/);
  assert.equal(readFileSync(join(directory, 'finished'), 'utf8'), 'true');
  assert.equal(existsSync(lifetime.temporary), false);
});

test('owned descendants ignoring SIGTERM are killed before deletion', async (t) => {
  const controller = new AbortController(),
    delivered = [];
  const { lifetime } = launch(
    t,
    {
      preparation: `
    spawn(process.execPath, ['-e', ${JSON.stringify(
      "const fs = require('fs'); const path = require('path'); process.on('SIGTERM', () => {}); fs.writeFileSync(path.join(process.argv[1], 'descendant-ready'), String(process.pid)); setInterval(() => {}, 1000);"
    )}, temporary], { stdio: 'ignore' });
    setInterval(() => {}, 1000); await new Promise(() => {});
  `,
    },
    {
      signal: controller.signal,
      killProcessGroup: (pid, value) => {
        delivered.push(value);
        return process.kill(pid, value);
      },
    }
  );
  await until(() => existsSync(join(lifetime.temporary, 'descendant-ready')));
  const pid = Number(
    readFileSync(join(lifetime.temporary, 'descendant-ready'), 'utf8')
  );
  controller.abort();
  await lifetime.closed;
  assert.ok(delivered.includes('SIGKILL'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal(existsSync(lifetime.temporary), false);
});

test('persistent EPERM cannot prove group exit and retains owned files', async (t) => {
  const groups = new Set();
  const { lifetime, directory } = launch(
    t,
    {},
    {
      startupTimeout: 10000,
      expectCleanupFailure: true,
      killProcessGroup: (pid, value) => {
        groups.add(pid);
        // The fixture worker has actually exited; deny every probe to exercise
        // inability to prove that state, without leaving real live children.
        throw Object.assign(new Error('owned test permission denial'), {
          code: 'EPERM',
        });
      },
    }
  );
  await assert.rejects(lifetime.ready, /group did not exit/);
  await assert.rejects(
    lifetime.closed,
    /cleanup failed; temporary files retained/
  );
  assert.ok(existsSync(lifetime.temporary));
  for (const pid of groups)
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  rmSync(directory, { recursive: true, force: true });
});

test('a frozen edit while preparation is held rejects the parent baseline', async (t) => {
  const { lifetime, root } = launch(t, {
    preparation: `
    writeFileSync(join(temporary, 'entered'), 'yes');
    while (!existsSync(join(temporary, 'continue'))) await new Promise((resolve) => setTimeout(resolve, 10));
  `,
  });
  await until(() => existsSync(join(lifetime.temporary, 'entered')));
  writeFileSync(join(root, 'package.json'), '{"changed":true}');
  writeFileSync(join(lifetime.temporary, 'continue'), 'yes');
  await assert.rejects(
    lifetime.ready,
    /Frozen development inputs changed; restart/
  );
  await assert.rejects(
    lifetime.closed,
    /Frozen development inputs changed; restart/
  );
  assert.equal(existsSync(lifetime.temporary), false);
});

for (const role of ['vite', 'checker'])
  test(`${role} exit after readiness closes siblings and rejects completion`, async (t) => {
    const output =
      role === 'vite'
        ? 'Local: http://127.0.0.1:43219/'
        : 'Found 0 errors. Watching for file changes.';
    const { lifetime } = launch(t, {
      [role]: `console.log(${JSON.stringify(
        output
      )}); setTimeout(() => process.exit(0), 150);`,
    });
    await lifetime.ready;
    await assert.rejects(lifetime.closed, /exited unexpectedly/);
    assert.equal(existsSync(lifetime.temporary), false);
  });

test('development commands select installed CLIs and only Vite receives the owned proxy origin', () => {
  const commands = developmentCommands(
    '/owned/consumer',
    options,
    'http://127.0.0.1:43217',
    env
  );
  assert.equal(commands.length, 2);
  const [vite, checker] = commands;
  assert.deepEqual(vite.args, [
    '/owned/consumer/node_modules/vite/bin/vite.js',
    '--config',
    'vite.config.mts',
    '--mode',
    'development',
    '--host',
    '127.0.0.1',
    '--port',
    '43219',
    '--strictPort',
  ]);
  assert.deepEqual(checker.args, [
    '/owned/consumer/node_modules/typescript/bin/tsc',
    '--project',
    'tsconfig.app.json',
    '--noEmit',
    '--watch',
    '--pretty',
    'false',
    '--preserveWatchOutput',
  ]);
  for (const command of commands) {
    assert.equal(command.command, process.execPath);
    assert.equal(command.cwd, '/owned/consumer/react');
    assert.equal(command.env.NATIVE_LANGGRAPH_API_KEY, '');
    assert.equal(command.env.NATIVE_LANGGRAPH_URL, undefined);
    assert.equal(command.env.VITE_SECRET, undefined);
    assert.doesNotMatch(
      JSON.stringify(command.args),
      /owned-lifetime-secret|43218/
    );
  }
  assert.equal(vite.env.NATIVE_PROXY_ORIGIN, 'http://127.0.0.1:43217');
  assert.equal(checker.env.NATIVE_PROXY_ORIGIN, undefined);
});

for (const role of ['vite', 'checker'])
  test(`${role} early successful exit fails readiness and cleans siblings`, async (t) => {
    const { lifetime } = launch(t, { [role]: 'process.exit(0)' });
    assert.ok(lifetime?.ready, 'serve exposes readiness');
    await assert.rejects(lifetime.ready, /exited/i);
    await assert.rejects(lifetime.closed, /exited/i);
    assert.equal(existsSync(lifetime.temporary), false);
  });

test('initial checker errors time out instead of announcing readiness', async (t) => {
  const { lifetime, output } = launch(
    t,
    {
      checker:
        "console.log('Found 1 error. Watching for file changes.'); setInterval(() => {}, 1000)",
    },
    { startupTimeout: 400 }
  );
  assert.ok(lifetime?.ready, 'serve exposes readiness');
  await assert.rejects(lifetime.ready, /timed out/i);
  await assert.rejects(lifetime.closed, /timed out/i);
  assert.equal(
    output.some((line) => line.startsWith('Native conversation ready:')),
    false
  );
});

test('failed preparation spawn is observed and removes owned temporary files', async (t) => {
  const { lifetime } = launch(
    t,
    {},
    { node: '/no-such-owned-node-executable' }
  );
  assert.ok(lifetime?.ready, 'serve exposes readiness');
  await assert.rejects(lifetime.ready, /preparation.*spawn/i);
  await assert.rejects(lifetime.closed, /preparation.*spawn/i);
  assert.equal(existsSync(lifetime.temporary), false);
});

test('readiness requires the latest checker result, and keeps later recovery diagnostics visible', async (t) => {
  const { lifetime, output } = launch(t, {
    vite: "setTimeout(() => console.log('Local: http://127.0.0.1:43219/'), 150); setInterval(() => {}, 1000)",
    checker:
      "process.stdout.write('Found 0 err'); setTimeout(() => console.log('ors. Watching for file changes.'), 10); setTimeout(() => console.log('Found 1 error. Watching for file changes.'), 50); setTimeout(() => console.log('Found 0 errors. Watching for file changes.'), 350); setInterval(() => {}, 1000)",
  });
  assert.ok(lifetime?.ready, 'serve exposes readiness');
  await lifetime.ready;
  const announced = output.findIndex((line) =>
    line.startsWith('Native conversation ready:')
  );
  assert.equal(
    output.slice(0, announced).filter((line) => line.includes('Found 0 errors'))
      .length,
    2
  );
  assert.ok(
    output.slice(0, announced).some((line) => line.includes('Found 1 error'))
  );
});

test('a newer failure in the same checker chunk prevents readiness until recovery', async (t) => {
  const { lifetime, output } = launch(t, {
    checker:
      "setTimeout(() => process.stdout.write('Found 0 errors. Watching for file changes.\\nStarting incremental compilation...\\nFound 1 error. Watching for file changes.\\n'), 100); setTimeout(() => console.log('Found 0 errors. Watching for file changes.'), 350); setInterval(() => {}, 1000)",
  });
  await lifetime.ready;
  const announced = output.findIndex((line) =>
    line.startsWith('Native conversation ready:')
  );
  assert.equal(
    output.slice(0, announced).filter((line) => line.includes('Found 0 errors'))
      .length,
    2
  );
});

async function occupied(t) {
  const listener = http.createServer((_request, response) =>
    response.end('owned listener survives')
  );
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  return {
    port: listener.address().port,
    url: `http://127.0.0.1:${listener.address().port}`,
  };
}

test('direct serve and command boundaries reject zero and malformed options', (t) => {
  for (const invalid of [
    { port: 0 },
    { port: 65536 },
    { port: 1.5 },
    { port: '4301' },
    { configuration: 'production' },
    { assistantId: ' ' },
  ]) {
    assert.throws(() =>
      developmentCommands(
        '/owned/consumer',
        { ...options, ...invalid },
        'http://127.0.0.1:1',
        env
      )
    );
    assert.throws(
      () =>
        startServe({
          root: '/no-effects',
          options: { ...options, ...invalid },
          env,
        }),
      /serve|port|assistant/i
    );
  }
});

test('proxy bind failure after preparation cleans the generation and preserves the occupied listener', async (t) => {
  const listener = await occupied(t);
  const { lifetime } = launch(
    t,
    {},
    {
      createProxy: (configuration) =>
        startProxy({ ...configuration, port: listener.port }),
    }
  );
  await assert.rejects(
    lifetime.ready,
    /Unable to listen on the local proxy port/
  );
  await assert.rejects(
    lifetime.closed,
    /Unable to listen on the local proxy port/
  );
  assert.equal(existsSync(lifetime.temporary), false);
  assert.equal(
    await (await fetch(listener.url)).text(),
    'owned listener survives'
  );
});

test('occupied requested port fails CLI startup without fallback or stopping the listener', async (t) => {
  const listener = await occupied(t);
  const { lifetime, output } = launch(
    t,
    {
      vite: `
    const http = require('http');
    const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
    if (!process.argv.includes('--strictPort')) throw new Error('Strict port flag required');
    http.createServer().listen(port, '127.0.0.1');
  `,
    },
    { options: { ...options, port: listener.port } }
  );
  await assert.rejects(lifetime.ready, /Vite exited unexpectedly/);
  await assert.rejects(lifetime.closed, /Vite exited unexpectedly/);
  assert.equal(
    output.some((line) => line.startsWith('Native conversation ready:')),
    false
  );
  assert.equal(existsSync(lifetime.temporary), false);
  assert.equal(
    await (await fetch(listener.url)).text(),
    'owned listener survives'
  );
});
