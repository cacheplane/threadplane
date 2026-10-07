/** Local installed-SDK fixture. Real graph checkpoints never become public assets. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function graphWorker(spawnWorker, workerTimeoutMs) {
  const child = spawnWorker();
  let sequence = 0,
    dead = false,
    closing;
  const pending = new Map();
  const ended = new Promise((resolve) => child.once('close', resolve));
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  function fail() {
    dead = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Graph worker unavailable.'));
    }
    pending.clear();
  }
  child.once('error', fail);
  child.once('close', () => {
    fail();
    lines.close();
  });
  child.stdin.on('error', fail);
  lines.once('close', () => {
    if (!dead) {
      fail();
      child.kill('SIGTERM');
    }
  });
  lines.on('line', (line) => {
    try {
      if (line.length > 16 * 1024 * 1024)
        throw new Error('Oversized worker response');
      const result = JSON.parse(line),
        entry = pending.get(result.requestId);
      if (!entry) throw new Error('Unowned worker response');
      pending.delete(result.requestId);
      clearTimeout(entry.timer);
      if (result.error) entry.reject(new Error('Graph operation failed.'));
      else entry.resolve(result);
    } catch {
      fail();
      child.kill('SIGTERM');
    }
  });
  return {
    pid: child.pid,
    send(value) {
      if (dead) return Promise.reject(new Error('Graph worker closed.'));
      return new Promise((resolve, reject) => {
        const requestId = ++sequence;
        const timer = setTimeout(() => {
          fail();
          child.kill('SIGTERM');
        }, workerTimeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ ...value, requestId }) + '\n');
      });
    },
    close() {
      if (closing) return closing;
      fail();
      child.stdin.end();
      closing = (async () => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 1500);
        await ended;
        clearTimeout(timer);
        lines.close();
      })();
      return closing;
    },
  };
}

export function createChatTimelineFixture({
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
        'cockpit/chat/timeline/python',
        'python',
        'scripts/react-cockpit/chat-timeline-wire.py',
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ),
} = {}) {
  const expectedProof = Object.fromEntries(
    [
      ['sourceSha256', 'src/graph.py'],
      ['lockSha256', 'uv.lock'],
    ].map(([key, path]) => [
      key,
      createHash('sha256')
        .update(
          readFileSync(
            new URL(
              '../../cockpit/chat/timeline/python/' + path,
              import.meta.url
            )
          )
        )
        .digest('hex'),
    ])
  );
  let worker,
    queue = Promise.resolve(),
    epoch = 0,
    closed = false,
    closing;
  let requests = [],
    proofs = [],
    injections = [];
  let historyMode = 'safe',
    stateMode = 'safe',
    failCreate = false;
  const held = new Map(),
    holds = new Set(),
    threads = new Set(),
    runs = new Map(),
    operations = new Set();
  const record = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const only = (value, keys) =>
    record(value) && Object.keys(value).every((key) => keys.includes(key));
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const json = (response, value, status = 200) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const event = (kind, value) =>
    `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`;
  function operate(value) {
    const captured = epoch,
      ticket = {};
    operations.add(ticket);
    const result = queue.then(async () => {
      if (closed || epoch !== captured)
        throw new Error('Stale fixture operation');
      worker ??= graphWorker(spawnWorker, workerTimeoutMs);
      const result = await worker.send(value);
      if (closed || epoch !== captured) throw new Error('Stale graph response');
      if (
        !result.proof?.actualCompiledGraph ||
        result.proof.sourceSha256 !== expectedProof.sourceSha256 ||
        result.proof.lockSha256 !== expectedProof.lockSha256 ||
        result.proof.networkConnectAttempts !== 0 ||
        result.proof.titleMessageCallbacks !== 0 ||
        result.proof.op !== value.op ||
        result.proof.threadId !== (value.threadId ?? null)
      )
        throw new Error('Invalid graph proof');
      proofs.push(result.proof);
      return result;
    });
    queue = result.catch(() => undefined);
    return result.finally(() => operations.delete(ticket));
  }
  function release(kind) {
    const entry = held.get(kind);
    held.delete(kind);
    entry?.finish();
  }
  function hold(kind, response, finish, threadId, run) {
    if (response.destroyed || response.writableEnded) return;
    injections.push({ kind, mode: 'hold', threadId });
    const previous = held.get(kind);
    if (previous?.run) previous.run.status = 'interrupted';
    previous?.response.end();
    const entry = { response, finish, run };
    held.set(kind, entry);
    response.on('close', () => {
      if (held.get(kind) === entry) {
        held.delete(kind);
        if (run) run.status = 'interrupted';
      }
    });
  }
  async function reset() {
    ++epoch;
    for (const entry of held.values()) entry.response.end();
    held.clear();
    holds.clear();
    const previous = worker;
    worker = undefined;
    queue = Promise.resolve();
    operations.clear();
    requests = [];
    proofs = [];
    injections = [];
    threads.clear();
    runs.clear();
    historyMode = stateMode = 'safe';
    failCreate = false;
    await previous?.close();
  }
  const handle = async (request, response, pathname) => {
    if (pathname === '/__lifetime') {
      json(response, {
        workers: worker ? 1 : 0,
        workerPid: worker?.pid,
        pendingOperations: operations.size,
        activeStream: held.has('stream'),
        activeHistory: held.has('history'),
        activeState: held.has('state'),
      });
      return true;
    }
    if (
      !pathname.startsWith('/__') &&
      !pathname.startsWith('/api/') &&
      !pathname.startsWith('/developer-api/')
    )
      return false;
    try {
      if (closed) throw new Error('Fixture closed');
      if (pathname === '/__reset') {
        await reset();
        json(response, {});
        return true;
      }
      if (pathname === '/__requests') {
        json(response, requests);
        return true;
      }
      if (pathname === '/__graph-proof') {
        json(response, proofs);
        return true;
      }
      if (pathname === '/__injections') {
        json(response, injections);
        return true;
      }
      if (pathname === '/__fail-create') {
        failCreate = true;
        json(response, {});
        return true;
      }
      if (pathname === '/__mapped-checkpoints') {
        await operate({ op: 'configure', mapped: true });
        json(response, {});
        return true;
      }
      if (pathname === '/__worker-failure') {
        await operate({ op: 'configure' });
        await worker.close();
        json(response, {});
        return true;
      }
      if (
        pathname === '/__metadata-failure' ||
        pathname === '/__title-model-failure'
      ) {
        await operate({
          op: 'configure',
          failMetadata: pathname === '/__metadata-failure',
          failTitle: pathname === '/__title-model-failure',
        });
        json(response, {});
        return true;
      }
      if (
        ['/__hold-stream', '/__hold-history', '/__hold-state'].includes(
          pathname
        )
      ) {
        holds.add(pathname.slice('/__hold-'.length));
        json(response, {});
        return true;
      }
      if (
        ['/__release', '/__release-history', '/__release-state'].includes(
          pathname
        )
      ) {
        release(
          pathname === '/__release'
            ? 'stream'
            : pathname.slice('/__release-'.length)
        );
        json(response, {});
        return true;
      }
      if (pathname.startsWith('/__history/')) {
        const mode = pathname.split('/').at(-1);
        if (
          ![
            'safe',
            'hold',
            'changed',
            'missing',
            'pending',
            'foreign',
            'failure',
          ].includes(mode)
        ) {
          json(response, {}, 400);
          return true;
        }
        historyMode = mode;
        json(response, {});
        return true;
      }
      if (pathname.startsWith('/__state/')) {
        const mode = pathname.split('/').at(-1);
        if (
          ![
            'safe',
            'hold',
            'failure',
            'changed',
            'foreign',
            'malformed',
          ].includes(mode)
        ) {
          json(response, {}, 400);
          return true;
        }
        stateMode = mode;
        json(response, {});
        return true;
      }
      if (pathname.startsWith('/__')) {
        json(response, {}, 404);
        return true;
      }
      let input = '';
      for await (const chunk of request) input += chunk;
      const body = input ? JSON.parse(input) : {},
        captured = epoch;
      requests.push({
        path: pathname,
        method: request.method,
        body,
        key: request.headers['x-api-key'] ?? null,
      });
      if (!record(body)) {
        json(response, {}, 400);
        return true;
      }
      if (
        /^\/(api|developer-api)\/threads$/.test(pathname) &&
        request.method === 'POST'
      ) {
        if (failCreate) {
          failCreate = false;
          throw new Error('Creation failed');
        }
        if (
          !uuid.test(body.thread_id ?? '') ||
          threads.has(body.thread_id) ||
          Object.keys(body).some(
            (key) => !['thread_id', 'if_exists', 'metadata'].includes(key)
          ) ||
          (body.metadata !== undefined &&
            (body.metadata === null ||
              typeof body.metadata !== 'object' ||
              Array.isArray(body.metadata) ||
              Object.keys(body.metadata).length !== 0)) ||
          (body.if_exists !== undefined && body.if_exists !== 'raise')
        ) {
          json(response, {}, 400);
          return true;
        }
        threads.add(body.thread_id);
        json(response, { thread_id: body.thread_id });
        return true;
      }
      const route = /^\/(api|developer-api)\/threads\/([^/]+)(.*)$/.exec(
        pathname
      );
      if (!route || !threads.has(route[2])) {
        json(response, {}, 404);
        return true;
      }
      const threadId = route[2],
        suffix = route[3];
      async function knownCheckpoint(source) {
        if (
          !source ||
          typeof source !== 'object' ||
          Array.isArray(source) ||
          source.thread_id !== threadId ||
          typeof source.checkpoint_id !== 'string' ||
          typeof source.checkpoint_ns !== 'string' ||
          Object.keys(source).some(
            (k) =>
              ![
                'thread_id',
                'checkpoint_id',
                'checkpoint_ns',
                'checkpoint_map',
              ].includes(k)
          )
        )
          return false;
        if (
          source.checkpoint_map !== undefined &&
          (!source.checkpoint_map ||
            typeof source.checkpoint_map !== 'object' ||
            Array.isArray(source.checkpoint_map) ||
            Object.entries(source.checkpoint_map).some(
              ([ns, id]) =>
                ns !== source.checkpoint_ns || id !== source.checkpoint_id
            ))
        )
          return false;
        const wire = await operate({ op: 'history', threadId });
        return wire.history.some(
          (s) =>
            s.checkpoint.checkpoint_id === source.checkpoint_id &&
            s.checkpoint.checkpoint_ns === source.checkpoint_ns &&
            (s.checkpoint.checkpoint_map === undefined
              ? source.checkpoint_map === undefined ||
                Object.keys(source.checkpoint_map).length === 0
              : JSON.stringify(s.checkpoint.checkpoint_map) ===
                JSON.stringify(source.checkpoint_map))
        );
      }
      if (suffix === '/state/checkpoint' && request.method === 'POST') {
        if (
          !only(body, ['checkpoint']) ||
          !(await knownCheckpoint(body.checkpoint))
        ) {
          json(response, {}, 400);
          return true;
        }
        const mode = stateMode;
        const wire = await operate({
          op: 'state',
          threadId,
          checkpoint: body.checkpoint,
        });
        const state = wire.state;
        if (!['safe', 'hold'].includes(mode))
          injections.push({ kind: 'state', mode, threadId });
        if (mode === 'failure') throw new Error('State unavailable');
        if (mode === 'changed' && state.values.messages?.length)
          state.values.messages.at(-1).content = 'Changed canonical content';
        if (mode === 'foreign') state.checkpoint.thread_id = randomUUID();
        if (mode === 'malformed')
          state.values.messages = [
            { type: 'human', content: { bad: true }, id: 'malformed' },
          ];
        const finish = () => {
          if (captured === epoch && !closed) json(response, state);
        };
        if (holds.delete('state') || mode === 'hold')
          hold('state', response, finish, threadId);
        else finish();
        return true;
      }
      if (suffix === '/history' && request.method === 'POST') {
        if (
          !only(body, ['limit']) ||
          !Number.isInteger(body.limit) ||
          body.limit < 1 ||
          body.limit > 100
        ) {
          json(response, {}, 400);
          return true;
        }
        const mode = historyMode,
          wire = await operate({ op: 'history', threadId }),
          history = wire.history.slice(0, body.limit),
          latest = history[0];
        if (!['safe', 'hold'].includes(mode))
          injections.push({ kind: 'history', mode, threadId });
        if (mode === 'failure') throw new Error('History unavailable');
        if (latest && mode === 'changed')
          latest.values.messages.at(-1).content = 'Changed canonical content';
        if (latest && mode === 'missing') latest.values.messages.pop();
        if (latest && mode === 'pending') latest.next = ['unexpected'];
        if (latest && mode === 'foreign')
          latest.checkpoint.thread_id = randomUUID();
        const finish = () => {
          if (captured === epoch && !closed) json(response, history);
        };
        if (holds.delete('history') || mode === 'hold')
          hold('history', response, finish, threadId);
        else finish();
        return true;
      }
      if (suffix === '/runs/stream' && request.method === 'POST') {
        const message = body.input?.messages?.[0];
        if (
          !only(body, [
            'assistant_id',
            'input',
            'checkpoint',
            'stream_mode',
            'stream_subgraphs',
            'stream_resumable',
            'on_disconnect',
          ]) ||
          body.assistant_id !== 'c-timeline' ||
          !only(body.input, ['messages']) ||
          !Array.isArray(body.input.messages) ||
          body.input.messages.length !== 1 ||
          !only(message, ['type', 'id', 'content']) ||
          message.type !== 'human' ||
          typeof message.content !== 'string' ||
          typeof message.id !== 'string' ||
          !message.id.trim() ||
          body.stream_subgraphs !== true ||
          body.stream_resumable !== true ||
          body.on_disconnect !== 'continue' ||
          !Array.isArray(body.stream_mode) ||
          !body.stream_mode.length ||
          new Set(body.stream_mode).size !== body.stream_mode.length ||
          body.stream_mode.some(
            (mode) =>
              ![
                'values',
                'messages-tuple',
                'updates',
                'custom',
                'checkpoints',
              ].includes(mode)
          )
        ) {
          json(response, {}, 400);
          return true;
        }
        if (
          body.checkpoint !== undefined &&
          !(await knownCheckpoint(body.checkpoint))
        ) {
          json(response, {}, 400);
          return true;
        }
        const runId = randomUUID();
        const wire = await operate({
          runId,
          op: 'submit',
          checkpoint: body.checkpoint,
          threadId,
          messages: body.input.messages,
        });
        // Keep native checkpoints inside the worker for exact terminal identity,
        // but emit only the modes this HTTP caller actually requested.
        const modes = new Set(
          body.stream_mode.map((mode) =>
            mode === 'messages-tuple' ? 'messages' : mode
          )
        );
        const events = wire.events.filter(
          ([kind]) => kind === 'error' || modes.has(kind)
        );
        const run = { run_id: runId, thread_id: threadId, status: 'running' };
        runs.set(runId, run);
        if (response.destroyed) {
          run.status = 'interrupted';
          return true;
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'content-location': `/threads/${threadId}/runs/${runId}`,
        });
        response.write(event('metadata', { run_id: runId }));
        let sent = 0;
        const finish = () => {
          if (response.destroyed || captured !== epoch || closed) return;
          while (sent < events.length) response.write(event(...events[sent++]));
          run.status = wire.graphFailure
            ? 'error'
            : wire.state.next.length
            ? 'interrupted'
            : 'success';
          response.end();
        };
        if (holds.delete('stream')) {
          const firstMessage = events.findIndex(
            ([kind]) => kind === 'messages'
          );
          const limit =
            firstMessage < 0 ? Math.min(2, events.length) : firstMessage + 1;
          while (sent < limit) response.write(event(...events[sent++]));
          hold('stream', response, finish, threadId, run);
        } else finish();
        return true;
      }
      if (/^\/runs\/[^/]+$/.test(suffix) && request.method === 'GET') {
        const run = runs.get(suffix.split('/').at(-1));
        json(
          response,
          run?.thread_id === threadId ? run : {},
          run?.thread_id === threadId ? 200 : 404
        );
        return true;
      }
      json(response, {}, 404);
      return true;
    } catch {
      json(response, { error: 'Graph fixture failed.' }, 500);
      return true;
    }
  };
  handle.close = () => {
    if (closing) return closing;
    closed = true;
    closing = reset();
    return closing;
  };
  return handle;
}
