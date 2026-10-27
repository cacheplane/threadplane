/** Installed native settlement feasibility gate. No workspace runtime aliases. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  realpathSync,
  existsSync,
  readdirSync,
  lstatSync,
} from 'node:fs';
import { join, dirname, isAbsolute, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  emitCandidate,
  packCandidate,
} from '../react-parity/langgraph-candidate-package.mjs';
import { packLocalArtifacts } from '../react-parity/verify-packages.mjs';
import {
  installPresentationConsumer,
  reactLanggraphPresentationSeeds,
} from '../react-parity/markdown-presentation-build.mjs';

/** Register ownership synchronously, before the next setup await. */
export async function withOwnedResources(work, report = {}, finish = () => {}) {
  const resources = [];
  let failure;
  try {
    await work((name, close) => resources.push({ name, close }));
  } catch (error) {
    failure = error;
    report.failure = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  } finally {
    report.cleanup = [];
    for (const { name, close } of resources.reverse()) {
      const row = { name };
      report.cleanup.push(row);
      try {
        await close();
        row.closed = true;
      } catch (error) {
        row.error = String(error);
        failure ??= error;
      }
    }
    try {
      await finish();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

async function installedConsumer(mode) {
  const assert = (await import('node:assert/strict')).default;
  const { createServer } = await import('node:http');
  const { once } = await import('node:events');
  const { randomUUID } = await import('node:crypto');
  const { writeFileSync, readFileSync, realpathSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@threadplane/langgraph');
  const sdkEntry = createRequire(entry).resolve('@langchain/langgraph-sdk');
  const { createSession } = await import(entry);
  const { Client } = await import(sdkEntry);
  const { createChatA2uiFixture } = await import(process.env.A2UI_FIXTURE_URL);
  assert.ok(
    realpathSync(entry).startsWith(
      realpathSync(process.cwd()) + '/node_modules/@threadplane/langgraph/'
    )
  );
  assert.ok(
    realpathSync(sdkEntry).startsWith(
      realpathSync(process.cwd()) + '/node_modules/'
    )
  );
  const admission =
    mode === 'application-admission'
      ? await import('./compiled/cockpit/chat/a2ui/react/src/terminal.js')
      : undefined;
  const report = { entry, sdkEntry, turns: [], observations: [] };
  let activeObservation, currentOperation;
  let confirmedMessages = [];
  let fixture;
  await withOwnedResources(
    async (own) => {
      fixture = createChatA2uiFixture();
      own('fixture', () => fixture.close());
      const server = createServer(async (req, res) => {
        if (
          !(await fixture(
            req,
            res,
            new URL(req.url, 'http://localhost').pathname
          ))
        ) {
          res.writeHead(404);
          res.end();
        }
      });
      own('listener', async () => {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const apiUrl = `http://127.0.0.1:${server.address().port}/api`;
      const client = new Client({
        apiUrl,
        apiKey: null,
        callerOptions: { maxRetries: 0 },
      });
      const threadId = randomUUID();
      await client.threads.create({ threadId, ifExists: 'raise' });
      const session = createSession({
        assistantId: 'c-a2ui',
        threadId,
        apiUrl,
        clientOptions: { maxRetries: 0, defaultHeaders: {} },
      });
      own('session', () => session.dispose());
      const unsubscribe = session.subscribe(() => {
        const s = session.getSnapshot();
        activeObservation?.observe(s);
        report.observations.push({
          status: s.status,
          error: s.error,
          messages: s.messages,
          toolCalls: s.toolCalls,
          interrupts: s.interrupts,
          subgraphs: s.subgraphs,
        });
      });
      own('subscription', unsubscribe);
      let prior = [];
      for (const input of JSON.parse(readFileSync('inputs.json', 'utf8'))) {
        const operation = {};
        currentOperation = operation;
        const observation = admission?.createObservation({
          threadId,
          input,
          previous: confirmedMessages,
        });
        activeObservation = observation;
        const outcome = await session.submit(input);
        const snapshot = session.getSnapshot();
        const turn = { input, outcome, snapshot };
        report.turns.push(turn);
        assert.equal(
          outcome,
          'success',
          'Native c-a2ui submit must succeed before canonical load'
        );
        assert.equal(snapshot.status, 'idle');
        assert.equal(snapshot.error, undefined);
        assert.deepEqual(snapshot.interrupts, []);
        assert.deepEqual(snapshot.subgraphs, []);
        activeObservation = undefined;
        let exactFromAdmission;
        if (admission) {
          const prepared = await admission.prepareTerminal({
            operation,
            observation,
            outcome,
            getOperation: () => currentOperation,
            getSnapshot: () => session.getSnapshot(),
            load: () => session.load(),
            read: async (checkpoint) => {
              exactFromAdmission = await client.threads.getState(
                threadId,
                checkpoint
              );
              return exactFromAdmission;
            },
          });
          assert.equal(
            prepared.kind,
            'prepared',
            'Actual installed app helper must admit canonical terminal'
          );
          turn.admission = prepared.confirmation;
        } else await session.load();
        const loaded = session.getSnapshot();
        turn.loaded = loaded;
        const cp = structuredClone(loaded.history[0].checkpoint);
        turn.checkpoint = cp;
        assert.equal(cp.thread_id, threadId);
        assert.equal(cp.checkpoint_ns, '');
        assert.ok(cp.checkpoint_id);
        const exact =
          exactFromAdmission ?? (await client.threads.getState(threadId, cp));
        turn.exact = exact;
        assert.deepEqual(exact.checkpoint, cp);
        assert.deepEqual(exact.tasks, []);
        assert.deepEqual(exact.next, []);
        assert.deepEqual(exact.values.messages.slice(0, prior.length), prior);
        assert.equal(exact.values.messages.length, prior.length + 2);
        const request = fixture
          .receipt()
          .requests.filter((r) => r.path.endsWith('/runs/stream'))
          .at(-1);
        assert.deepEqual(request.body.stream_mode, [
          'values',
          'messages-tuple',
          'updates',
          'custom',
          'checkpoints',
        ]);
        assert.equal(
          exact.values.messages.at(-2).id,
          request.body.input.messages[0].id
        );
        assert.equal(exact.values.messages.at(-2).content, input);
        assert.match(
          exact.values.messages.at(-1).content,
          /^---a2ui_JSON---\n/
        );
        assert.deepEqual(
          loaded.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          })),
          exact.values.messages.map((m) => ({
            id: m.id,
            role: m.type === 'human' ? 'user' : 'assistant',
            content: m.content,
          }))
        );
        if (admission) {
          const owned = admission.captureOwned({
            observation,
            outcome,
            snapshot,
          });
          const negatives = [
            [
              'wrong thread',
              (l, r) => {
                r.checkpoint.thread_id = 'other';
              },
            ],
            [
              'wrong checkpoint',
              (l, r) => {
                r.checkpoint.checkpoint_id = 'other';
              },
            ],
            [
              'wrong root map',
              (l, r) => {
                r.checkpoint.checkpoint_map = { '': 'other' };
              },
            ],
            [
              'pending task',
              (l, r) => {
                r.tasks = [{ id: 'pending' }];
              },
            ],
            [
              'wrong human',
              (l) => {
                l.messages.at(-2).id = 'other';
              },
            ],
            [
              'duplicate IDs',
              (l) => {
                l.messages.at(-1).id = l.messages[0].id;
              },
            ],
            [
              'tool authority',
              (l, r) => {
                r.values.messages.at(-1).tool_calls = [{ id: 'tool' }];
              },
            ],
            [
              'changed prior prefix',
              (l, r) => {
                l.messages[0].content = 'changed';
              },
            ],
            [
              'complete-looking callback prefix',
              (l, r) => {
                l.messages.at(-1).content =
                  '---a2ui_JSON---\n{"createSurface":{"surfaceId":"fake"}}';
                r.values.completed_answer_id = l.messages.at(-1).id;
              },
            ],
          ];
          turn.admissionNegatives = negatives.map(([name, mutate]) => {
            const l = structuredClone(loaded),
              r = structuredClone(exact);
            mutate(l, r);
            const rejected =
              admission.captureTerminal(owned, l, r) === undefined;
            assert.ok(rejected, name);
            return { name, rejected };
          });
          turn.admissionNegatives.push({
            name: 'actual transient callback snapshot',
            rejected:
              admission.captureTerminal(owned, snapshot, exact) === undefined,
          });
          for (const phase of ['load', 'read', 'snapshot']) {
            let current = operation,
              capturedSnapshot = snapshot;
            const result = await admission.prepareTerminal({
              operation,
              observation,
              outcome,
              getOperation: () => current,
              getSnapshot: () => capturedSnapshot,
              load: async () => {
                capturedSnapshot = loaded;
                if (phase === 'load') current = {};
              },
              read: async () => {
                if (phase === 'read') current = {};
                if (phase === 'snapshot') capturedSnapshot = { ...loaded };
                return exact;
              },
            });
            turn.admissionNegatives.push({
              name: 'stale after ' + phase,
              rejected: result.kind === 'unavailable',
            });
          }
          assert.ok(turn.admissionNegatives.every((row) => row.rejected));
          confirmedMessages = turn.admission.messages;
        }
        prior = exact.values.messages;
      }
      const captured = fixture.receipt();
      assert.equal(
        captured.requests.filter((r) => r.path.endsWith('/runs/stream')).length,
        4
      );
      assert.equal(
        captured.requests.filter(
          (r) => r.method === 'GET' && /\/runs\/[^/]+$/.test(r.path)
        ).length,
        4
      );
      assert.deepEqual(
        captured.runReads.map((row) => row.run.status),
        ['success', 'success', 'success', 'success']
      );
      const callbacks = captured.events.flatMap((row) => row.events);
      assert.ok(
        callbacks.some(
          ([kind, value]) =>
            kind === 'messages' && value[1].langgraph_node === 'generate_title'
        )
      );
      assert.ok(
        callbacks.some(
          ([kind, value]) =>
            kind === 'messages' && value[0].tool_call_chunks?.length
        )
      );
      const data = prior
        .at(-1)
        .content.split('\n')
        .slice(1)
        .filter(Boolean)
        .map(JSON.parse)
        .find((e) => e.updateDataModel)?.updateDataModel.value;
      assert.deepEqual(data, {
        origin: ['LAX'],
        dest: ['JFK'],
        date: '2026-11-03',
        passengers: 2,
        fare_class: ['Business'],
      });
    },
    report,
    () => {
      report.fixture = fixture?.receipt();
      writeFileSync('native-receipt.json', JSON.stringify(report) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
    }
  );
}

async function runWorker(evidence, scenario, mode) {
  assert.equal(process.versions.node.split('.')[0], '22');
  const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
  const candidate = join(evidence, 'candidate'),
    consumer = join(evidence, 'consumer');
  mkdirSync(candidate);
  mkdirSync(consumer);
  const node = realpathSync(process.execPath);
  const env = { ...process.env };
  const report = { evidence, root, node, mode };
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  try {
    if (scenario === 'fail-setup') throw Error('controlled setup failure');
    if (scenario?.startsWith('sync-')) {
      const phase = scenario.slice(5);
      writeFileSync(join(evidence, 'phase.json'), JSON.stringify({ phase }));
      // An owned controlled subprocess represents a synchronous helper that never returns.
      execFileSync(
        node,
        [
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(
            join(evidence, 'sync-child.json')
          )},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000)`,
        ],
        { env, stdio: 'ignore' }
      );
    }
    report.emission = emitCandidate(root, candidate);
    report.packed = packCandidate(candidate, evidence);
    const tarballs = packLocalArtifacts(root, evidence, ['react'], {
      optionalPeers: ['a2ui'],
    });
    tarballs['@threadplane/langgraph'] = 'file:' + report.packed.tarball;
    report.installation = installPresentationConsumer(
      consumer,
      JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')),
      tarballs,
      {
        seeds: reactLanggraphPresentationSeeds,
        profile: 'react-native-a2ui-langgraph',
        env,
      }
    );
    writeFileSync(
      join(consumer, 'native-consumer.mjs'),
      `const withOwnedResources = ${withOwnedResources.toString()};\n(${installedConsumer.toString()})(${JSON.stringify(
        mode
      )}).catch(e => { console.error(e); process.exitCode=1; });\n`
    );
    const action = (name, context) =>
      JSON.stringify({
        version: 'v0.9',
        action: {
          name,
          surfaceId:
            name === 'bookingSubmit'
              ? 'booking'
              : name === 'flightSelect'
              ? 'results'
              : 'confirmation',
          sourceComponentId: 'button',
          timestamp: '2026-10-16T00:00:00Z',
          context,
        },
      });
    writeFileSync(
      join(consumer, 'inputs.json'),
      JSON.stringify([
        'I want to fly LAX to JFK',
        action('bookingSubmit', {
          formId: 'booking',
          origin: ['LAX'],
          dest: ['JFK'],
          date: '2026-11-03',
          passengers: 2,
          fare_class: ['Business'],
        }),
        action('flightSelect', { flightId: 'UA123' }),
        action('modifySearch', { formId: 'booking' }),
      ])
    );
    writeFileSync(
      join(consumer, 'contract.ts'),
      "import {createSession} from '@threadplane/langgraph';\nconst session = createSession({assistantId:'c-a2ui',threadId:'local',apiUrl:'http://127.0.0.1'});\nconst outcome: Promise<string> = session.submit('request');\nvoid outcome; if (session.load) void session.load(); void session.getSnapshot().history;\n"
    );
    const files = ['contract.ts'];
    if (mode === 'application-admission') {
      report.application = { sources: {}, modules: {} };
      for (const relative of ['libs/cockpit-a2ui-react/src/data.ts', 'cockpit/chat/a2ui/react/src/terminal.ts']) {
        const path = join(root, relative);
        const bytes = readFileSync(path);
        mkdirSync(join(consumer, relative, '..'), { recursive: true });
        writeFileSync(join(consumer, relative), bytes);
        report.application.sources[relative] = {
          path,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
        files.push(relative);
      }
    }
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          lib: ['ES2022', 'ESNext.Disposable', 'DOM'],
          strict: true,
          skipLibCheck: false,
          noEmit: mode !== 'application-admission',
          ...(mode === 'application-admission'
            ? { outDir: 'compiled', rootDir: '.' }
            : {}),
          types: ['node'],
        },
        files,
      })
    );
    const compiler = join(consumer, 'node_modules/typescript/bin/tsc');
    report.compiler = {
      path: compiler,
      sha256: sha(compiler),
      implementationSha256: sha(
        join(consumer, 'node_modules/typescript/lib/_tsc.js')
      ),
      files,
      configSha256: sha(join(consumer, 'tsconfig.json')),
      claim:
        mode === 'application-admission'
          ? 'actual application admission helpers'
          : 'small public API scaffold only',
    };
    execFileSync(node, [compiler, '--project', 'tsconfig.json'], {
      cwd: consumer,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    report.compiler.exit = 0;
    if (mode === 'application-admission')
      for (const relative of ['libs/cockpit-a2ui-react/src/data.js', 'cockpit/chat/a2ui/react/src/terminal.js']) {
        const path = join(consumer, 'compiled', relative);
        report.application.modules[relative] = {
          path,
          bytes: readFileSync(path).length,
          sha256: sha(path),
        };
      }
    const source = join(consumer, 'native-consumer.mjs');
    report.consumerSha256 = sha(source);
    copyFileSync(
      fileURLToPath(import.meta.url),
      join(evidence, 'probe-source.mjs')
    );
    const fixture = join(root, 'scripts/react-cockpit/chat-a2ui-fixture.mjs');
    copyFileSync(fixture, join(evidence, 'fixture-source.mjs'));
    copyFileSync(
      join(root, 'scripts/react-cockpit/chat-a2ui-wire.py'),
      join(evidence, 'wire-source.py')
    );
    report.fixtureSha256 = sha(fixture);
    report.wireSha256 = sha(
      join(root, 'scripts/react-cockpit/chat-a2ui-wire.py')
    );
    const child = spawn(node, ['native-consumer.mjs'], {
      cwd: consumer,
      env: { ...env, A2UI_FIXTURE_URL: pathToFileURL(fixture).href },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      bytes = 0,
      kill;
    const terminate = () => {
      child.kill('SIGTERM');
      kill = setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    const deadline = setTimeout(terminate, 120000);
    child.stdout.on('data', (b) => {
      bytes += b.length;
      stdout += b.toString();
      if (bytes > 1048576) terminate();
    });
    child.stderr.on('data', (b) => {
      bytes += b.length;
      stderr += b.toString();
      if (bytes > 1048576) terminate();
    });
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) =>
        resolve({ code, signal, pid: child.pid, reaped: true })
      );
    });
    clearTimeout(deadline);
    clearTimeout(kill);
    report.consumerChild = exit;
    writeFileSync(join(evidence, 'consumer-stdout.log'), stdout);
    writeFileSync(join(evidence, 'consumer-stderr.log'), stderr);
    report.receipt = JSON.parse(
      readFileSync(join(consumer, 'native-receipt.json'), 'utf8')
    );
    assert.equal(
      exit.code,
      0,
      `Installed native c-a2ui settlement failed; evidence: ${evidence}`
    );
    return report;
  } catch (e) {
    report.failure = {
      message: e.message,
      stack: e.stack,
      stdout: e.stdout?.toString(),
      stderr: e.stderr?.toString(),
    };
    throw e;
  } finally {
    writeFileSync(
      join(evidence, 'worker-report.json'),
      JSON.stringify(report, null, 2) + '\n'
    );
  }
}

const scenarios = new Set([
  'fail-setup',
  'sync-emit',
  'sync-pack',
  'sync-install',
  'sync-compiler',
]);
const sha = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
function fileManifest(directory) {
  const records = {};
  function visit(path) {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory())
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    else
      records[relative(directory, path)] = {
        bytes: info.size,
        sha256: sha(path),
      };
  }
  visit(directory);
  return records;
}

/** The caller owns a fresh POSIX group, including synchronous helper descendants. */
export async function runNativeProbe(options = {}) {
  assert.ok(
    options &&
      typeof options === 'object' &&
      Object.getPrototypeOf(options) === Object.prototype,
    'Unknown native probe options'
  );
  assert.ok(
    Reflect.ownKeys(options).every(
      (key) =>
        ['evidence', 'deadlineMs', 'workerScenario', 'mode'].includes(key) &&
        'value' in Object.getOwnPropertyDescriptor(options, key)
    ),
    'Unknown native probe options'
  );
  const {
    evidence = mkdtempSync(join(tmpdir(), 'threadplane-a2ui-native-')),
    deadlineMs = 120000,
    workerScenario,
    mode = 'settlement',
  } = options;
  assert.ok(
    ['settlement', 'application-admission'].includes(mode),
    'Unknown native probe mode'
  );
  assert.ok(
    mode !== 'application-admission' || workerScenario === undefined,
    'Cannot combine admission mode with control scenarios'
  );
  assert.ok(
    ['darwin', 'linux'].includes(process.platform),
    'POSIX process ownership required'
  );
  assert.ok(isAbsolute(evidence));
  assert.ok(
    Number.isInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 180000
  );
  assert.ok(
    workerScenario === undefined || scenarios.has(workerScenario),
    'Unknown worker scenario'
  );
  const node = realpathSync(process.execPath),
    home = join(evidence, 'home');
  mkdirSync(home);
  const npmConfig = join(home, 'empty-npmrc');
  writeFileSync(npmConfig, '');
  const npmGlobalConfig = join(home, 'empty-global-npmrc');
  writeFileSync(npmGlobalConfig, '');
  const env = {
    HOME: home,
    PATH: `${dirname(node)}:/usr/bin:/bin`,
    LANG: 'C.UTF-8',
    NX_DAEMON: 'false',
    NX_ISOLATE_PLUGINS: 'false',
    NX_LOAD_DOT_ENV_FILES: 'false',
    LANGSMITH_TRACING: 'false',
    LANGCHAIN_TRACING_V2: 'false',
    PYTHONDONTWRITEBYTECODE: '1',
    COREPACK_ENABLE_AUTO_PIN: '0',
    NPM_CONFIG_USERCONFIG: npmConfig,
    NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
    NPM_CONFIG_CACHE: join(evidence, 'npm-cache'),
  };
  const report = {
    evidence,
    node,
    nodeVersion: process.version,
    deadlineMs,
    workerScenario,
    mode,
    environmentKeys: Object.keys(env).sort(),
  };
  let child,
    killTimer,
    deadline,
    failure,
    stdout = '',
    stderr = '',
    bytes = 0;
  const absent = (pid) => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
  };
  const terminate = () => {
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      killTimer ??= setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }, 500);
    }
  };
  try {
    // Only explicit nonsecret fixture configuration crosses the worker boundary.
    if (!workerScenario) {
      const { fixtureConfiguration } = await import('./chat-a2ui-fixture.mjs');
      const config = fixtureConfiguration();
      Object.assign(env, {
        A2UI_FIXTURE_UV: config.uv,
        A2UI_FIXTURE_PYTHON: config.python,
        A2UI_FIXTURE_ENV: config.environment,
        A2UI_FIXTURE_CACHE: config.cache,
      });
      report.environmentKeys = Object.keys(env).sort();
      writeFileSync(
        join(evidence, 'fixture-config.json'),
        JSON.stringify(config, null, 2) + '\n'
      );
    }
    child = spawn(
      node,
      [
        fileURLToPath(import.meta.url),
        '--worker',
        evidence,
        '--mode',
        mode,
        ...(workerScenario ? ['--scenario', workerScenario] : []),
      ],
      { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    deadline = setTimeout(() => {
      failure ??= Error('Native probe deadline');
      terminate();
    }, deadlineMs);
    const capture = (key) => (buffer) => {
      bytes += buffer.length;
      if (bytes <= 2 * 1024 * 1024) {
        if (key === 'stdout') stdout += buffer;
        else stderr += buffer;
      } else {
        failure ??= Error('Native probe output bound');
        terminate();
      }
    };
    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));
    report.child = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) =>
        resolve({ code, signal, pid: child.pid, reaped: true })
      );
    });
    if (report.child.code !== 0)
      failure ??= Error(
        `Installed native c-a2ui worker failed; evidence: ${evidence}`
      );
  } catch (error) {
    failure ??= error;
  } finally {
    clearTimeout(deadline);
    // Failure/timeout owns only this fresh group; the consumer and uv share it.
    if (child?.pid && !absent(-child.pid)) terminate();
    const started = Date.now();
    while (
      child?.pid &&
      (!absent(child.pid) || !absent(-child.pid)) &&
      Date.now() - started < 2500
    )
      await new Promise((r) => setTimeout(r, 25));
    clearTimeout(killTimer);
    report.closure = {
      processAbsent: child?.pid ? absent(child.pid) : true,
      groupAbsent: child?.pid ? absent(-child.pid) : true,
      observedForMs: Date.now() - started,
      claim: 'bounded known process and owned group observations only',
    };
    if (existsSync(join(evidence, 'sync-child.json'))) {
      const { pid } = JSON.parse(
        readFileSync(join(evidence, 'sync-child.json'), 'utf8')
      );
      report.closure.controlledChild = { pid, absent: absent(pid) };
    }
    writeFileSync(join(evidence, 'stdout.log'), stdout);
    writeFileSync(join(evidence, 'stderr.log'), stderr);
    if (existsSync(join(evidence, 'worker-report.json'))) {
      const worker = JSON.parse(
        readFileSync(join(evidence, 'worker-report.json'), 'utf8')
      );
      if (worker.failure) report.workerFailure = worker.failure;
      Object.assign(report, worker);
    }
    if (existsSync(join(evidence, 'consumer/native-receipt.json')))
      report.receipt = JSON.parse(
        readFileSync(join(evidence, 'consumer/native-receipt.json'), 'utf8')
      );
    if (failure)
      report.failure = { message: failure.message, stack: failure.stack };
    writeFileSync(
      join(evidence, 'report.json'),
      JSON.stringify(report, null, 2) + '\n'
    );
    writeFileSync(
      join(evidence, 'payload-manifest.json'),
      JSON.stringify(fileManifest(evidence), null, 2) + '\n'
    );
    console.log('Private c-a2ui native evidence: ' + evidence);
  }
  if (failure) throw failure;
  return report;
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (!args.length) await runNativeProbe();
  else if (
    args[0] === '--worker' &&
    isAbsolute(args[1] ?? '') &&
    args[2] === '--mode' &&
    ['settlement', 'application-admission'].includes(args[3]) &&
    (args.length === 4 ||
      (args.length === 6 &&
        args[3] === 'settlement' &&
        args[4] === '--scenario' &&
        scenarios.has(args[5])))
  )
    await runWorker(args[1], args[5], args[3]);
  else throw Error('Unknown native probe options');
}
