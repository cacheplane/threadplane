/** Import-inert canonical A2UI preparation and explicit private proof entry point. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants,
  accessSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir as systemTmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function parsePreparationArguments(args) {
  assert.ok(
    Array.isArray(args) &&
      args.length <= 1 &&
      args.every((flag) => ['--serve', '--verify-application'].includes(flag)),
    'Choose preparation, --serve or --verify-application'
  );
  return {
    serve: args[0] === '--serve',
    verifyApplication: args[0] === '--verify-application',
  };
}
function tool(name, override) {
  const choices = override
    ? [override]
    : (process.env.PATH ?? '')
        .split(delimiter)
        .map((directory) => join(directory, name));
  for (const path of choices) {
    try {
      assert.ok(isAbsolute(path));
      accessSync(path, constants.X_OK);
      return realpathSync(path);
    } catch {
      /* Inspect only explicitly selected executable search paths. */
    }
  }
  throw Error('Existing executable required: ' + name);
}
function identity(pid, env) {
  const check = spawnSync(
    '/bin/ps',
    ['-p', String(pid), '-o', 'pid=,ppid=,pgid=,lstart='],
    { env, encoding: 'utf8', timeout: 2000, maxBuffer: 65536 }
  );
  if (
    !check.error &&
    check.status === 0 &&
    check.stdout.trim() &&
    !check.stderr.trim()
  )
    return check.stdout.trim();
  if (
    !check.error &&
    check.status === 1 &&
    !check.stdout.trim() &&
    !check.stderr.trim()
  )
    return null;
  throw Error('Owned process identity unknown');
}
function group(pgid, env) {
  const check = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], {
    env,
    encoding: 'utf8',
    timeout: 2000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.ok(
    !check.error && check.status === 0 && !check.stderr.trim(),
    'Owned group snapshot unknown'
  );
  return check.stdout
    .split('\n')
    .filter((line) => line.trim().split(/\s+/)[2] === String(pgid));
}
/** Every child owns its own group; bounded logs and closure receipts survive failure. */
export async function runPreparationStage({
  executable,
  args,
  env,
  timeoutMs,
  retain,
  name,
  spawnChild = spawn,
  observeIdentity = identity,
  observeGroup = group,
  signalGroup = process.kill,
  allowInterrupt = false,
  drainTimeoutMs = 12000,
}) {
  assert.ok(
    Number.isInteger(drainTimeoutMs) &&
      drainTimeoutMs > 0 &&
      drainTimeoutMs <= 12000,
    'Bounded drain required'
  );
  const receipt = {
    executable,
    args,
    timeoutMs,
    stdoutEOF: false,
    stderrEOF: false,
    reaped: false,
    errors: [],
    signals: [],
    seen: { stdout: 0, stderr: 0 },
  };
  const parts = { stdout: [], stderr: [] };
  let child,
    initial,
    timer,
    killTimer,
    outerTimer,
    closed,
    failure,
    wake,
    drained = false,
    interrupted = false;
  const failureWake = new Promise((resolveWake) => {
    wake = resolveWake;
  });
  async function drain() {
    if (!closed || drained) return;
    drained = true;
    let drainTimer;
    try {
      await Promise.race([
        closed,
        new Promise((resolveDrain) => {
          drainTimer = setTimeout(resolveDrain, drainTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(drainTimer);
    }
  }
  function record(error) {
    if (receipt.errors.length < 16)
      receipt.errors.push(String(error).slice(0, 2048));
    else receipt.errorOverflow = true;
  }
  function signal(selected) {
    if (!child?.pid) return;
    try {
      const now = observeIdentity(child.pid, env);
      if (
        now !== null &&
        now === initial &&
        now.split(/\s+/)[2] === String(child.pid)
      ) {
        signalGroup(-child.pid, selected);
        receipt.signals.push(selected);
      } else if (now !== null || observeGroup(child.pid, env).length)
        record('Unknown process authority; signal withheld');
    } catch (error) {
      record(error);
    }
  }
  function stop(error) {
    if (error) {
      failure ??= error;
      record(error);
    }
    signal('SIGTERM');
    killTimer ??= setTimeout(() => signal('SIGKILL'), 2000);
    wake();
  }
  const term = () => {
    interrupted = true;
    stop(allowInterrupt ? undefined : Error('Parent interrupted stage'));
  };
  process.once('SIGTERM', term);
  process.once('SIGINT', term);
  try {
    child = spawnChild(executable, args, {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    // Install all resource listeners before fallible identity, assertions or writes.
    closed = new Promise((resolveClose) => {
      child.once('error', (error) => stop(error));
      for (const [key, stream, cap] of [
        ['stdout', child.stdout, 4 * 1024 * 1024],
        ['stderr', child.stderr, 8 * 1024 * 1024],
      ]) {
        stream.once('end', () => {
          receipt[key + 'EOF'] = true;
        });
        stream.on('error', (error) => stop(error));
        stream.on('data', (bytes) => {
          const remaining = Math.max(0, cap - receipt.seen[key]);
          if (remaining) parts[key].push(bytes.subarray(0, remaining));
          receipt.seen[key] += bytes.length;
          if (receipt.seen[key] > cap && !failure)
            stop(Error(key + ' output bound'));
        });
      }
      child.once('close', (code, exitSignal) => {
        receipt.code = code;
        receipt.exitSignal = exitSignal;
        receipt.reaped = true;
        resolveClose();
      });
    });
    receipt.pid = child.pid;
    initial = child.pid ? observeIdentity(child.pid, env) : undefined;
    receipt.identity = initial;
    assert.ok(
      initial && initial.split(/\s+/)[2] === String(child.pid),
      'Exclusive child group required'
    );
    writeFileSync(
      join(retain, name + '-initial.json'),
      JSON.stringify(receipt, null, 2) + '\n'
    );
    timer = setTimeout(
      () => stop(Error('Preparation stage deadline: ' + name)),
      timeoutMs
    );
    await Promise.race([
      closed,
      failureWake,
      new Promise((_, reject) => {
        outerTimer = setTimeout(
          () => reject(Error('Preparation stage shutdown deadline')),
          timeoutMs + drainTimeoutMs
        );
      }),
    ]);
    if (!receipt.reaped) await drain();
    if (failure) throw failure;
    if (receipt.code !== 0)
      failure ??= Error('Preparation stage exited unsuccessfully: ' + name);
    if (interrupted && !allowInterrupt)
      failure ??= Error('Parent interrupted stage');
  } catch (error) {
    failure ??= error;
    record(error);
    stop();
    await drain();
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    clearTimeout(outerTimer);
    process.removeListener('SIGTERM', term);
    process.removeListener('SIGINT', term);
    try {
      receipt.knownChildAbsent = child?.pid
        ? observeIdentity(child.pid, env) === null
        : true;
      receipt.groupMembers = child?.pid ? observeGroup(child.pid, env) : [];
    } catch (error) {
      record(error);
    }
    receipt.closure =
      receipt.reaped &&
      receipt.stdoutEOF &&
      receipt.stderrEOF &&
      receipt.knownChildAbsent &&
      receipt.groupMembers?.length === 0;
    if (!receipt.closure) {
      failure ??= Error('Preparation child closure unknown: ' + name);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
    }
    if (receipt.errors.length || receipt.errorOverflow)
      failure ??= Error('Preparation lifecycle evidence contains failures');
    receipt.failure = failure && String(failure).slice(0, 2048);
    writeFileSync(
      join(retain, name + '-stdout.log'),
      Buffer.concat(parts.stdout)
    );
    writeFileSync(
      join(retain, name + '-stderr.log'),
      Buffer.concat(parts.stderr)
    );
    writeFileSync(
      join(retain, name + '-result.json'),
      JSON.stringify(receipt, null, 2) + '\n'
    );
  }
  if (failure) throw failure;
  return {
    code: receipt.code,
    stdout: Buffer.concat(parts.stdout).toString(),
    stderr: Buffer.concat(parts.stderr).toString(),
  };
}

export async function prepareAgUiA2uiFixture({
  parent = process.env.THREADPLANE_AGUI_A2UI_APPLICATION_ROOT,
  verifyApplication = false,
  run = runPreparationStage,
  tools,
  prove,
} = {}) {
  const outerDeadline = Date.now() + 1200000;
  const ownedParent = parent
    ? resolve(parent)
    : mkdtempSync(join(systemTmpdir(), 'threadplane-agui-a2ui-application-'));
  mkdirSync(ownedParent, { recursive: true });
  const attempt = mkdtempSync(join(ownedParent, 'attempt-'));
  const runtime = mkdtempSync(
    join(systemTmpdir(), 'threadplane-agui-a2ui-runtime-')
  );
  const paths = {
    attempt,
    retain: join(attempt, 'application'),
    environment: join(runtime, 'python'),
    home: join(runtime, 'home'),
    tmpdir: join(runtime, 'tmp'),
  };
  for (const name of ['home', 'tmp', 'uv-cache', 'npm-cache'])
    mkdirSync(join(runtime, name));
  for (const name of ['empty-user.npmrc', 'empty-global.npmrc'])
    writeFileSync(join(runtime, name), '');
  const selected = tools ?? {
    uv: tool('uv', process.env.THREADPLANE_AGUI_A2UI_UV),
    python: tool('python3.12', process.env.THREADPLANE_AGUI_A2UI_PYTHON),
  };
  for (const path of Object.values(selected))
    assert.ok(isAbsolute(path), 'Absolute measured tool required');
  const env = {
    PATH: [
      ...new Set([
        dirname(process.execPath),
        dirname(selected.uv),
        dirname(selected.python),
        '/usr/bin',
        '/bin',
      ]),
    ].join(delimiter),
    HOME: paths.home,
    TMPDIR: paths.tmpdir,
    UV_CACHE_DIR: join(runtime, 'uv-cache'),
    UV_PROJECT_ENVIRONMENT: paths.environment,
    UV_PYTHON: selected.python,
    UV_PYTHON_DOWNLOADS: 'never',
    UV_NO_CONFIG: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    NX_LOAD_DOT_ENV_FILES: 'false',
    NX_DAEMON: 'false',
    NX_ISOLATE_PLUGINS: 'false',
    CI: 'true',
    npm_config_cache: join(runtime, 'npm-cache'),
    npm_config_userconfig: join(runtime, 'empty-user.npmrc'),
    npm_config_globalconfig: join(runtime, 'empty-global.npmrc'),
  };
  const project = join(root, 'cockpit/ag-ui/a2ui/python');
  const hashes = () =>
    Object.fromEntries(
      ['pyproject.toml', 'uv.lock', 'src/graph.py', 'src/server.py'].map(
        (name) => [
          name,
          createHash('sha256')
            .update(readFileSync(join(project, name)))
            .digest('hex'),
        ]
      )
    );
  const before = hashes(),
    report = { paths, selected, before, stages: [] };
  const execute = (specification) => {
    const remaining = outerDeadline - Date.now();
    assert.ok(remaining > 0, 'Preparation total deadline');
    const invocation = {
      ...specification,
      timeoutMs: Math.min(specification.timeoutMs, remaining),
    };
    report.stages.push({
      name: invocation.name,
      executable: invocation.executable,
      args: invocation.args,
      timeoutMs: invocation.timeoutMs,
    });
    return run(invocation);
  };
  try {
    if (!tools)
      report.toolHashes = Object.fromEntries(
        Object.entries(selected).map(([name, path]) => [
          name,
          {
            path,
            sha256: createHash('sha256')
              .update(readFileSync(path))
              .digest('hex'),
          },
        ])
      );
    const measured = await execute({
      executable: selected.python,
      args: ['--version'],
      env,
      timeoutMs: 10000,
      retain: attempt,
      name: 'python-version',
    });
    assert.match(
      measured.stdout,
      /^Python 3\.12\./,
      'Existing measured Python 3.12 required'
    );
    report.pythonVersion = measured.stdout.trim();
    await execute({
      executable: selected.uv,
      args: [
        'sync',
        '--frozen',
        '--no-install-project',
        '--no-dev',
        '--no-config',
        '--no-python-downloads',
        '--python',
        selected.python,
        '--project',
        project,
      ],
      env,
      timeoutMs: 300000,
      retain: attempt,
      name: 'frozen-python',
    });
    paths.python = join(paths.environment, 'bin/python');
    if (verifyApplication) {
      const { selectPresentationLock, reactAgUiPresentationSeeds } =
        await import('../react-parity/markdown-presentation-build.mjs');
      const lockBytes = readFileSync(join(root, 'package-lock.json'));
      const packages = selectPresentationLock(
        JSON.parse(lockBytes),
        reactAgUiPresentationSeeds,
        { rxjs: '~7.8.0' }
      );
      const urls = [
        ...new Set(
          Object.values(packages).map((record) => {
            const url = new URL(record.resolved);
            assert.ok(
              url.protocol === 'https:' &&
                url.hostname === 'registry.npmjs.org' &&
                !url.username &&
                !url.password &&
                !url.port &&
                !url.search &&
                !url.hash &&
                url.pathname.endsWith('.tgz'),
              'Exact reviewed public registry tarball required'
            );
            return url.href;
          })
        ),
      ];
      const npm = tools?.npm ?? tool('npm');
      report.publicCache = {
        profile: 'react-native-a2ui-ag-ui',
        rootLockSha256: createHash('sha256').update(lockBytes).digest('hex'),
        npm,
        packages,
      };
      if (!tools)
        report.publicCache.npmSha256 = createHash('sha256')
          .update(readFileSync(npm))
          .digest('hex');
      writeFileSync(
        join(attempt, 'public-cache-inputs.json'),
        JSON.stringify(report.publicCache, null, 2) + '\n'
      );
      await execute({
        executable: process.execPath,
        args: [
          npm,
          'cache',
          'add',
          ...urls,
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--fetch-retries=0',
          '--fetch-timeout=60000',
          '--maxsockets=4',
          '--registry=https://registry.npmjs.org/',
        ],
        env,
        timeoutMs: 300000,
        retain: attempt,
        name: 'public-package-cache',
      });
      // This opt-in child is the bounded actual manager proof; pure specs keep it skipped.
      await execute({
        executable: process.execPath,
        args: [
          '--test',
          '--test-timeout=60000',
          '--test-name-pattern=^actual canonical manager',
          join(root, 'scripts/react-cockpit/ag-ui-a2ui-fixture.spec.mjs'),
        ],
        env: {
          ...env,
          THREADPLANE_AGUI_A2UI_MANAGER_OPTIONS: JSON.stringify({
            retain: join(attempt, 'canonical-manager'),
            python: paths.python,
            environment: paths.environment,
            home: paths.home,
            tmpdir: paths.tmpdir,
          }),
        },
        timeoutMs: 90000,
        retain: attempt,
        name: 'actual-canonical-manager',
      });
      const options = {
        root,
        retain: paths.retain,
        python: paths.python,
        environment: paths.environment,
        home: paths.home,
        tmpdir: paths.tmpdir,
      };
      if (prove) await prove(options);
      else
        await execute({
          executable: process.execPath,
          args: [
            join(root, 'scripts/react-cockpit/ag-ui-a2ui-native-probe.mjs'),
            ...['retain', 'python', 'environment', 'home', 'tmpdir'].flatMap(
              (name) => ['--' + name, options[name]]
            ),
          ],
          env,
          timeoutMs: 600000,
          retain: attempt,
          name: 'installed-application',
        });
    }
    report.status = 'prepared';
    return { ...paths, env };
  } catch (error) {
    report.status = 'failed';
    report.error = String(error).slice(0, 2048);
    throw error;
  } finally {
    report.after = hashes();
    writeFileSync(
      join(attempt, 'preparation.json'),
      JSON.stringify(report, null, 2) + '\n'
    );
    assert.deepEqual(report.after, before, 'Frozen canonical source drift');
  }
}

/** Own only the already-prepared browser service; preparation has its own deadline. */
export const BROWSER_SERVER_FALLBACK_MS = 35 * 60 * 1000;
export function servePreparedAgUiA2uiFixture(result, { run = runPreparationStage } = {}) {
  return run({
    executable: process.execPath,
    args: [
      join(root, 'scripts/react-cockpit/serve.mjs'),
      'ag-ui-a2ui',
      '--no-parent',
    ],
    env: {
      ...result.env,
      THREADPLANE_AGUI_A2UI_BROWSER_RUNTIME: JSON.stringify({
        python: result.python,
        environment: result.environment,
        home: result.home,
        tmpdir: result.tmpdir,
      }),
      THREADPLANE_AGUI_A2UI_BROWSER_RETAIN: join(result.attempt, 'browser'),
    },
    timeoutMs: BROWSER_SERVER_FALLBACK_MS,
    retain: result.attempt,
    name: 'browser-server',
    allowInterrupt: true,
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const mode = parsePreparationArguments(process.argv.slice(2));
    const result = await prepareAgUiA2uiFixture(mode);
    console.log(
      JSON.stringify({
        status: 'prepared',
        attempt: result.attempt,
        installedApplication: mode.verifyApplication,
      })
    );
    if (mode.serve) {
      await servePreparedAgUiA2uiFixture(result);
    }
  } catch {
    console.error(
      'Native A2UI preparation or owned closure failed; retained attempt contains diagnostics.'
    );
    process.exitCode = 1;
  }
}
