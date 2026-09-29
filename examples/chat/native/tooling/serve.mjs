import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  preparationEnvironment,
  selectedFramework,
  validateServeOptions,
} from './commands.mjs';
import { readProxyConfiguration, startProxy } from './proxy.mjs';
import { frozenInputFingerprint, startSourceMirror } from './source-mirror.mjs';

export function developmentCommands(
  consumer,
  options,
  proxyOrigin,
  env = process.env
) {
  options = validateServeOptions(options);
  if (options.framework === 'angular') {
    const cwd = join(consumer, 'angular');
    return [
      {
        name: 'Angular CLI',
        command: process.execPath,
        args: [
          join(consumer, 'node_modules/@angular/cli/bin/ng.js'),
          'serve',
          'native-conversation-angular',
          '--configuration=development',
          '--host=127.0.0.1',
          '--port=' + options.port,
          '--no-open',
          '--proxy-config=.native-proxy.json',
        ],
        cwd,
        env: preparationEnvironment(env),
      },
      {
        name: 'Angular compiler',
        command: process.execPath,
        args: [
          join(
            consumer,
            'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js'
          ),
          '-p',
          'tsconfig.app.json',
          '--noEmit',
          '--watch',
        ],
        cwd,
        env: preparationEnvironment(env),
      },
    ];
  }
  const cwd = join(consumer, 'react');
  return [
    {
      name: 'Vite',
      command: process.execPath,
      args: [
        join(consumer, 'node_modules/vite/bin/vite.js'),
        '--config',
        'vite.config.mts',
        '--mode',
        options.configuration,
        '--host',
        '127.0.0.1',
        '--port',
        String(options.port),
        '--strictPort',
      ],
      cwd,
      env: { ...preparationEnvironment(env), NATIVE_PROXY_ORIGIN: proxyOrigin },
    },
    {
      name: 'TypeScript',
      command: process.execPath,
      args: [
        join(consumer, 'node_modules/typescript/bin/tsc'),
        '--project',
        'tsconfig.app.json',
        '--noEmit',
        '--watch',
        '--pretty',
        'false',
        '--preserveWatchOutput',
      ],
      cwd,
      env: preparationEnvironment(env),
    },
  ];
}

