import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request, type ClientRequest } from 'node:http';
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
interface Options {
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

// This observer only records and forwards real provider HTTP; it never creates SSE.
async function observeProvider(target: string) {
  const requests: {
    method: string;
    path: string;
    body?: unknown;
    status?: number;
  }[] = [];
  const pending = new Set<ClientRequest>();
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of incoming) {
        size += chunk.length;
        assert.ok(size < 2_000_000);
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      const entry = {
        method: incoming.method!,
        path: incoming.url!,
        ...(bytes.length ? { body: JSON.parse(bytes.toString()) } : {}),
      } as (typeof requests)[number];
      requests.push(entry);
      const upstream = request(
        new URL(incoming.url!, target),
        {
          method: incoming.method,
          headers: { ...incoming.headers, host: new URL(target).host },
        },
        (response) => {
          entry.status = response.statusCode;
          outgoing.writeHead(response.statusCode!, response.headers);
          response.pipe(outgoing);
        }
      );
      pending.add(upstream);
      upstream.once('close', () => pending.delete(upstream));
      upstream.once('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      outgoing.once('close', () => upstream.destroy());
      upstream.end(bytes);
    } catch {
      outgoing.writeHead(500);
      outgoing.end();
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((yes, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', yes);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      for (const request of pending) request.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((yes) => server.close(() => yes()));
    },
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
async function exercise(context: Context & { url: string; modelUrl: string }) {
  const { root, consumer, temporary, env } = context;
  mkdirSync(join(consumer, 'tooling'), { recursive: true });
  for (const name of [
    'approval-provider-consumer.ts',
    'approval-provider-consumer.spec.ts',
    'tsconfig.approval-provider.json',
  ])
    cpSync(
      join(root, 'examples/chat/native/tooling', name),
      join(consumer, 'tooling', name)
    );
  const executable = join(consumer, 'node_modules/typescript/bin/tsc');
  const output = await context.run('installed compiler', {
    command: process.execPath,
    args: [
      executable,
      '-p',
      'tooling/tsconfig.approval-provider.json',
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
    'node_modules/@threadplane/langgraph/runtime/create-session.d.ts',
    'node_modules/@threadplane/core/src/index.d.ts',
    'node_modules/@threadplane/content/src/markdown/index.d.ts',
    'node_modules/@langchain/langgraph-sdk/dist/index.d.ts',
  ])
    assert.ok(inputs[path], 'Installed declaration required: ' + path);
  const resultPath = join(temporary, 'session-result.json');
  await context.run('installed cleanup control', {
    command: process.execPath,
    args: [
      '--test',
      join(
        consumer,
        'provider-output/tooling/approval-provider-consumer.spec.js'
      ),
    ],
    cwd: consumer,
    env,
  }).done;
  await context.run('installed session', {
    command: process.execPath,
    args: [
      join(consumer, 'provider-output/tooling/approval-provider-consumer.js'),
      context.url,
      context.modelUrl,
      resultPath,
      context.ownerCleanupPath,
    ],
    cwd: consumer,
    env,
  }).done;
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
  return {
    ...json(resultPath),
    compiler: {
      executable: relative(consumer, executable),
      sha256: sha(readFileSync(executable)),
      inputs,
      configuration: sha(
        readFileSync(join(consumer, 'tooling/tsconfig.approval-provider.json'))
      ),
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
  };
}

/** Exercise one installed native session against the canonical graph in an owned lifetime. */
export async function runApprovalProvider(options: Options) {
  const root = realpathSync(options.root),
    env = preparationEnvironment();
  const sources = inputFingerprint(root, buildInputRoots(root, 'react'));
  const additionalInputs = Object.fromEntries(
    [
      'libs/e2e-harness/src/aimock-runner.ts',
      'examples/chat/angular/e2e/fixtures/interrupt-approval.json',
    ].map((path) => [path, sha(readFileSync(join(root, path)))])
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
  try {
    active();
    listener = await reserve(options.port);
    const copied = copyProvider(root, provider);
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
      fixturePath: join(
        root,
        'examples/chat/angular/e2e/fixtures/interrupt-approval.json'
      ),
    });
    active();
    const modelUrl = `http://127.0.0.1:${model.port}`;
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
    observer = await observeProvider(providerUrl);
    active();
    console.log(
      'Canonical approval provider ready; exercising installed session.'
    );
    const proof = await Promise.race([
      (options.operations?.exercise ?? exercise)({
        ...context,
        env,
        url: observer.url,
        modelUrl,
      }),
      failed,
    ]);
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
    if (!options.operations?.exercise) {
      const cases = proof.cases as {
        scenario: string;
        threadId: string;
        interrupt: { id: string };
        answer: string;
        unmatched?: string;
      }[];
      const searches = observer.requests.filter(
        (q) => q.method === 'POST' && q.path === '/threads/search'
      );
      assert.equal(
        searches.length,
        5,
        'Each default application owner must load its directory'
      );
      for (const request of searches) {
        assert.deepEqual(request.body, { limit: 50, offset: 0 });
        assert.equal(request.status, 200);
      }
      for (const item of cases) {
        assert.equal(
          observer.requests.filter(
            (q) => q.method === 'GET' && q.path === `/threads/${item.threadId}`
          ).length,
          item.scenario === 'loaded' ? 2 : 1,
          'Each default application owner must admit the selected thread'
        );
        const requests: typeof observer.requests = observer.requests.filter(
          (q) => q.path.startsWith(`/threads/${item.threadId}`)
        );
        // Require the actual admission and execution sequence, allowing only
        // the provider-generated run ID to vary.
        assert.deepEqual(
          requests.map(
            (q) =>
              `${q.method} ${q.path
                .slice(`/threads/${item.threadId}`.length)
                .replace(/^\/runs\/[^/]+$/, '/runs/:id')}`
          ),
          [
            'GET ',
            'POST /history',
            'POST /runs/:id',
            'GET /runs/:id',
            ...(item.scenario === 'loaded' ? ['GET ', 'POST /history'] : []),
            ...(item.unmatched
              ? ['POST /history', 'POST /runs/:id', 'GET /runs/:id']
              : []),
            'POST /runs/:id',
            'GET /runs/:id',
            'GET /state',
            'DELETE ',
          ]
        );
        for (const request of requests) {
          assert.equal(request.status, request.method === 'DELETE' ? 204 : 200);
          if (request.path.endsWith('/history'))
            assert.deepEqual(request.body, { limit: 10 });
        }
        const posts: {
          method: string;
          path: string;
          body?: unknown;
          status?: number;
        }[] = observer.requests.filter(
          (q) =>
            q.method === 'POST' &&
            q.path === `/threads/${item.threadId}/runs/stream`
        );
        assert.equal(
          posts.length,
          item.unmatched ? 3 : 2,
          'One physical POST per explicit submit or response'
        );
        const responses = posts
          .slice(1)
          .map((q) => q.body as Record<string, unknown>);
        assert.deepEqual(
          responses.map((q) => q.command),
          [
            ...(item.unmatched
              ? [{ resume: { [item.unmatched]: 'denied' } }]
              : []),
            { resume: { [item.interrupt.id]: item.answer } },
          ]
        );
        for (const body of responses) assert.equal(body.input, null);
        for (const post of posts) assert.equal(post.status, 200);
        assert.equal(
          observer.requests.filter(
            (q) =>
              q.method === 'DELETE' && q.path === `/threads/${item.threadId}`
          ).length,
          1
        );
      }
      assert.equal(
        observer.requests.filter(
          (q) => q.method === 'POST' && /\/runs(?:\/|$)/.test(q.path)
        ).length,
        9
      );
      assert.equal(
        observer.requests.length,
        46,
        'Exact canonical application request footprint'
      );
    }
    const result = {
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
      proof,
      requests: observer.requests,
      limits: [
        'Normal submit and decision commands use the installed default application/session factory and real directory/history admission. The unmatched-ID raw-session substep is provider routing evidence, not application decision authority.',
        'Cleanup acknowledges synchronous application retirement, awaited raw-probe disposal and completed known-thread deletions. The private application dispose contract does not await its internal session disposal promise.',
        'A task may reuse its interrupt ID for successive pauses: the separate direct-graph feasibility probe establishes this limitation, not this HTTP proof. No remote atomicity or pause-occurrence identity is inferred from interrupt IDs.',
      ],
    };
    if (evidenceDirectory) {
      mkdirSync(evidenceDirectory, { recursive: true });
      writeFileSync(
        join(evidenceDirectory, 'evidence.json'),
        JSON.stringify(result, null, 2),
        { flag: 'wx' }
      );
    }
    return result;
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
    if (evidenceDirectory) {
      mkdirSync(evidenceDirectory, { recursive: true });
      for (const [name, log] of Object.entries(logs))
        writeFileSync(
          join(evidenceDirectory, name.replaceAll(' ', '-') + '.log'),
          log
        );
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
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(__dirname, 'approval-provider.ts')
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'native-approval-evidence-')
  );
  runApprovalProvider({
    root: resolve(__dirname, '../../../..'),
    signal: controller.signal,
    evidenceDirectory,
  })
    .then((result) =>
      console.log(
        'Canonical installed approval proof passed: ' +
          evidenceDirectory +
          '; requests=' +
          result.requests.length
      )
    )
    .catch((error) => {
      console.error(error);
      console.error('Evidence: ' + evidenceDirectory);
      process.exitCode = 1;
    })
    .finally(() => {
      process.removeListener('SIGINT', abort);
      process.removeListener('SIGTERM', abort);
    });
}
