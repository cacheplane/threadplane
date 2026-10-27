/** Private faithful SDK fixture; never imported by a public build. */
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  readFileSync,
  mkdtempSync,
  realpathSync,
  accessSync,
  constants,
  mkdirSync,
} from 'node:fs';
import { join, isAbsolute, delimiter, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = (path) =>
  createHash('sha256')
    .update(
      readFileSync(
        new URL('../../cockpit/chat/a2ui/python/' + path, import.meta.url)
      )
    )
    .digest('hex');
function executable(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const path = join(directory, name);
    try {
      accessSync(path, constants.X_OK);
      return realpathSync(path);
    } catch {
      /* Search configured tool paths. */
    }
  }
  throw Error(`Missing fixture executable: ${name}`);
}
function absoluteConfig(name, fallback) {
  const value = process.env[name] || fallback;
  if (!isAbsolute(value) || value.includes('\0') || value.includes('\n'))
    throw Error(`Invalid ${name}: absolute path required`);
  return value;
}
/** Explicit inputs are nonsecret tooling paths; no dotenv or credential environment. */
export function fixtureConfiguration() {
  const owned = mkdtempSync(join(tmpdir(), 'threadplane-a2ui-config-'));
  const uv = realpathSync(
    absoluteConfig(
      'A2UI_FIXTURE_UV',
      process.env.A2UI_FIXTURE_UV || executable('uv')
    )
  );
  const cache = absoluteConfig('A2UI_FIXTURE_CACHE', join(owned, 'cache'));
  const environment = absoluteConfig(
    'A2UI_FIXTURE_ENV',
    join(owned, 'environment')
  );
  mkdirSync(cache, { recursive: true });
  const env = {
    HOME: owned,
    PATH: `${dirname(uv)}:/usr/bin:/bin`,
    LANG: 'C.UTF-8',
    UV_CACHE_DIR: cache,
  };
  // Discovery alone uses the caller's home to find an already-installed uv Python.
  const python = realpathSync(
    absoluteConfig(
      'A2UI_FIXTURE_PYTHON',
      process.env.A2UI_FIXTURE_PYTHON ||
        execFileSync(
          uv,
          [
            'python',
            'find',
            '--no-project',
            '--no-config',
            '--no-python-downloads',
            '3.12',
          ],
          {
            env: { ...env, HOME: process.env.HOME ?? owned },
            encoding: 'utf8',
            timeout: 10000,
          }
        ).trim()
    )
  );
  const pythonVersion = execFileSync(python, ['--version'], {
    env,
    encoding: 'utf8',
    timeout: 10000,
  }).trim();
  if (!/^Python 3\.12\./.test(pythonVersion))
    throw Error('Fixture requires Python 3.12');
  const uvVersion = execFileSync(uv, ['--version'], {
    env,
    encoding: 'utf8',
    timeout: 10000,
  }).trim();
  return { uv, python, pythonVersion, uvVersion, environment, cache };
}
export function createChatA2uiFixture({
  workerTimeoutMs = 60000,
  configuration,
} = {}) {
  const expected = {
    sourceSha256: digest('src/graph.py'),
    lockSha256: digest('uv.lock'),
  };
  const owned = mkdtempSync(join(tmpdir(), 'threadplane-a2ui-worker-'));
  const threads = new Set(),
    runs = new Map(),
    requests = [],
    proofs = [];
  let child,
    sequence = 0,
    pending,
    buffer = Buffer.alloc(0),
    closed = false,
    closing,
    ended,
    killTimer;
  let queue = Promise.resolve();
  const receipt = { worker: null, requests, proofs, stderr: '' };
  function terminate(error) {
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = undefined;
    }
    if (child && !receipt.worker.reaped) {
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1500);
    }
  }
  function start() {
    const config = configuration ?? fixtureConfiguration();
    receipt.configuration = config;
    child = spawn(
      config.uv,
      [
        'run',
        '--frozen',
        '--python',
        config.python,
        '--no-env-file',
        '--no-config',
        '--no-python-downloads',
        '--project',
        'cockpit/chat/a2ui/python',
        'python',
        'scripts/react-cockpit/chat-a2ui-wire.py',
      ],
      {
        cwd: root,
        env: {
          HOME: owned,
          PATH: `${dirname(config.uv)}:/usr/bin:/bin`,
          LANG: 'C.UTF-8',
          UV_PROJECT_ENVIRONMENT: config.environment,
          UV_CACHE_DIR: config.cache,
          PYTHONDONTWRITEBYTECODE: '1',
          LANGSMITH_TRACING: 'false',
          LANGCHAIN_TRACING_V2: 'false',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    receipt.worker = {
      pid: child.pid,
      reaped: false,
      code: null,
      signal: null,
      owned,
    };
    ended = new Promise((resolve) =>
      child.once('close', (code, signal) => {
        receipt.worker.reaped = true;
        receipt.worker.code = code;
        receipt.worker.signal = signal;
        clearTimeout(killTimer);
        terminate(Error('Graph worker closed'));
        resolve();
      })
    );
    child.once('error', (e) => terminate(e));
    child.stdin.on('error', (e) => terminate(e));
    child.stderr.on('data', (bytes) => {
      receipt.stderr += bytes.toString();
      if (Buffer.byteLength(receipt.stderr) > 262144)
        terminate(Error('Worker diagnostics bound'));
    });
    child.stdout.on('data', (bytes) => {
      buffer = Buffer.concat([buffer, bytes]);
      if (buffer.length > 16 * 1024 * 1024)
        return terminate(Error('Worker frame bound'));
      for (;;) {
        const end = buffer.indexOf(10);
        if (end < 0) break;
        const line = buffer.subarray(0, end);
        buffer = buffer.subarray(end + 1);
        try {
          const result = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(line)
          );
          if (!pending || result.requestId !== pending.id)
            throw Error('Unowned worker response');
          const entry = pending;
          pending = undefined;
          clearTimeout(entry.timer);
          if (result.error) entry.reject(Error(result.error));
          else entry.resolve(result);
        } catch (e) {
          terminate(e);
        }
      }
    });
  }
  async function operate(value) {
    const operation = queue.then(async () => {
      if (closed || receipt.worker?.reaped) throw Error('Closed fixture');
      if (!child) start();
      const result = await new Promise((resolve, reject) => {
        const id = ++sequence;
        const bytes = Buffer.from(
          JSON.stringify({ ...value, requestId: id }) + '\n'
        );
        if (bytes.length > 1024 * 1024)
          return reject(Error('Worker request bound'));
        pending = {
          id,
          resolve,
          reject,
          timer: setTimeout(
            () => terminate(Error('Graph worker deadline')),
            workerTimeoutMs
          ),
        };
        child.stdin.write(bytes);
      });
      if (
        !result.proof?.actualCompiledGraph ||
        result.proof.networkConnectAttempts !== 0 ||
        result.proof.op !== value.op ||
        result.proof.threadId !== (value.threadId ?? null) ||
        Object.entries(expected).some(([k, v]) => result.proof[k] !== v)
      )
        throw Error('Invalid actual graph proof');
      proofs.push(result.proof);
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  const json = (res, value, status = 200) => {
    if (!res.destroyed && !res.writableEnded) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    }
  };
  const event = (kind, value) =>
    `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`;
  const only = (obj, keys) =>
    obj &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    Object.keys(obj).every((k) => keys.includes(k));
  const handle = async (req, res, path) => {
    if (!path.startsWith('/api/')) return false;
    try {
      let bytes = 0,
        text = '';
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) throw Error('Request body bound');
        text += chunk.toString();
      }
      const body = text ? JSON.parse(text) : {};
      requests.push(structuredClone({ method: req.method, path, body }));
      if (path === '/api/threads' && req.method === 'POST') {
        if (
          !only(body, ['thread_id', 'if_exists', 'metadata']) ||
          !/^[a-f0-9-]{36}$/i.test(body.thread_id ?? '') ||
          threads.has(body.thread_id) ||
          (body.if_exists && body.if_exists !== 'raise')
        ) {
          json(res, {}, 400);
          return true;
        }
        threads.add(body.thread_id);
        json(res, { thread_id: body.thread_id });
        return true;
      }
      const route = /^\/api\/threads\/([^/]+)(.*)$/.exec(path);
      if (!route || !threads.has(route[1])) {
        json(res, {}, 404);
        return true;
      }
      const [, threadId, suffix] = route;
      if (
        (suffix === '/state' && req.method === 'GET') ||
        (suffix === '/state/checkpoint' && req.method === 'POST')
      ) {
        if (suffix === '/state/checkpoint') {
          const cp = body.checkpoint;
          if (
            !only(body, ['checkpoint']) ||
            !only(cp, [
              'thread_id',
              'checkpoint_id',
              'checkpoint_ns',
              'checkpoint_map',
            ]) ||
            cp.thread_id !== threadId ||
            cp.checkpoint_ns !== '' ||
            typeof cp.checkpoint_id !== 'string' ||
            !cp.checkpoint_id ||
            (cp.checkpoint_map &&
              (!only(cp.checkpoint_map, ['']) ||
                cp.checkpoint_map[''] !== cp.checkpoint_id))
          ) {
            json(res, {}, 400);
            return true;
          }
          const { history } = await operate({ op: 'history', threadId });
          if (
            !history.some(
              (s) => s.checkpoint.checkpoint_id === cp.checkpoint_id
            )
          ) {
            json(res, {}, 404);
            return true;
          }
        }
        json(
          res,
          (
            await operate({
              op: 'state',
              threadId,
              ...(body.checkpoint ? { checkpoint: body.checkpoint } : {}),
            })
          ).state
        );
        return true;
      }
      if (suffix === '/history' && req.method === 'POST') {
        json(
          res,
          (await operate({ op: 'history', threadId })).history.slice(
            0,
            body.limit ?? 10
          )
        );
        return true;
      }
      if (/^\/runs\/[^/]+$/.test(suffix) && req.method === 'GET') {
        const run = runs.get(suffix.split('/').at(-1));
        receipt.runReads ??= [];
        receipt.runReads.push({ threadId, run: structuredClone(run ?? null) });
        json(
          res,
          run?.thread_id === threadId ? run : {},
          run?.thread_id === threadId ? 200 : 404
        );
        return true;
      }
      if (suffix === '/runs/stream' && req.method === 'POST') {
        const message = body.input?.messages?.[0];
        if (
          !only(body, [
            'assistant_id',
            'input',
            'stream_mode',
            'stream_subgraphs',
            'stream_resumable',
            'on_disconnect',
          ]) ||
          !only(body.input, ['messages']) ||
          !only(message, ['type', 'id', 'content']) ||
          body.assistant_id !== 'c-a2ui' ||
          body.input.messages.length !== 1 ||
          message.type !== 'human' ||
          typeof message.content !== 'string' ||
          typeof message.id !== 'string' ||
          !message.id.trim() ||
          !Array.isArray(body.stream_mode) ||
          body.stream_mode.some(
            (m) =>
              ![
                'messages-tuple',
                'values',
                'updates',
                'custom',
                'checkpoints',
              ].includes(m)
          )
        ) {
          json(res, {}, 400);
          return true;
        }
        const run = {
          run_id: randomUUID(),
          thread_id: threadId,
          status: 'running',
        };
        runs.set(run.run_id, run);
        const wire = await operate({
          op: 'submit',
          threadId,
          messages: body.input.messages,
        });
        receipt.events ??= [];
        receipt.events.push({
          threadId,
          runId: run.run_id,
          events: wire.events,
        });
        const modes = new Set(
          body.stream_mode.map((m) => (m === 'messages-tuple' ? 'messages' : m))
        );
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'content-location': `/threads/${threadId}/runs/${run.run_id}`,
        });
        res.write(event('metadata', { run_id: run.run_id }));
        // Mode selection is the SDK request contract. Never suppress model/title callbacks.
        for (const [kind, value] of wire.events)
          if (modes.has(kind) || kind === 'error')
            res.write(event(kind, value));
        run.status = wire.graphFailure ? 'error' : 'success';
        res.end();
        return true;
      }
      json(res, {}, 404);
      return true;
    } catch (e) {
      receipt.error = String(e);
      json(res, { error: 'Graph fixture failed' }, 500);
      return true;
    }
  };
  handle.configure = (options) => operate({ op: 'configure', options });
  handle.receipt = () => structuredClone(receipt);
  handle.close = () =>
    (closing ??= (async () => {
      closed = true;
      await queue;
      if (child && !receipt.worker.reaped) {
        child.stdin.end();
        killTimer = setTimeout(() => child.kill('SIGKILL'), 1500);
      }
      await ended;
      clearTimeout(killTimer);
      const pythonPid = proofs.find((proof) => proof.pythonPid)?.pythonPid;
      if (pythonPid) {
        try {
          process.kill(pythonPid, 0);
          receipt.worker.pythonAbsent = false;
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
          receipt.worker.pythonAbsent = true;
        }
        receipt.worker.pythonPid = pythonPid;
      }
    })());
  return handle;
}
