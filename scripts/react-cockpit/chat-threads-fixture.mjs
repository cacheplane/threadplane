/** Local installed-SDK fixture. Real graph checkpoints never become public assets. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
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

export function createChatThreadsFixture({
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
        'cockpit/chat/threads/python',
        'python',
        'scripts/react-cockpit/chat-threads-wire.py',
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ),
} = {}) {
  let worker,
    queue = Promise.resolve(),
    epoch = 0,
    closed = false,
    closing;
  let requests = [],
    proofs = [],
    injections = [];
  let historyMode = 'safe',
    titleMode = 'safe',
    failCreate = false;
  const held = new Map(),
    holds = new Set(),
    threads = new Set(),
    runs = new Map(),
    operations = new Set();
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
      if (!result.proof?.actualCompiledGraph)
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
    historyMode = titleMode = 'safe';
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
        activeTitle: held.has('title'),
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
      if (pathname === '/__worker-failure') {
        await operate({ op: 'configure' });
        await worker.close();
        json(response, {});
        return true;
      }
      if (pathname === '/__metadata-failure') {
        await operate({ op: 'configure', failMetadata: true });
        json(response, {});
        return true;
      }
      if (
        ['/__hold-stream', '/__hold-history', '/__hold-title'].includes(
          pathname
        )
      ) {
        holds.add(pathname.slice('/__hold-'.length));
        json(response, {});
        return true;
      }
      if (
        ['/__release', '/__release-history', '/__release-title'].includes(
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
      if (
        pathname.startsWith('/__history/') ||
        pathname.startsWith('/__title/')
      ) {
        const mode = pathname.split('/').at(-1),
          history = pathname.startsWith('/__history/');
        const allowed = history
          ? [
              'safe',
              'hold',
              'changed',
              'missing',
              'pending',
              'foreign',
              'failure',
            ]
          : [
              'safe',
              'hold',
              'missing',
              'wrong-thread',
              'invalid',
              'titlefailure',
              'literal',
              'long',
            ];
        if (!allowed.includes(mode)) {
          json(response, {}, 400);
          return true;
        }
        if (history) historyMode = mode;
        else titleMode = mode;
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
      if (suffix === '/history' && request.method === 'POST') {
        const mode = historyMode,
          wire = await operate({ op: 'history', threadId }),
          history = wire.history,
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
      if (suffix === '' && request.method === 'GET') {
        const mode = titleMode,
          wire = await operate({ op: 'title', threadId }),
          value = wire.thread;
        if (!['safe', 'hold'].includes(mode))
          injections.push({ kind: 'title', mode, threadId });
        if (mode === 'titlefailure') throw new Error('Title unavailable');
        if (mode === 'missing') delete value.metadata.title;
        if (mode === 'wrong-thread') value.thread_id = randomUUID();
        if (mode === 'invalid') value.metadata.title = { invalid: true };
        if (mode === 'literal')
          value.metadata.title = '<script>alert("title")</script>';
        if (mode === 'long')
          value.metadata.title = 'Long authored title '.repeat(30);
        const finish = () => {
          if (captured === epoch && !closed) json(response, value);
        };
        if (holds.delete('title') || mode === 'hold')
          hold('title', response, finish, threadId);
        else finish();
        return true;
      }
      if (suffix === '/runs/stream' && request.method === 'POST') {
        const message = body.input?.messages?.[0];
        if (
          body.assistant_id !== 'c-threads' ||
          [
            'command',
            'checkpoint',
            'checkpoint_id',
            'checkpoint_during',
            'multitask_strategy',
          ].some((key) => body[key] !== undefined) ||
          body.input?.messages?.length !== 1 ||
          message?.type !== 'human' ||
          typeof message.content !== 'string' ||
          typeof message.id !== 'string'
        ) {
          json(response, {}, 400);
          return true;
        }
        const wire = await operate({
          op: 'submit',
          threadId,
          messages: body.input.messages,
        });
        const runId = randomUUID(),
          run = { run_id: runId, thread_id: threadId, status: 'running' };
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
          while (sent < wire.events.length)
            response.write(event(...wire.events[sent++]));
          run.status = wire.graphFailure
            ? 'error'
            : wire.state.next.length
            ? 'interrupted'
            : 'success';
          response.end();
        };
        if (holds.delete('stream')) {
          const firstMessage = wire.events.findIndex(
            ([kind]) => kind === 'messages'
          );
          const limit =
            firstMessage < 0
              ? Math.min(2, wire.events.length)
              : firstMessage + 1;
          while (sent < limit) response.write(event(...wire.events[sent++]));
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
