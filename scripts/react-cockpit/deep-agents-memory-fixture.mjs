/** Loopback-only SDK transport backed by the actual compiled Memory graph. */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function graphWorker(spawnWorker, timeout) {
  const child = spawnWorker();
  const pending = new Map();
  let sequence = 0,
    dead = false,
    closing,
    killTimer;
  const ended = new Promise((resolve) => child.once('close', resolve));
  const maxResponseBytes = 16 * 1024 * 1024;
  let frame = Buffer.alloc(0),
    frameBytes = 0;
  child.stderr.resume();
  function fail() {
    dead = true;
    frame = Buffer.alloc(0);
    frameBytes = 0;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(Error('Memory graph worker unavailable.'));
    }
    pending.clear();
  }
  const terminate = () => {
    fail();
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1500);
  };
  child.once('error', fail);
  child.once('close', () => {
    clearTimeout(killTimer);
    fail();
  });
  child.stdin.on('error', terminate);
  child.stdout.once('error', terminate);
  child.stdout.once('end', () => {
    if (!dead) terminate();
  });
  child.stdout.on('data', (bytes) => {
    if (dead) return;
    try {
      let start = 0;
      while (start < bytes.length && !dead) {
        const newline = bytes.indexOf(0x0a, start);
        const end = newline < 0 ? bytes.length : newline;
        const needed = frameBytes + end - start;
        // Count each raw frame before copying or decoding, including frames
        // whose delimiter has not arrived. Never grow storage beyond the cap.
        if (needed > maxResponseBytes) throw Error('Oversized response');
        if (needed > frame.length) {
          const grown = Buffer.allocUnsafe(
            Math.min(maxResponseBytes, Math.max(needed, frame.length * 2, 4096))
          );
          frame.copy(grown, 0, 0, frameBytes);
          frame = grown;
        }
        bytes.copy(frame, frameBytes, start, end);
        frameBytes = needed;
        if (newline < 0) return;
        const result = JSON.parse(frame.toString('utf8', 0, frameBytes));
        frameBytes = 0;
        const item = pending.get(result.requestId);
        if (!item) throw Error('Unowned response');
        pending.delete(result.requestId);
        clearTimeout(item.timer);
        if (result.error) item.reject(Error('Memory graph operation failed.'));
        else item.resolve(result);
        start = newline + 1;
      }
    } catch {
      terminate();
    }
  });
  return {
    pid: child.pid,
    send(value) {
      if (dead) return Promise.reject(Error('Memory graph worker closed.'));
      return new Promise((resolve, reject) => {
        const requestId = ++sequence;
        const wire = JSON.stringify({ ...value, requestId }) + '\n';
        if (Buffer.byteLength(wire) > 1024 * 1024) {
          reject(Error('Oversized request'));
          return;
        }
        const timer = setTimeout(terminate, timeout);
        pending.set(requestId, { resolve, reject, timer });
        child.stdin.write(wire);
      });
    },
    close() {
      return (closing ??= (async () => {
        child.stdin.end();
        terminate();
        await ended;
        clearTimeout(killTimer);
        child.stdout.removeAllListeners('data');
      })());
    },
  };
}

