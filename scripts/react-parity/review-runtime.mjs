import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const buildCommand =
  'NX_DAEMON=false npx nx run-many -t build -p core,angular,react --skip-nx-cache';
const manualOrder =
  'Use three Load clicks (saved, equal refresh, empty); Send → Tool → Error → Hold → Stop → Pause → Stop → Resume → Resume → Drop → Reconnect → Send → Unmount → Dispose → Send after dispose → Resume after dispose → Reconnect after dispose. Resume answers both approvals, then the final confirmation. Reconnect joins the dropped run without resubmitting. Only three Load requests and one Drop are available per server; restart this command for a fresh review. Reloading the page does not reset server state.';

function prerequisites(root) {
  const missing = ['core', 'angular', 'react'].filter(
    (kind) => !existsSync(join(root, 'dist/libs', kind, 'package.json'))
  );
  if (missing.length)
    throw new Error(
      `Prebuilt artifacts missing: ${missing.join(
        ', '
      )}. Build them first:\n${buildCommand}`
    );
}

function sourceProvenance(root) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const paths = [
    'libs/langgraph/src/runtime',
    'libs/langgraph/src/lib/transport',
    'fixtures/react-parity/runtime',
    'scripts/react-parity/runtime-consumer.mjs',
    'scripts/react-parity/review-runtime.mjs',
  ];
  return {
    head: git('rev-parse', 'HEAD'),
    trackedRuntimeFixtureStatus: git(
      'status',
      '--short',
      '--untracked-files=no',
      '--',
      ...paths
    ),
    untrackedRuntimeFixtureFiles: git(
      'ls-files',
      '--others',
      '--exclude-standard',
      '--',
      ...paths
    )
      .split('\n')
      .filter(Boolean),
  };
}

/** Worker-only preparation. Vite may change NODE_ENV; each framework gets a
 * fresh process so npm always installs its locked compiler/build dev tooling. */
async function prepare(kind, root, temporary) {
  if (!['react', 'angular'].includes(kind))
    throw new Error('Unknown review framework');
  const { packLocalArtifacts, installConsumer, runConsumer } = await import(
    './verify-packages.mjs'
  );
  const { lockedAngularManifest, angularBuildCommand } = await import(
    './verify-angular-package.mjs'
  );
  const { lockedReactManifest, prepareInstalledTypes, prepareRuntimeConsumer } =
    await import('./runtime-consumer.mjs');
  const directory = join(temporary, kind);
  const packed = join(directory, 'packed');
  const consumer = join(directory, 'consumer');
  mkdirSync(packed, { recursive: true });
  mkdirSync(consumer);
  const tarballs = packLocalArtifacts(root, packed, [kind]);
  const lock = JSON.parse(
    readFileSync(join(root, 'package-lock.json'), 'utf8')
  );
  let manifest;
  if (kind === 'angular') {
    cpSync(join(root, 'fixtures/react-parity/consumers/angular'), consumer, {
      recursive: true,
    });
    manifest = lockedAngularManifest(
      JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8')),
      lock
    );
  } else manifest = lockedReactManifest(lock);
  installConsumer(
    consumer,
    manifest,
    tarballs,
    kind === 'react' ? 'plain' : 'angular'
  );
  prepareInstalledTypes(root, consumer, kind);
  await prepareRuntimeConsumer(root, consumer, kind);
  for (const config of [
    'tsconfig.contracts.json',
    ...(kind === 'react' ? ['tsconfig.app.json'] : []),
  ]) {
    runConsumer(
      process.execPath,
      [join(consumer, 'node_modules/typescript/bin/tsc'), '-p', config],
      consumer
    );
  }
  console.log(
    runConsumer(
      process.execPath,
      kind === 'angular'
        ? angularBuildCommand(consumer)
        : [join(consumer, 'node_modules/vite/bin/vite.js'), 'build'],
      consumer
    )
  );
  const artifacts = Object.entries(tarballs).map(([name, uri]) => {
    const path = uri.slice('file:'.length);
    return {
      name,
      path,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    };
  });
  writeFileSync(
    join(temporary, `${kind}.json`),
    JSON.stringify({
      directory: join(
        consumer,
        kind === 'angular' ? 'dist/consumer/browser' : 'dist'
      ),
      artifacts,
    })
  );
}

