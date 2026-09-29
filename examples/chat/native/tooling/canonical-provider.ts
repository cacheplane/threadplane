import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { observeProvider } from './canonical-provider-observer';
export { observeProvider } from './canonical-provider-observer';
import { createServer as reservation } from 'node:net';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { startAimock } from '../../../../libs/e2e-harness/src/aimock-runner';
import { preparationEnvironment } from './commands.mjs';
import { buildInputRoots, inputFingerprint } from './build-workspace.mjs';
import { frozenInputFingerprint } from './source-mirror.mjs';
import { terminateOwnedProcess } from './serve.mjs';

interface Command {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}
interface Running {
  pid: number;
  done: Promise<string>;
  output(): string;
}
interface Context {
  root: string;
  temporary: string;
  consumer: string;
  provider: string;
  ownerCleanupPath: string;
  port: number;
  env: NodeJS.ProcessEnv;
  run(name: string, command: Command, persistent?: boolean): Running;
}
interface Operations {
  prepare?(context: Context): Promise<void>;
  providerCommand?(context: Context): Promise<Command>;
  exercise?(
    context: Context & { url: string; modelUrl: string }
  ): Promise<Record<string, unknown>>;
}
export interface Options {
  root: string;
  temporaryParent?: string;
  signal?: AbortSignal;
  port?: number;
  operations?: Operations;
  timeoutMs?: number;
  evidenceDirectory?: string;
  onChild?(name: string, pid: number): void;
  killProcessGroup?(pid: number, signal: NodeJS.Signals | 0): boolean;
}
const sha = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function inventory(directory: string, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of readdirSync(join(directory, prefix)).sort()) {
    const local = join(prefix, name),
      path = join(directory, local),
      stat = lstatSync(path);
    assert.equal(
      stat.isSymbolicLink(),
      false,
      'No provider source links: ' + path
    );
    if (name === '__pycache__' || name.endsWith('.pyc')) continue;
    assert.ok(!name.startsWith('.'), 'No hidden provider source: ' + path);
    if (stat.isDirectory()) Object.assign(result, inventory(directory, local));
    else {
      assert.ok(stat.isFile());
      result[local] = sha(readFileSync(path));
    }
  }
  return result;
}
function copyProvider(root: string, provider: string) {
  const source = join(root, 'examples/chat/python');
  assert.equal(lstatSync(source).isSymbolicLink(), false);
  assert.equal(lstatSync(join(source, 'src')).isSymbolicLink(), false);
  const files: Record<string, string> = {};
  for (const name of ['pyproject.toml', 'uv.lock', 'langgraph.json']) {
    assert.ok(lstatSync(join(source, name)).isFile());
    files[name] = sha(readFileSync(join(source, name)));
  }
  for (const [name, hash] of Object.entries(inventory(join(source, 'src'))))
    files['src/' + name] = hash;
  mkdirSync(provider);
  for (const [name, hash] of Object.entries(files)) {
    const target = join(provider, name);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(source, name), target);
    assert.equal(sha(readFileSync(target)), hash);
  }
  writeFileSync(join(provider, '.env'), '', { flag: 'wx' });
  return files;
}
async function reserve(port = 0) {
  const server = reservation();
  await new Promise<void>((yes, no) => {
    server.once('error', no);
    server.listen(port, '127.0.0.1', yes);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    port: address.port,
    close: () =>
      new Promise<void>((yes, no) => server.close((e) => (e ? no(e) : yes()))),
  };
}

async function prepare(context: Context) {
  const { root, temporary, env } = context;
  writeFileSync(
    join(temporary, 'frozen.json'),
    JSON.stringify(frozenInputFingerprint(root, 'react'))
  );
  await context.run('preparation', {
    command: process.execPath,
    args: [
      join(root, 'examples/chat/native/tooling/serve-worker.mjs'),
      '--prepare',
      root,
      temporary,
      JSON.stringify({
        framework: 'react',
        configuration: 'production',
        assistantId: 'chat',
      }),
    ],
    cwd: root,
    env,
  }).done;
  assert.ok(existsSync(join(temporary, 'prepared.json')));
}
async function providerCommand(context: Context): Promise<Command> {
  const { provider: cwd, env, port } = context;
  await context.run('python installation', {
    command: 'uv',
    args: ['sync', '--frozen', '--python', '3.12'],
    cwd,
    env,
  }).done;
  const help = await context.run('provider help', {
    command: 'uv',
    args: ['run', '--frozen', '--no-sync', 'langgraph', 'dev', '--help'],
    cwd,
    env,
  }).done;
  assert.match(help, /--host/);
  assert.match(help, /--no-reload/);
  const versionsPath = join(context.temporary, 'provider-versions.json');
  await context.run('provider versions', {
    command: 'uv',
    args: [
      'run',
      '--frozen',
      '--no-sync',
      'python',
      '-c',
      'import importlib.metadata as m,json,platform,sys;open(sys.argv[1],"x").write(json.dumps({"python":platform.python_version(),**{n:m.version(n) for n in ["langgraph","langgraph-api","langgraph-sdk","threadplane-middleware"]}}))',
      versionsPath,
    ],
    cwd,
    env,
  }).done;
  const actual = json(versionsPath);
  assert.equal(actual.langgraph, '1.1.10');
  assert.equal(actual['langgraph-api'], '0.8.7');
  return {
    command: 'uv',
    args: [
      'run',
      '--frozen',
      '--no-sync',
      'langgraph',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--no-browser',
      '--no-reload',
    ],
    cwd,
    env,
  };
}
async function exercise(
  context: Context & { url: string; modelUrl: string; controlUrl?: string },
  selected: ReturnType<typeof selectScenario>,
  proof: Record<string, unknown>
) {
  const { root, consumer, temporary, env } = context;
  mkdirSync(join(consumer, 'tooling'), { recursive: true });
  for (const name of selected.files)
    cpSync(
      join(root, 'examples/chat/native/tooling', name),
      join(consumer, 'tooling', name)
    );
  const executable = join(consumer, 'node_modules/typescript/bin/tsc');
  proof.compiler = {
    executable: relative(consumer, executable),
    sha256: sha(readFileSync(executable)),
    configuration: sha(readFileSync(join(consumer, selected.configuration))),
  };
  const output = await context.run('installed compiler', {
    command: process.execPath,
    args: [
      executable,
      '-p',
      selected.configuration,
      '--listFiles',
      '--pretty',
      'false',
    ],
    cwd: consumer,
    env,
  }).done;
  const inputs = Object.fromEntries(
    output
      .split(/\r?\n/)
      .filter(isAbsolute)
      .map((path) => {
        assert.ok(
          realpathSync(path).startsWith(consumer + sep),
          'Compiler input outside consumer: ' + path
        );
        return [relative(consumer, path), sha(readFileSync(path))];
      })
  );
  for (const path of [
    'shared/application.ts',
    'shared/directory.ts',
    'shared/approval.ts',
    'shared/trip-summary.ts',
    'node_modules/@threadplane/langgraph/runtime/create-session.d.ts',
    'node_modules/@threadplane/core/src/index.d.ts',
    'node_modules/@threadplane/content/src/markdown/index.d.ts',
    'node_modules/@langchain/langgraph-sdk/dist/index.d.ts',
  ])
    assert.ok(inputs[path], 'Installed declaration required: ' + path);
  const artifacts: Record<string, Record<string, string>> = {};
  for (const name of ['core', 'content', 'react', 'langgraph'])
    artifacts[name] = inventory(
      join(consumer, 'node_modules/@threadplane', name)
    );
  const tarballs = Object.fromEntries(
    readdirSync(temporary)
      .filter((name) => name.endsWith('.tgz'))
      .map((name) => [name, sha(readFileSync(join(temporary, name)))])
  );
  assert.equal(Object.keys(tarballs).length, 4);
  Object.assign(proof, {
    compiler: {
      executable: relative(consumer, executable),
      sha256: sha(readFileSync(executable)),
      inputs,
      configuration: sha(readFileSync(join(consumer, selected.configuration))),
    },
    installed: {
      lock: sha(readFileSync(join(consumer, 'package-lock.json'))),
      artifacts,
      tarballs,
      versions: Object.fromEntries(
        [
          'typescript',
          '@langchain/langgraph-sdk',
          '@threadplane/langgraph',
          '@threadplane/core',
          '@threadplane/content',
        ].map((name) => [
          name,
          json(join(consumer, 'node_modules', name, 'package.json')).version,
        ])
      ),
    },
  });
  const resultPath = join(temporary, 'session-result.json');
  await context.run('installed cleanup control', {
    command: process.execPath,
    args: ['--test', join(consumer, selected.control)],
    cwd: consumer,
    env,
  }).done;
  try {
    await context.run('installed session', {
      command: process.execPath,
      args: [
        join(consumer, selected.entry),
        context.url,
        context.modelUrl,
        resultPath,
        context.ownerCleanupPath,
        ...(context.controlUrl ? [context.controlUrl] : []),
      ],
      cwd: consumer,
      env,
    }).done;
  } finally {
    // A failing owner can still have saved useful results before cleanup failed.
    if (existsSync(resultPath)) Object.assign(proof, json(resultPath));
  }
  return proof;
}

type Scenario = 'approval' | 'trip-summary' | 'backup-effect';
function selectScenario(scenario: Scenario) {
  assert.ok(
    scenario === 'approval' ||
      scenario === 'trip-summary' ||
      scenario === 'backup-effect',
    'Unknown or unavailable canonical scenario'
  );
  if (scenario === 'backup-effect')
    return {
      fixture: 'examples/chat/native/tooling/fixtures/backup-effect.json',
      files: [
        'backup-provider-consumer.ts',
        'backup-provider-consumer.spec.ts',
        'backup-provider-contract.ts',
        'tsconfig.backup-provider.json',
      ],
      configuration: 'tooling/tsconfig.backup-provider.json',
      entry: 'provider-output/tooling/backup-provider-consumer.js',
      control: 'provider-output/tooling/backup-provider-consumer.spec.js',
    } as const;
  if (scenario === 'trip-summary')
    return {
      fixture: 'examples/chat/native/tooling/fixtures/trip-summary.json',
      files: [
        'trip-summary-provider-consumer.ts',
        'trip-summary-provider-consumer.spec.ts',
        'trip-summary-provider-contract.ts',
        'tsconfig.trip-summary-provider.json',
      ],
      configuration: 'tooling/tsconfig.trip-summary-provider.json',
      entry: 'provider-output/tooling/trip-summary-provider-consumer.js',
      control: 'provider-output/tooling/trip-summary-provider-consumer.spec.js',
    } as const;
  return {
    fixture: 'examples/chat/angular/e2e/fixtures/interrupt-approval.json',
    files: [
      'approval-provider-consumer.ts',
      'approval-provider-consumer.spec.ts',
      'tsconfig.approval-provider.json',
    ],
    configuration: 'tooling/tsconfig.approval-provider.json',
    entry: 'provider-output/tooling/approval-provider-consumer.js',
    control: 'provider-output/tooling/approval-provider-consumer.spec.js',
  } as const;
}

/** Own resources and capture facts; only a concrete entry may accept them. */
export async function runCanonicalProvider(
  scenario: Scenario,
  options: Options
) {
  const selected = selectScenario(scenario);
  const root = realpathSync(options.root),
    env = preparationEnvironment();
  const sources = inputFingerprint(root, buildInputRoots(root, 'react'));
  const additionalInputs = Object.fromEntries(
    ['libs/e2e-harness/src/aimock-runner.ts', selected.fixture].map((path) => [
      path,
      sha(readFileSync(join(root, path))),
    ])
  );
  const temporary = realpathSync(
    mkdtempSync(
      join(options.temporaryParent ?? tmpdir(), 'native-approval-provider-')
    )
  );
  const records: {
    name: string;
    child: ChildProcess;
    closed: boolean;
    termination?: Promise<void>;
  }[] = [];
  const logs: Record<string, string> = {};
  let closing = false,
    failure: Error | undefined;
  let rejectFailure!: (error: Error) => void;
  const failed = new Promise<never>((_yes, no) => {
    rejectFailure = no;
  });
  void failed.catch(() => {});
  const fail = (error: Error) => {
    failure ??= error;
    rejectFailure(error);
  };
  const abort = () => fail(new Error('Approval provider aborted'));
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(
    () => fail(new Error('Approval provider deadline exceeded')),
    options.timeoutMs ?? 300_000
  );
  const active = () => {
    if (failure) throw failure;
    assert.equal(closing, false, 'Provider lifetime closed');
  };
  const run: Context['run'] = (name, command, persistent = false) => {
    active();
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: command.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = { name, child, closed: false };
    records.push(record);
    logs[name] = '';
    if (child.pid) options.onChild?.(name, child.pid);
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (chunk) => {
        logs[name] += String(chunk);
        if (logs[name].length > 4_000_000)
          fail(new Error('Provider diagnostic limit exceeded'));
      });
    const done = new Promise<string>((yes, no) => {
      child.once('error', (error) => {
        no(error);
        fail(error);
      });
      child.once('close', (code, signal) => {
        record.closed = true;
        if (closing) {
          yes(logs[name]);
          return;
        }
        if (code !== 0 || persistent) {
          const error = new Error(
            `${name} exited (${signal ?? code}): ${logs[name].slice(-3000)}`
          );
          no(error);
          fail(error);
        } else yes(logs[name]);
      });
    });
    void done.catch(() => {});
    const completion = Promise.race([done, failed]);
    void completion.catch(() => {});
    return { pid: child.pid ?? 0, done: completion, output: () => logs[name] };
  };
  let model: Awaited<ReturnType<typeof startAimock>> | undefined;
  let listener: Awaited<ReturnType<typeof reserve>> | undefined;
  let observer: Awaited<ReturnType<typeof observeProvider>> | undefined;
  const provider = join(temporary, 'provider'),
    consumer = join(temporary, 'consumer');
  const ownerCleanupPath = join(temporary, 'owner-cleanup.json');
  const evidenceDirectory = options.evidenceDirectory;
  let copied: Record<string, string> = {};
  let modelUrl = '';
  const proof: Record<string, unknown> = {};
  let capture!: {
    accepted: false;
    scenario: Scenario;
    testOperations: boolean;
    temporary: string;
    modelUrl: string;
    sources: Record<string, string>;
    additionalInputs: Record<string, string>;
    provider: { copied: Record<string, string>; versions?: unknown };
    proof: Record<string, unknown>;
    requests: Awaited<ReturnType<typeof observeProvider>>['requests'];
    forwardedRequests: Awaited<
      ReturnType<typeof observeProvider>
    >['forwardedRequests'];
    controls: Awaited<ReturnType<typeof observeProvider>>['controls'];
  };
  try {
    active();
    listener = await reserve(options.port);
    copied = copyProvider(root, provider);
    const context: Context = {
      root,
      temporary,
      consumer,
      provider,
      ownerCleanupPath,
      port: listener.port,
      env,
      run,
    };
    await (options.operations?.prepare ?? prepare)(context);
    active();
    model = await startAimock({
      mode: 'replay',
      fixturePath: join(root, selected.fixture),
    });
    active();
    modelUrl = `http://127.0.0.1:${model.port}`;
    context.env = {
      ...env,
      OPENAI_BASE_URL: model.baseUrl,
      OPENAI_API_KEY: 'test-not-used',
      LANGSMITH_TRACING: 'false',
      LANGCHAIN_TRACING_V2: 'false',
      LANGGRAPH_CLI_NO_ANALYTICS: '1',
    };
    const command = await (
      options.operations?.providerCommand ?? providerCommand
    )(context);
    active();
    await listener.close();
    listener = undefined;
    const server = run('provider', command, true);
    const providerUrl = `http://127.0.0.1:${context.port}`;
    await Promise.race([
      (async () => {
        for (;;) {
          active();
          const diagnostic = server.output().replace(/\x1b\[[0-9;]*m/g, '');
          if (
            diagnostic.includes('API: ' + providerUrl) &&
            diagnostic.includes('Application started up in ')
          ) {
            try {
              const ok = await fetch(providerUrl + '/ok', {
                signal: AbortSignal.timeout(1000),
              });
              const response = await fetch(providerUrl + '/assistants/search', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
                signal: AbortSignal.timeout(1000),
              });
              const assistants = (await response.json()) as {
                graph_id: string;
              }[];
              if (
                ok.ok &&
                response.ok &&
                assistants.some((a) => a.graph_id === 'chat')
              )
                break;
            } catch {
              /* An owned live server may still be starting. */
            }
          }
          await new Promise((yes) => setTimeout(yes, 50));
        }
      })(),
      failed,
    ]);
    observer = await observeProvider(context.port, scenario);
    active();
    console.log(
      `Canonical ${scenario} provider ready; exercising installed application.`
    );
    const exerciseContext = {
      ...context,
      env,
      url: observer.url,
      modelUrl,
      controlUrl: observer.controlUrl,
    };
    Object.assign(
      proof,
      await Promise.race([
        options.operations?.exercise
          ? options.operations.exercise(exerciseContext)
          : exercise(exerciseContext, selected, proof),
        failed,
      ])
    );
    active();
    assert.deepEqual(
      inputFingerprint(root, buildInputRoots(root, 'react')),
      sources,
      'Source changed during approval proof'
    );
    for (const [name, hash] of Object.entries(additionalInputs))
      assert.equal(sha(readFileSync(join(root, name))), hash);
    for (const [name, hash] of Object.entries(copied)) {
      assert.equal(
        sha(readFileSync(join(root, 'examples/chat/python', name))),
        hash
      );
      assert.equal(sha(readFileSync(join(provider, name))), hash);
    }
  } finally {
    closing = true;
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    // Let the installed owner abort and delete its own threads while HTTP and
    // the provider are still alive. Then close the rest of this owned lifetime.
    const owners = records.filter(
      (record) => record.name === 'installed session'
    );
    const cleanup = await Promise.allSettled(
      owners.map((record) =>
        terminateOwnedProcess(record, options.killProcessGroup ?? process.kill)
      )
    );
    // Group disappearance alone cannot attest to successful application cleanup.
    // The entry writes this only after synchronous app retirement, awaited raw
    // probe disposal and all known thread deletions, also when aborted. The app
    // intentionally exposes no promise for its internal session disposal.
    let ownerCleanup:
      | { ownersDisposed: true; threadsDeleted: true }
      | undefined;
    if (owners.length) {
      try {
        assert.ok(
          lstatSync(ownerCleanupPath).isFile(),
          'Missing installed owner cleanup acknowledgement'
        );
        assert.equal(lstatSync(ownerCleanupPath).isSymbolicLink(), false);
        ownerCleanup = json(ownerCleanupPath);
        assert.deepEqual(ownerCleanup, {
          ownersDisposed: true,
          threadsDeleted: true,
        });
      } catch (error) {
        cleanup.push({
          status: 'rejected',
          reason: new Error('Installed owner cleanup was not confirmed', {
            cause: error,
          }),
        });
      }
    }
    cleanup.push(
      ...(await Promise.allSettled([
        listener?.close(),
        observer?.close(),
        model?.stop(),
        ...records
          .filter((record) => !owners.includes(record))
          .map((record) =>
            terminateOwnedProcess(
              record,
              options.killProcessGroup ?? process.kill
            )
          ),
      ]))
    );
    try {
      // An aborted exercise can settle before its child finishes writing. Read
      // any owned result only after termination, while the files still exist.
      const resultPath = join(temporary, 'session-result.json');
      if (existsSync(resultPath)) Object.assign(proof, json(resultPath));
    } catch (error) {
      cleanup.push({ status: 'rejected', reason: error });
    }
    capture = {
      accepted: false,
      scenario,
      testOperations: options.operations !== undefined,
      temporary,
      modelUrl,
      sources,
      additionalInputs,
      provider: {
        copied,
        ...(existsSync(join(temporary, 'provider-versions.json'))
          ? { versions: json(join(temporary, 'provider-versions.json')) }
          : {}),
      },
      proof: structuredClone(proof),
      requests: structuredClone(observer?.requests ?? []),
      forwardedRequests: structuredClone(observer?.forwardedRequests ?? []),
      controls: structuredClone(observer?.controls ?? []),
    };
    try {
      if (evidenceDirectory) {
        mkdirSync(evidenceDirectory, { recursive: true });
        for (const [name, log] of Object.entries(logs))
          writeFileSync(
            join(evidenceDirectory, name.replaceAll(' ', '-') + '.log'),
            log
          );
        writeFileSync(
          join(evidenceDirectory, 'capture.json'),
          JSON.stringify(capture, null, 2),
          { flag: 'wx' }
        );
      }
    } catch (error) {
      cleanup.push({ status: 'rejected', reason: error });
    }
    const errors = cleanup.filter((item) => item.status === 'rejected');
    if (errors.length)
      throw new AggregateError(
        errors.map((e) => (e as PromiseRejectedResult).reason),
        'Approval provider cleanup failed; temporary files retained: ' +
          temporary
      );
    rmSync(temporary, { recursive: true, force: true });
    if (evidenceDirectory)
      writeFileSync(
        join(evidenceDirectory, 'cleanup.json'),
        JSON.stringify(
          {
            temporary,
            removed: !existsSync(temporary),
            ...(ownerCleanup ? { ownerCleanup } : {}),
            children: records.map((r) => ({
              name: r.name,
              pid: r.child.pid,
              leaderClosed: r.closed,
              groupAbsent: true,
            })),
          },
          null,
          2
        ),
        { flag: 'wx' }
      );
  }
  return { ...capture, cleanupConfirmed: true as const };
}
