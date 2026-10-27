/** Loopback-only SDK transport backed by the actual compiled Filesystem graph. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function graphWorker(spawnWorker, timeout) {
  const child = spawnWorker();
  const pending = new Map();
  let sequence = 0,
    dead = false,
    closing;
  const ended = new Promise((resolve) => child.once('close', resolve));
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  function fail() {
    dead = true;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(Error('Filesystem graph worker unavailable.'));
    }
    pending.clear();
  }
  const terminate = () => {
    fail();
    child.kill('SIGTERM');
  };
  child.once('error', fail);
  child.once('close', () => {
    fail();
    lines.close();
  });
  child.stdin.on('error', terminate);
  lines.once('close', () => {
    if (!dead) terminate();
  });
  lines.on('line', (line) => {
    try {
      if (Buffer.byteLength(line) > 16 * 1024 * 1024)
        throw Error('Oversized response');
      const result = JSON.parse(line),
        item = pending.get(result.requestId);
      if (!item) throw Error('Unowned response');
      pending.delete(result.requestId);
      clearTimeout(item.timer);
      if (result.error)
        item.reject(Error('Filesystem graph operation failed.'));
      else item.resolve(result);
    } catch {
      terminate();
    }
  });
  return {
    pid: child.pid,
    send(value) {
      if (dead) return Promise.reject(Error('Filesystem graph worker closed.'));
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
        fail();
        child.stdin.end();
        const timer = setTimeout(() => child.kill('SIGKILL'), 1500);
        await ended;
        clearTimeout(timer);
        lines.close();
      })());
    },
  };
}

export function createDeepAgentsFilesystemFixture({
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
        'cockpit/deep-agents/filesystem/python',
        'python',
        'scripts/react-cockpit/deep-agents-filesystem-wire.py',
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          ...process.env,
          UV_CACHE_DIR:
            process.env.UV_CACHE_DIR ?? '/tmp/threadplane-filesystem-uv-cache',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ),
} = {}) {
  const sourceSha256 = Object.fromEntries(
    ['src/graph.py', 'prompts/filesystem.md', 'uv.lock'].map((path) => [
      path,
      createHash('sha256')
        .update(
          readFileSync(
            new URL(
              '../../cockpit/deep-agents/filesystem/python/' + path,
              import.meta.url
            )
          )
        )
        .digest('hex'),
    ])
  );
  let worker,
    closed = false,
    closing,
    queue = Promise.resolve();
  // Real execution is buffered before delivery; transport cancellation does not roll back files.
  const threads = new Set(),
    runs = new Map(),
    held = new Set(),
    proofs = [],
    requests = [];
  const options = {
    scenario: 'normal',
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
        proof.op !== value.op ||
        proof.threadId !== (value.threadId ?? null) ||
        Object.keys(proof.sourceSha256 ?? {}).length !==
          Object.keys(sourceSha256).length ||
        Object.entries(sourceSha256).some(
          ([path, hash]) => proof.sourceSha256[path] !== hash
        )
      )
        throw Error('Invalid graph proof');
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
      if (pathname === '/__graph-proof') {
        json(response, proofs);
        return true;
      }
      if (pathname === '/__requests') {
        json(response, requests);
        return true;
      }
      if (pathname === '/__lifetime') {
        json(response, {
          workers: worker ? 1 : 0,
          workerPid: worker?.pid,
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
              'normal',
              'no-files',
              'unchanged',
              'read-only',
              'empty',
              'overwrite',
              'report-overwrite',
              'edit',
              'delete',
              'batch',
              'duplicates',
              'reject-reproposal',
              'write-error',
              'protected-edit',
              'mixed',
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
      if (requests.length >= 2000 || threads.size >= 100 || runs.size >= 1000) {
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
          !uuid.test(body.thread_id ?? '') ||
          threads.has(body.thread_id) ||
          !only(body, ['thread_id', 'if_exists', 'metadata']) ||
          (body.if_exists !== undefined && body.if_exists !== 'raise') ||
          (body.metadata !== undefined && !only(body.metadata, []))
        ) {
          json(response, {}, 400);
          return true;
        }
        await operate({ op: 'create', threadId: body.thread_id });
        threads.add(body.thread_id);
        json(response, { thread_id: body.thread_id });
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
            typeof body.checkpoint.checkpoint_ns !== 'string'
          ) {
            json(response, {}, 400);
            return true;
          }
          const { history } = await operate({ op: 'history', threadId });
          if (
            !history.some(
              (s) =>
                s.checkpoint.checkpoint_id === body.checkpoint.checkpoint_id &&
                s.checkpoint.checkpoint_ns === body.checkpoint.checkpoint_ns
            ) ||
            (body.checkpoint.checkpoint_map !== undefined &&
              (!only(body.checkpoint.checkpoint_map, [
                body.checkpoint.checkpoint_ns,
              ]) ||
                Object.values(body.checkpoint.checkpoint_map).some(
                  (id) => id !== body.checkpoint.checkpoint_id
                )))
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
        const { history } = await operate({ op: 'history', threadId });
        json(response, history.slice(0, body.limit ?? 10));
        return true;
      }
      const runRoute = /^\/runs\/([^/]+)(\/cancel)?$/.exec(suffix);
      if (
        runRoute &&
        (request.method === 'GET' || (runRoute[2] && request.method === 'POST'))
      ) {
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
        if (
          !only(body, [
            'assistant_id',
            'input',
            'command',
            'stream_mode',
            'stream_subgraphs',
            'stream_resumable',
            'on_disconnect',
          ]) ||
          !(
            (body.command !== undefined &&
              (body.input === undefined || body.input === null) &&
              only(body.command, ['resume']) &&
              only(body.command.resume, ['decisions']) &&
              Array.isArray(body.command.resume.decisions) &&
              body.command.resume.decisions.length > 0 &&
              body.command.resume.decisions.every(
                (d) =>
                  only(d, ['type']) && ['approve', 'reject'].includes(d.type)
              )) ||
            (body.command === undefined &&
              only(body.input, ['messages']) &&
              body.input.messages?.length === 1 &&
              only(message, ['type', 'id', 'content']) &&
              message.type === 'human' &&
              typeof message.id === 'string' &&
              message.id.trim() &&
              typeof message.content === 'string')
          ) ||
          body.assistant_id !== 'da-filesystem' ||
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
        const wire = await operate({
          op: body.command ? 'resume' : 'submit',
          threadId,
          ...(body.command
            ? { command: body.command }
            : { messages: body.input.messages }),
        });
        if (response.destroyed) {
          run.status = 'interrupted';
          return true;
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream',
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
          for (const [kind, data] of wire.events)
            if (modes.has(kind)) response.write(event(kind, data));
          run.status = 'success';
          response.end();
        };
        if (options.holdStream) hold(response, finish, run);
        else finish();
        return true;
      }
      json(response, {}, 404);
      return true;
    } catch {
      json(response, { error: 'Filesystem graph fixture failed.' }, 500);
      return true;
    }
  };
  handle.close = () =>
    (closing ??= (async () => {
      closed = true;
      for (const item of held) item.response.end();
      held.clear();
      await worker?.close();
    })());
  return handle;
}