function preparationChild(worker, kind, root, temporary, output) {
  const env = {
    ...process.env,
    NG_CLI_ANALYTICS: 'false',
    npm_config_include: 'dev',
    TMPDIR: temporary,
  };
  for (const key of Object.keys(env)) {
    if (
      key === 'NODE_ENV' ||
      /^npm_config_(omit|production|only|include)$/i.test(key)
    )
      delete env[key];
  }
  env.npm_config_include = 'dev';
  const child = spawn(
    process.execPath,
    [worker, '--prepare', kind, root, temporary],
    {
      cwd: root,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    }
  );
  child.stdout.on('data', (chunk) => output(String(chunk)));
  child.stderr.on('data', (chunk) => output(String(chunk)));
  let failure;
  child.once('error', (error) => {
    failure = error;
  });
  const done = new Promise((resolve, reject) =>
    child.once('close', (code, signal) => {
      if (failure || code !== 0)
        reject(
          new Error(`${kind} preparation failed (${signal ?? code})`, {
            cause: failure,
          })
        );
      else resolve();
    })
  );
  // Observe a late failure even when an abort has already taken ownership.
  void done.catch(() => undefined);
  return { child, done };
}

async function terminate(preparation, killProcessGroup) {
  if (!preparation) return;
  // Abort and startup failure can reach the same preparation concurrently.
  // Share one bounded cleanup attempt, including its failure.
  preparation.termination ??= Promise.resolve().then(async () => {
    const { child, done } = preparation;
    let closed = false;
    void done.then(
      () => {
        closed = true;
      },
      () => {
        closed = true;
      }
    );
    let groupGone = !child.pid;
    let permissionError;
    const signal = (value) => {
      if (groupGone) return;
      try {
        killProcessGroup(-child.pid, value);
      } catch (error) {
        if (error.code === 'ESRCH') groupGone = true;
        // macOS can report EPERM while a zombie-only group is being reaped.
        // Retain ownership until a later ESRCH; denial is never exit proof.
        else if (error.code === 'EPERM') permissionError = error;
        else throw error;
      }
    };
    const started = Date.now();
    let escalated = false;
    signal('SIGTERM');
    while (!groupGone || !closed) {
      const elapsed = Date.now() - started;
      if (!groupGone && !escalated && elapsed >= 2000) {
        escalated = true;
        signal('SIGKILL');
      }
      if (!groupGone) signal(0);
      if (groupGone && closed) break;
      if (elapsed >= 5000) {
        throw new Error(
          'Preparation process group did not exit; temporary files retained',
          { cause: permissionError }
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });
  return preparation.termination;
}

/** Bounded review lifecycle. Worker/verify/serve seams let tests exercise real
 * process cleanup without reinstalling frameworks for every failure case. */
export async function startRuntimeReview({
  root = process.cwd(),
  signal,
  signals = process,
  log = console.log,
  worker = script,
  onWorkerOutput = (text) => log(text.trimEnd()),
  killProcessGroup = (pid, signal) => process.kill(pid, signal),
  verify = async (directory, kind) =>
    (await import('./runtime-consumer.mjs')).runRuntimeScenarios(
      directory,
      kind
    ),
  serve = async (directory) =>
    (await import('./runtime-consumer.mjs')).serveRuntimeConsumer(directory),
} = {}) {
  root = resolve(root);
  const temporary = mkdtempSync(join(tmpdir(), 'threadplane-runtime-review-'));
  const servers = [];
  let preparation;
  let activePhase;
  let stopping = false;
  let closing;
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const checkActive = () => {
    if (stopping) throw new Error('Review startup aborted');
  };
  const close = () => {
    stopping = true;
    if (!closing)
      closing = (async () => {
        try {
          await terminate(preparation, killProcessGroup);
          await activePhase;
          const results = await Promise.allSettled(
            servers.map((server) => server.close())
          );
          rmSync(temporary, { recursive: true, force: true });
          const failures = results.filter(
            (result) => result.status === 'rejected'
          );
          if (failures.length)
            throw new AggregateError(
              failures.map((result) => result.reason),
              'Review servers failed to close'
            );
        } finally {
          signal?.removeEventListener('abort', stop);
          signals.removeListener('SIGINT', stop);
          signals.removeListener('SIGTERM', stop);
          resolveClosed();
        }
      })();
    return closing;
  };
  const stop = () => {
    void close().catch((error) => {
      log(String(error));
      process.exitCode = 1;
    });
  };
  // Register cleanup before calling any preparation or serving effect.
  signal?.addEventListener('abort', stop, { once: true });
  signals.on('SIGINT', stop);
  signals.on('SIGTERM', stop);
  if (signal?.aborted) stop();
  async function phase(work) {
    checkActive();
    let complete;
    const pending = new Promise((resolve) => {
      complete = resolve;
    });
    activePhase = pending;
    try {
      return await work();
    } finally {
      complete();
      if (activePhase === pending) activePhase = undefined;
    }
  }
  try {
    checkActive();
    prerequisites(root);
    const provenance = sourceProvenance(root);
    const prepared = {};
    for (const kind of ['react', 'angular']) {
      await phase(async () => {
        preparation = preparationChild(
          worker,
          kind,
          root,
          temporary,
          onWorkerOutput
        );
        await preparation.done;
        await terminate(preparation, killProcessGroup);
        preparation = undefined;
      });
      checkActive();
      prepared[kind] = JSON.parse(
        readFileSync(join(temporary, `${kind}.json`), 'utf8')
      );
      await phase(() => verify(prepared[kind].directory, kind));
    }
    const urls = {};
    for (const kind of ['react', 'angular']) {
      await phase(async () => {
        const server = await serve(prepared[kind].directory, kind);
        servers.push(server);
        urls[kind] = server.url;
      });
    }
    checkActive();
    const artifacts = Object.entries(prepared).flatMap(([framework, value]) =>
      value.artifacts.map((artifact) => ({ framework, ...artifact }))
    );
    log(`Source checkout: ${JSON.stringify(provenance)}`);
    log(
      'Source HEAD is checkout provenance only; prebuilt artifacts are not proven to have been built from this HEAD. Packed SHA256 identifiers describe the actual installed bytes.'
    );
    log(`Packed artifacts: ${JSON.stringify(artifacts)}`);
    log(`Review ready: React ${urls.react} | Angular ${urls.angular}`);
    log(manualOrder);
    log(
      'These untouched loopback servers have performed no SDK I/O. Open either URL manually. Ctrl+C stops both servers and removes temporary consumers.'
    );
    checkActive();
    return { temporary, urls, provenance, artifacts, close, closed };
  } catch (error) {
    const aborted = stopping;
    await close();
    if (aborted) throw new Error('Review startup aborted', { cause: error });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  try {
    if (process.argv[2] === '--prepare')
      await prepare(
        process.argv[3],
        resolve(process.argv[4]),
        resolve(process.argv[5])
      );
    else if (process.argv[2] === '--help')
      console.log(
        `Installed runtime review\nPrerequisite: build the private package artifacts first:\n${buildCommand}\nRun: node scripts/react-parity/review-runtime.mjs\n${manualOrder}`
      );
    else {
      const review = await startRuntimeReview();
      await review.closed;
    }
  } catch (error) {
    if (error.message === 'Review startup aborted')
      console.log('Review stopped.');
    else {
      console.error(error);
      process.exitCode = 1;
    }
  }
}