export function createDeepAgentsMemoryFixture({
  workerTimeoutMs = 30000,
  spawnWorker = () =>
    spawn(
      'uv',
      [
        'run',
        '--frozen',
        '--python',
        '3.12',
        '--project',
        'cockpit/deep-agents/memory/python',
        'python',
        'scripts/react-cockpit/deep-agents-memory-wire.py',
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          ...process.env,
          UV_CACHE_DIR:
            process.env.UV_CACHE_DIR ?? '/tmp/threadplane-memory-uv-cache',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ),
} = {}) {
  const sourceRoot = new URL(
    '../../cockpit/deep-agents/memory/python/',
    import.meta.url
  );
  const sourcePaths = [
    'src/graph.py',
    'src/memory_observation.py',
    'tests/test_streaming.py',
    'tests/model_support.py',
    'prompts/memory.md',
    'uv.lock',
  ];
  const sourceSha256 = Object.fromEntries(
    sourcePaths.map((path) => [
      path,
      createHash('sha256')
        .update(readFileSync(new URL(path, sourceRoot)))
        .digest('hex'),
    ])
  );
  const workerSha256 = createHash('sha256')
    .update(
      readFileSync(new URL('./deep-agents-memory-wire.py', import.meta.url))
    )
    .digest('hex');
  let requestCount = 0,
    pythonPid;
  let worker,
    closed = false,
    closing,
    queue = Promise.resolve();
  // Real execution is buffered before delivery; transport cancellation does not roll back server graph work.
  const threads = new Set(),
    runs = new Map(),
    held = new Set(),
    rawEvents = [],
    proofs = [],
    requests = [];
  const options = {
    scenario: 'teach',
    holdStream: false,
    holdState: false,
    holdCheckpoint: false,
    failCreation: false,
    failStream: false,
    failCheckpoint: false,
  };
  const json = (res, value, status = 200) => {
    if (!res.destroyed && !res.writableEnded) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    }
  };
  const event = (kind, data) =>
    `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
  const only = (value, keys) =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => keys.includes(k));
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  function operate(value) {
    const result = queue.then(async () => {
      if (closed) throw Error('Closed fixture');
      worker ??= graphWorker(spawnWorker, workerTimeoutMs);
      const result = await worker.send(value),
        proof = result.proof;
      if (
        closed ||
        proof?.actualCompiledGraph !== true ||
        proof.networkConnectAttempts !== 0 ||
        proof.workerSha256 !== workerSha256 ||
        !Number.isInteger(proof.pythonPid) ||
        proof.pythonPid <= 0 ||
        (pythonPid !== undefined && proof.pythonPid !== pythonPid) ||
        (value.op === 'submit' &&
          proof.memoryScope !== value.context.memory_scope) ||
        proof.op !== value.op ||
        proof.threadId !== (value.threadId ?? null) ||
        Object.keys(proof.sourceSha256 ?? {}).length !==
          Object.keys(sourceSha256).length ||
        Object.entries(sourceSha256).some(
          ([path, hash]) => proof.sourceSha256[path] !== hash
        )
      )
        throw Error('Invalid graph proof');
      pythonPid = proof.pythonPid;
      proofs.push(proof);
      return result;
    });
    queue = result.catch(() => undefined);
    return result;
  }
  function hold(response, finish, run) {
    const item = { response, finish, run };
    held.add(item);
    response.once('close', () => {
      if (held.delete(item) && run) run.status = 'interrupted';
    });
  }
  const handle = async (request, response, pathname) => {
    if (!pathname.startsWith('/api/') && !pathname.startsWith('/__'))
      return false;
    try {
      if (closed) throw Error('Closed fixture');
      if (
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
          request.socket.remoteAddress
        )
      ) {
        json(response, {}, 403);
        return true;
      }
      const host = request.headers.host;
      if (
        !host ||
        !/^(127\.0\.0\.1|localhost|\[::1\]):[0-9]+$/.test(host) ||
        host.slice(host.lastIndexOf(':') + 1) !==
          String(request.socket.localPort) ||
        request.url.length > 2048
      ) {
        json(response, {}, 400);
        return true;
      }
      if (++requestCount > 2000) {
        json(response, {}, 429);
        return true;
      }
      const chunks = [];
      let byteLength = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteLength += bytes.length;
        if (byteLength > 1024 * 1024) {
          json(response, {}, 413);
          return true;
        }
        chunks.push(bytes);
      }
      const input = Buffer.concat(chunks, byteLength).toString('utf8');
      const body = input ? JSON.parse(input) : {};
      if (!only(body, Object.keys(body ?? {}))) {
        json(response, {}, 400);
        return true;
      }
      if (pathname === '/__raw-events') {
        if (request.method !== 'GET' || input.length !== 0) {
          json(response, {}, 400);
          return true;
        }
        json(response, rawEvents);
        return true;
      }
      if (pathname === '/__graph-proof') {
        if (request.method !== 'GET' || input.length !== 0) {
          json(response, {}, 400);
          return true;
        }
        json(response, proofs);
        return true;
      }
      if (pathname === '/__requests') {
        if (request.method !== 'GET' || input.length !== 0) {
          json(response, {}, 400);
          return true;
        }
        json(response, requests);
        return true;
      }
      if (pathname === '/__lifetime') {
        if (request.method !== 'GET' || input.length !== 0) {
          json(response, {}, 400);
          return true;
        }
        json(response, {
          workers: worker ? 1 : 0,
          workerPid: worker?.pid,
          pythonPid,
          held: held.size,
        });
        return true;
      }
      if (pathname === '/__configure') {
        if (request.method !== 'POST') {
          json(response, {}, 405);
          return true;
        }
        if (
          !only(body, [
            'scenario',
            'holdStream',
            'holdState',
            'holdCheckpoint',
            'failCreation',
            'failStream',
            'failCheckpoint',
          ]) ||
          ('scenario' in body &&
            ![
              'teach',
              'edit',
              'recall',
              'read',
              'empty',
              'boundary',
              'oversize',
              'fail-initial',
              'fail-model',
              'fail-terminal',
            ].includes(body.scenario)) ||
          [
            'holdStream',
            'holdState',
            'holdCheckpoint',
            'failCreation',
            'failStream',
            'failCheckpoint',
          ].some((k) => k in body && typeof body[k] !== 'boolean')
        ) {
          json(response, {}, 400);
          return true;
        }
        if ('scenario' in body)
          await operate({ op: 'configure', scenario: body.scenario });
        Object.assign(options, body);
        json(response, {});
        return true;
      }
      if (pathname === '/__release') {
        if (request.method !== 'POST' || !only(body, [])) {
          json(response, {}, 400);
          return true;
        }
        for (const item of held) {
          held.delete(item);
          item.finish();
        }
        json(response, {});
        return true;
      }
      if (pathname.startsWith('/__')) {
        json(response, {}, 404);
        return true;
      }
      if (requests.length >= 2000 || runs.size >= 1000) {
        json(response, {}, 429);
        return true;
      }
      requests.push(
        structuredClone({ path: pathname, method: request.method, body })
      );
      if (pathname === '/api/threads' && request.method === 'POST') {
        if (options.failCreation) {
          options.failCreation = false;
          json(response, { error: 'Controlled creation failure.' }, 500);
          return true;
        }
        if (
          (body.thread_id !== undefined &&
            (!uuid.test(body.thread_id) || threads.has(body.thread_id))) ||
          threads.size >= 100 ||
          !only(body, ['thread_id', 'if_exists', 'metadata']) ||
          (body.if_exists !== undefined && body.if_exists !== 'raise') ||
          (body.metadata !== undefined && !only(body.metadata, []))
        ) {
          json(response, {}, 400);
          return true;
        }
        const threadId = body.thread_id ?? randomUUID();
        await operate({ op: 'create', threadId });
        threads.add(threadId);
        json(response, { thread_id: threadId });
        return true;
      }
      const route = /^\/api\/threads\/([^/]+)(.*)$/.exec(pathname);
      if (!route || !threads.has(route[1])) {
        json(response, {}, 404);
        return true;
      }
      const [, threadId, suffix] = route;
      if (
        (suffix === '/state' && request.method === 'GET') ||
        (suffix === '/state/checkpoint' && request.method === 'POST')
      ) {
        if (suffix === '/state' && input.length !== 0) {
          json(response, {}, 400);
          return true;
        }
        if (suffix === '/state/checkpoint') {
          if (options.failCheckpoint) {
            options.failCheckpoint = false;
            json(response, { error: 'Controlled exact read failure.' }, 500);
            return true;
          }
          if (
            !only(body, ['checkpoint']) ||
            !only(body.checkpoint, [
              'thread_id',
              'checkpoint_id',
              'checkpoint_ns',
              'checkpoint_map',
            ]) ||
            body.checkpoint.thread_id !== threadId ||
            typeof body.checkpoint.checkpoint_id !== 'string' ||
            body.checkpoint.checkpoint_ns !== ''
          ) {
            json(response, {}, 400);
            return true;
          }
        }
        const { state } = await operate({
          op: 'state',
          threadId,
          ...(suffix === '/state/checkpoint'
            ? { checkpoint: body.checkpoint }
            : {}),
        });
        const finish = () => json(response, state);
        if (
          options.holdState ||
          (options.holdCheckpoint && suffix === '/state/checkpoint')
        )
          hold(response, finish);
        else finish();
        return true;
      }
      if (suffix === '/history' && request.method === 'POST') {
        if (
          !only(body, ['limit']) ||
          (body.limit !== undefined &&
            (!Number.isInteger(body.limit) ||
              body.limit < 1 ||
              body.limit > 100))
        ) {
          json(response, {}, 400);
          return true;
        }
        const { history } = await operate({
          op: 'history',
          threadId,
          limit: body.limit ?? 10,
        });
        json(response, history.slice(0, body.limit ?? 10));
        return true;
      }
      const runRoute = /^\/runs\/([^/]+)(\/cancel)?$/.exec(suffix);
      if (
        runRoute &&
        ((!runRoute[2] && request.method === 'GET') ||
          (runRoute[2] && request.method === 'POST'))
      ) {
        if (input.length !== 0) {
          json(response, {}, 400);
          return true;
        }
        const run = runs.get(runRoute[1]);
        if (run?.thread_id !== threadId) {
          json(response, {}, 404);
          return true;
        }
        if (runRoute[2]) {
          const search = new URL(request.url, 'http://localhost').searchParams;
          if (search.get('action') !== 'interrupt') {
            json(response, {}, 400);
            return true;
          }
          for (const item of held)
            if (item.run === run) {
              held.delete(item);
              run.status = 'interrupted';
              item.response.end();
            }
          json(response, {});
        } else json(response, run);
        return true;
      }
      if (suffix === '/runs/stream' && request.method === 'POST') {
        if (options.failStream) {
          options.failStream = false;
          json(response, { error: 'Controlled stream failure.' }, 500);
          return true;
        }
        const message = body.input?.messages?.[0];
        const nativeHuman = only(message, ['type', 'id', 'content']) &&
          Object.keys(message).length === 3 && typeof message.id === 'string' &&
          message.id.trim() && message.id.length <= 256;
        const angularHuman = only(message, ['type', 'role', 'content']) &&
          Object.keys(message).length === 3 && message.role === 'human';
        if (
          !only(body, [
            'assistant_id',
            'context',
            'config',
            'metadata',
            'input',
            'command',
            'stream_mode',
            'stream_subgraphs',
            'stream_resumable',
            'on_disconnect',
          ]) ||
          !(
            body.command === undefined &&
            only(body.input, ['messages']) &&
            Array.isArray(body.input.messages) &&
            body.input.messages?.length === 1 &&
            (nativeHuman || angularHuman) &&
            message.type === 'human' &&
            typeof message.content === 'string' &&
            Buffer.byteLength(message.content) <= 65536
          ) ||
          body.assistant_id !== 'da-memory' ||
          !only(body.context, ['memory_scope']) ||
          !uuid.test(body.context.memory_scope ?? '') ||
          (body.config !== undefined && !only(body.config, [])) ||
          (body.metadata !== undefined && !only(body.metadata, [])) ||
          !Array.isArray(body.stream_mode) ||
          !body.stream_mode.length ||
          new Set(body.stream_mode).size !== body.stream_mode.length ||
          body.stream_mode.some(
            (mode) =>
              ![
                'messages-tuple',
                'values',
                'updates',
                'checkpoints',
                'custom',
              ].includes(mode)
          ) ||
          (body.stream_subgraphs !== undefined &&
            body.stream_subgraphs !== true) ||
          (body.stream_resumable !== undefined &&
            body.stream_resumable !== true) ||
          (body.on_disconnect !== undefined &&
            body.on_disconnect !== 'continue')
        ) {
          json(response, {}, 400);
          return true;
        }
        const run = {
          run_id: randomUUID(),
          thread_id: threadId,
          status: 'running',
        };
        runs.set(run.run_id, run);
        // Canonical Angular's SDK omits id; LangGraph add_messages assigns
        // UUIDv4 for missing IDs. Normalize once at this private boundary.
        // Captured requests above preserve the original SDK wire unchanged.
        const actualMessage = angularHuman
          ? { type: 'human', id: randomUUID(), content: message.content }
          : message;
        const wire = await operate({
          op: 'submit',
          threadId,
          messages: [actualMessage],
          context: body.context,
        });
        rawEvents.push({
          threadId,
          runId: run.run_id,
          events: wire.events,
          modelPrompts: wire.modelPrompts,
          storeOperations: wire.storeOperations,
          ...(wire.failure ? { failure: wire.failure } : {}),
        });
        if (response.destroyed) {
          run.status = 'interrupted';
          return true;
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          'content-location': `/threads/${threadId}/runs/${run.run_id}`,
        });
        response.write(event('metadata', { run_id: run.run_id }));
        const modes = new Set(
          body.stream_mode.map((mode) =>
            mode === 'messages-tuple' ? 'messages' : mode
          )
        );
        const finish = () => {
          if (response.destroyed || closed) return;
          for (const [namespace, kind, data] of wire.events)
            if (
              modes.has(kind) &&
              (!namespace.length || body.stream_subgraphs === true)
            )
              response.write(event([kind, ...namespace].join('|'), data));
          if (wire.failure)
            response.write(
              event('error', { message: 'Memory graph operation failed.' })
            );
          run.status = wire.failure ? 'error' : 'success';
          response.end();
        };
        if (options.holdStream) hold(response, finish, run);
        else finish();
        return true;
      }
      json(response, {}, 404);
      return true;
    } catch {
      json(response, { error: 'Memory graph fixture failed.' }, 500);
      return true;
    }
  };
  handle.close = () =>
    (closing ??= (async () => {
      closed = true;
      for (const item of held) item.response.destroy();
      held.clear();
      await worker?.close();
      await queue;
    })());
  return handle;
}