// Only owned detached process groups reach this function. An exited group leader
// is insufficient: nested synchronous build/install processes must also be gone.
function terminate(record, killProcessGroup) {
  return (record.termination ??= (async () => {
    let groupGone = !record.child.pid,
      permissionError;
    const signal = (value) => {
      if (groupGone) return;
      try {
        killProcessGroup(-record.child.pid, value);
      } catch (error) {
        if (error.code === 'ESRCH') groupGone = true;
        else if (error.code === 'EPERM') permissionError = error;
        else throw error;
      }
    };
    const started = Date.now();
    let escalated = false;
    signal('SIGTERM');
    while (!groupGone || !record.closed) {
      const elapsed = Date.now() - started;
      if (!groupGone && !escalated && elapsed >= 2000) {
        escalated = true;
        signal('SIGKILL');
      }
      signal(0);
      if (groupGone && record.closed) break;
      if (elapsed >= 5000)
        throw new Error(
          'Owned process group did not exit; temporary files retained',
          { cause: permissionError }
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  })());
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

/** One generation owns preparation, mirror, proxy, installed CLIs and cleanup.
 * Worker/signal seams exercise real process failures without reinstalling.
 * close() shares one promise; closed rejects on startup/runtime/cleanup failure.
 */
export function startServe({
  root,
  options,
  env = process.env,
  signal,
  signals = process,
  log = console.log,
  worker = fileURLToPath(new URL('./serve-worker.mjs', import.meta.url)),
  node = process.execPath,
  temporaryParent = tmpdir(),
  startupTimeout = 180000,
  createProxy = startProxy,
  killProcessGroup = (pid, value) => process.kill(pid, value),
} = {}) {
  options = validateServeOptions(options);
  const framework = selectedFramework(options.framework);
  const proxyConfiguration = readProxyConfiguration(env);
  root = realpathSync(root);
  const initialFrozen = frozenInputFingerprint(root, framework);
  const temporary = realpathSync(
    mkdtempSync(join(temporaryParent, 'native-conversation-serve-'))
  );
  const consumer = join(temporary, 'consumer');
  const readiness = deferred(),
    completion = deferred(),
    cancelled = deferred(),
    startupSettled = deferred();
  const records = [];
  let stopping = false,
    closing,
    failure,
    proxy,
    mirror,
    timer;
  const checkActive = () => {
    if (stopping) throw failure ?? new Error('Native serve startup aborted');
  };
  function fail(error) {
    if (stopping) return;
    failure = error;
    void close().catch(() => {});
  }
  function close() {
    if (closing) return closing;
    stopping = true;
    clearTimeout(timer);
    const reason = failure ?? new Error('Native serve startup aborted');
    cancelled.reject(reason);
    readiness.reject(reason);
    closing = Promise.resolve()
      .then(async () => {
        const errors = [];
        // Interrupt nested synchronous preparation before waiting for startup.
        const terminated = await Promise.allSettled(
          records.map((record) => terminate(record, killProcessGroup))
        );
        for (const result of terminated)
          if (result.status === 'rejected') errors.push(result.reason);
        await startupSettled.promise;
        const resources = await Promise.allSettled([
          mirror?.close(),
          proxy?.close(),
        ]);
        for (const result of resources)
          if (result.status === 'rejected') errors.push(result.reason);
        if (!errors.length) rmSync(temporary, { recursive: true, force: true });
        if (errors.length)
          throw new AggregateError(
            errors,
            'Native serve cleanup failed; temporary files retained'
          );
      })
      .finally(() => {
        signal?.removeEventListener('abort', stop);
        signals.removeListener('SIGINT', stop);
        signals.removeListener('SIGTERM', stop);
      });
    void closing.then(
      () => (failure ? completion.reject(failure) : completion.resolve()),
      (error) => completion.reject(error)
    );
    return closing;
  }
  function stop() {
    void close().catch(() => {});
  }
  function launch(command, onLine) {
    checkActive();
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: command.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = { child, closed: false, done: deferred() };
    records.push(record);
    let spawnError;
    child.once('error', (error) => {
      spawnError = error;
      fail(new Error(`${command.name} failed to spawn`, { cause: error }));
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      let pending = '';
      stream.on('data', (chunk) => {
        pending += chunk.toString();
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) onLine(line);
        // Preserve diagnostics without keeping an unbounded unterminated line.
        while (pending.length > 16384) {
          log(pending.slice(0, 16384));
          pending = pending.slice(16384);
        }
      });
      stream.on('end', () => {
        if (pending) onLine(pending);
      });
    }
    child.once('close', (code, exitSignal) => {
      record.closed = true;
      const error =
        spawnError || code !== 0 || command.name !== 'preparation'
          ? new Error(
              `${command.name} exited unexpectedly (${exitSignal ?? code})`,
              { cause: spawnError }
            )
          : undefined;
      record.done.resolve({ error });
      if (error && !stopping) fail(error);
    });
    return record;
  }
  signal?.addEventListener('abort', stop, { once: true });
  signals.on('SIGINT', stop);
  signals.on('SIGTERM', stop);
  timer = setTimeout(
    () =>
      fail(
        new Error(
          'Native serve startup timed out before server and compiler were ready'
        )
      ),
    startupTimeout
  );
  if (signal?.aborted) stop();
  void (async () => {
    try {
      checkActive();
      writeFileSync(
        join(temporary, 'frozen.json'),
        JSON.stringify(initialFrozen)
      );
      const preparation = launch(
        {
          name: 'preparation',
          command: node,
          args: [
            worker,
            '--prepare',
            root,
            temporary,
            JSON.stringify({
              framework,
              configuration: options.configuration,
              assistantId: options.assistantId,
            }),
          ],
          cwd: root,
          env: preparationEnvironment(env),
        },
        log
      );
      const result = await Promise.race([
        preparation.done.promise,
        cancelled.promise,
      ]);
      if (result.error) throw result.error;
      await terminate(preparation, killProcessGroup);
      checkActive();
      const { initialFiles } = JSON.parse(
        readFileSync(join(temporary, 'prepared.json'), 'utf8')
      );
      mirror = startSourceMirror({
        root,
        consumer,
        framework,
        initialFrozen,
        initialFiles,
        onFailure: fail,
      });
      await Promise.race([mirror.ready, cancelled.promise]);
      checkActive();
      proxy = await createProxy({ ...proxyConfiguration, port: 0 });
      checkActive();
      if (framework === 'angular')
        writeFileSync(
          join(consumer, 'angular/.native-proxy.json'),
          JSON.stringify({
            '^/api(?:/|\\?|$)': { target: proxy.url, followRedirects: false },
          }) + '\n',
          { flag: 'wx' }
        );
      let cliUpdate = deferred();
      let viteUrl,
        serverGreen = framework === 'react',
        checkerGreen = false;
      function changed() {
        cliUpdate.resolve();
        cliUpdate = deferred();
      }
      const [vite, checker] = developmentCommands(
        consumer,
        options,
        proxy.url,
        env
      );
      launch(vite, (line) => {
        const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
        if (framework === 'angular') {
          if (
            /Building\.\.\.|Changes detected\. Rebuilding|Application bundle generation failed/.test(
              clean
            )
          ) {
            serverGreen = false;
            changed();
          } else if (/Application bundle generation complete\./.test(clean)) {
            serverGreen = true;
            changed();
          }
        }
        const address = clean.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
        if (address) {
          if (address[1] !== `http://127.0.0.1:${options.port}/`) {
            fail(
              new Error(
                'Development server announced a different port; refusing fallback'
              )
            );
            return;
          }
          viteUrl = address[1];
          changed();
        } else if (line.trim()) log(line);
      });
      launch(checker, (line) => {
        if (line.trim()) log(line);
        const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
        if (framework === 'angular') {
          if (
            /Starting incremental compilation|Compilation failed\.|error (?:TS|NG)\d+/.test(
              clean
            )
          ) {
            checkerGreen = false;
            changed();
          } else if (
            /Compilation complete\. Watching for file changes\./.test(clean)
          ) {
            checkerGreen = true;
            changed();
          }
          return;
        }
        if (/Starting (?:incremental )?compilation/.test(line)) {
          checkerGreen = false;
          changed();
        }
        const checked = line.match(
          /Found (\d+) errors?\. Watching for file changes\./
        );
        if (checked) {
          checkerGreen = Number(checked[1]) === 0;
          changed();
        }
      });
      while (!viteUrl || !serverGreen || !checkerGreen)
        await Promise.race([cliUpdate.promise, cancelled.promise]);
      checkActive();
      if (
        !isDeepStrictEqual(
          initialFrozen,
          frozenInputFingerprint(root, framework)
        )
      )
        throw new Error(
          'Frozen development inputs changed; restart the native example to rebuild and reinstall'
        );
      clearTimeout(timer);
      log(`Native conversation ready: ${viteUrl}`);
      readiness.resolve({ url: viteUrl, consumer });
    } catch (error) {
      fail(error);
    } finally {
      startupSettled.resolve();
    }
  })();
  return {
    ready: readiness.promise,
    closed: completion.promise,
    close,
    temporary,
  };
}
