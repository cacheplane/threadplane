/** Local captured replay of the actual graph/InMemorySaver. No provider timing
 * or platform durability claim. This module is excluded from application src. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PYTHON = fileURLToPath(
  new URL('../../cockpit/chat/debug/python/.venv/bin/python', import.meta.url)
);
const FRAME = 65536,
  TOTAL = 2 * 1024 * 1024;
const GRACEFUL_EXIT_MS = 2000;
const encode = (kind, data) =>
  `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const abortError = () =>
  Object.assign(Error('Local command aborted'), { name: 'AbortError' });

/** Exactly one directly spawned Python PID/process group, synchronously owned. */
export function createDebugWorker({
  timeoutMs = 10000,
  outputBytes = TOTAL,
  fault,
  providerVariant = 'natural',
  metadataFailure,
} = {}) {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 10000 ||
    !Number.isInteger(outputBytes) ||
    outputBytes < 1 ||
    outputBytes > TOTAL
  )
    throw Error('Invalid fixed worker bounds');
  if (
    ![
      undefined,
      'malformed',
      'partial-oversize',
      'stderr-overflow',
      'ignore-term',
      'late-result',
      'delayed-close',
      'hung-close',
      'spawn-failure',
    ].includes(fault) ||
    !['natural', 'unicode'].includes(providerVariant) ||
    ![undefined, 'read', 'update'].includes(metadataFailure) ||
    (fault && metadataFailure !== undefined)
  )
    throw Error('Invalid closed worker control');
  const child = spawn(
    fault === 'spawn-failure' ? PYTHON + '.deliberately-missing' : PYTHON,
    [
      '-E',
      '-B',
      'scripts/react-cockpit/chat-debug-wire.py',
      ...(fault && fault !== 'spawn-failure'
        ? ['--fault=' + fault]
        : providerVariant === 'unicode'
        ? ['--variant=unicode']
        : []),
      ...(metadataFailure ? ['--metadata-failure=' + metadataFailure] : []),
    ],
    {
      cwd: ROOT,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/bin:/bin',
        LANG: 'en_US.UTF-8',
        LANGSMITH_TRACING: 'false',
        LANGCHAIN_TRACING_V2: 'false',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    }
  );
  const receipt = {
    pid: child.pid ?? null,
    pgid: child.pid ?? null,
    reaped: false,
    exitCode: null,
    signal: null,
    stdoutBytes: 0,
    stderrBytes: 0,
    stderrSha256: null,
    stdoutFrames: 0,
    protocolErrors: 0,
    signals: [],
    activeCommands: 0,
  };
  let pending,
    buffer = Buffer.alloc(0),
    closed = false,
    failure,
    killTimer,
    sequence = 0,
    finish;
  const ended = new Promise((resolve) => {
    finish = resolve;
  });
  const diagnosticHash = createHash('sha256');
  function signal(name) {
    if (!receipt.pid || receipt.reaped) return;
    try {
      process.kill(-receipt.pgid, name);
      receipt.signals.push({ signal: name, result: 'sent' });
    } catch (error) {
      receipt.signals.push({ signal: name, result: error.code });
    }
  }
  function terminate(reason) {
    failure ??= reason;
    closed = true;
    if (pending) {
      pending.reject(reason);
      pending = undefined;
      receipt.activeCommands = 0;
    }
    signal('SIGTERM');
    killTimer ??= setTimeout(() => signal('SIGKILL'), 250);
  }
  // All pipe/error/close handlers exist before the first asynchronous boundary.
  child.once('error', () => terminate(Error('Local worker spawn failed')));
  child.stdin.on('error', () => terminate(Error('Local worker input closed')));
  child.stdout.on('data', (bytes) => {
    receipt.stdoutBytes += bytes.length;
    if (receipt.stdoutBytes > outputBytes)
      return terminate(Error('Worker total output bound'));
    // Check every segment before concatenation, including incomplete frames.
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline + 1;
      if (buffer.length + end - offset > FRAME)
        return terminate(Error('Worker frame bound'));
      buffer = Buffer.concat([buffer, bytes.subarray(offset, end)]);
      offset = end;
      if (newline < 0) break;
      try {
        const frame = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(buffer)
        );
        buffer = Buffer.alloc(0);
        if (
          !pending ||
          frame.requestId !== pending.id ||
          Object.keys(frame).sort().join() !==
            (frame.error ? 'error,requestId' : 'requestId,result')
        )
          throw Error('Unowned worker frame');
        const admitted = pending;
        receipt.stdoutFrames++;
        pending = undefined;
        receipt.activeCommands = 0;
        if (frame.error) admitted.reject(Error('Local graph request rejected'));
        else admitted.resolve(frame.result);
      } catch {
        receipt.protocolErrors++;
        return terminate(Error('Malformed worker frame'));
      }
    }
  });
  child.stderr.on('data', (bytes) => {
    diagnosticHash.update(bytes);
    receipt.stderrBytes += bytes.length;
    if (receipt.stderrBytes > 65536)
      terminate(Error('Worker diagnostic bound'));
  });
  child.once('close', (code, sig) => {
    receipt.reaped = true;
    receipt.exitCode = code;
    receipt.signal = sig;
    receipt.stderrSha256 = diagnosticHash.digest('hex');
    clearTimeout(killTimer);
    if (pending) {
      pending.reject(Error('Local worker exited'));
      pending = undefined;
      receipt.activeCommands = 0;
    }
    closed = true;
    finish();
  });
  async function command(command, fields = {}, { signal: external } = {}) {
    if (pending) throw Error('Worker busy');
    if (closed) throw failure ?? Error('Worker closed');
    if (sequence >= 64) throw Error('Worker command bound');
    if (external?.aborted) throw abortError();
    const id = ++sequence;
    const frame = Buffer.from(
      JSON.stringify({ requestId: id, command, ...fields }) + '\n'
    );
    if (frame.length > FRAME) throw Error('Worker input frame bound');
    let timer, unlink;
    const result = new Promise((resolve, reject) => {
      pending = { id, resolve, reject };
      receipt.activeCommands = 1;
      timer = setTimeout(
        () => terminate(Error('Worker command deadline')),
        timeoutMs
      );
      if (external) {
        const abort = () => terminate(abortError());
        external.addEventListener('abort', abort, { once: true });
        unlink = () => external.removeEventListener('abort', abort);
      }
      child.stdin.write(frame);
    });
    try {
      return await result;
    } catch (error) {
      if (closed) await ended;
      throw error;
    } finally {
      clearTimeout(timer);
      unlink?.();
    }
  }
  let stopping;
  function close() {
    return (stopping ??= (async () => {
      if (!closed && !pending) {
        try {
          await command('close');
          child.stdin.end();
          let graceful;
          await Promise.race([
            ended,
            new Promise((resolve) => {
              graceful = setTimeout(resolve, GRACEFUL_EXIT_MS);
            }),
          ]);
          clearTimeout(graceful);
        } catch {
          /* owner drains below */
        }
      }
      if (!receipt.reaped) terminate(Error('Worker closed'));
      await ended;
      if (buffer.length) failure ??= Error('Partial worker frame');
    })());
  }
  return { command, close, receipt, ended };
}

function json(response, value, status = 200) {
  if (!response.destroyed && !response.writableEnded) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  }
}

async function bodyOf(request) {
  let size = 0;
  const chunks = [];
  const timer = setTimeout(() => request.destroy(), 2000);
  try {
    for await (const bytes of request) {
      size += bytes.length;
      if (size > FRAME)
        throw Object.assign(Error('Input bound'), { status: 413 });
      chunks.push(bytes);
    }
    return size
      ? JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks, size)
          )
        )
      : {};
  } finally {
    clearTimeout(timer);
  }
}

export function createChatDebugFixture(options = {}) {
  const threads = new Set(),
    runs = new Map(),
    children = [],
    captures = [],
    requests = [];
  const handlers = new Set(),
    responses = new Map(),
    reads = new Set(),
    streams = new Set();
  let worker,
    busy = false,
    closed = false,
    closing,
    holdRead,
    holdStream = false,
    server;
  const receipt = () => ({
    closed,
    active: {
      children: children.filter((c) => !c.receipt.reaped).length,
      streams: streams.size,
      reads: reads.size,
      handlers: handlers.size,
      responses: responses.size,
    },
    children: children.map((c) => ({ ...c.receipt })),
  });
  function getWorker() {
    if (!worker) {
      worker = createDebugWorker(options);
      children.push(worker);
      options.onChild?.({ ...worker.receipt });
    }
    return worker;
  }
  function hold(set, response, finish) {
    let resolve;
    const done = new Promise((r) => {
      resolve = r;
    });
    const owner = {
      release: () => {
        if (set.delete(owner)) {
          clearTimeout(owner.timer);
          finish();
          resolve();
        }
      },
      cancel: () => {
        if (set.delete(owner)) {
          clearTimeout(owner.timer);
          resolve();
        }
      },
      response,
    };
    owner.timer = setTimeout(() => {
      owner.cancel();
      response.destroy();
    }, 10000);
    set.add(owner);
    response.once('close', owner.cancel);
    return done.finally(() => response.off('close', owner.cancel));
  }
  async function dispatch(request, response, path, controller) {
    if (closed) {
      json(response, {}, 503);
      return true;
    }
    const body = await bodyOf(request);
    if (requests.length >= 64) {
      json(response, {}, 429);
      return true;
    }
    requests.push({ path, method: request.method, body });
    if (busy) {
      json(response, { error: 'Fixture busy' }, 409);
      return true;
    }
    busy = true;
    try {
      if (path === '/api/threads' && request.method === 'POST') {
        if (
          Object.keys(body).some(
            (k) => !['thread_id', 'if_exists', 'metadata'].includes(k)
          ) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            body.thread_id
          ) ||
          body.if_exists !== 'raise' ||
          threads.has(body.thread_id) ||
          threads.size >= 4
        ) {
          json(response, {}, 400);
          return true;
        }
        const value = await getWorker().command(
          'create',
          { threadId: body.thread_id },
          { signal: controller.signal }
        );
        threads.add(body.thread_id);
        json(response, value);
        return true;
      }
      const match = /^\/api\/threads\/([^/]+)(.*)$/.exec(path);
      if (!match || !threads.has(match[1])) {
        json(response, {}, 404);
        return true;
      }
      const [, threadId, route] = match;
      if (
        (route === '/state' && request.method === 'GET') ||
        (route === '/state/checkpoint' && request.method === 'POST') ||
        (route === '/history' && request.method === 'POST')
      ) {
        const command =
          route === '/history'
            ? 'history'
            : request.method === 'GET'
            ? 'current'
            : 'checkpoint';
        if (
          Object.keys(body).some(
            (k) =>
              !(
                command === 'history'
                  ? ['limit']
                  : command === 'checkpoint'
                  ? ['checkpoint']
                  : []
              ).includes(k)
          ) ||
          (command === 'history' &&
            body.limit !== undefined &&
            (!Number.isInteger(body.limit) ||
              body.limit < 1 ||
              body.limit > 10)) ||
          (command === 'checkpoint' && !body.checkpoint)
        ) {
          json(response, {}, 400);
          return true;
        }
        const result = await getWorker().command(
          command,
          {
            threadId,
            ...(command === 'history'
              ? { limit: body.limit ?? 10 }
              : command === 'checkpoint'
              ? { checkpoint: body.checkpoint }
              : {}),
          },
          { signal: controller.signal }
        );
        if (holdRead === command || holdRead === 'all')
          await hold(reads, response, () => json(response, result));
        else json(response, result);
        return true;
      }
      if (route === '/runs/stream' && request.method === 'POST') {
        const human = body.input?.messages?.[0];
        if (
          body.assistant_id !== 'c-debug' ||
          body.command ||
          body.checkpoint ||
          Object.keys(body.input ?? {}).join() !== 'messages' ||
          body.input.messages.length !== 1 ||
          human?.type !== 'human' ||
          typeof human.id !== 'string' ||
          !human.id ||
          typeof human.content !== 'string' ||
          !human.content ||
          [...human.content].length > 2000 ||
          Object.keys(human).sort().join() !== 'content,id,type'
        ) {
          json(response, {}, 400);
          return true;
        }
        const runId = randomUUID(),
          run = { run_id: runId, thread_id: threadId, status: 'running' };
        runs.set(runId, run);
        const wire = await getWorker().command(
          'send',
          { threadId, human },
          { signal: controller.signal }
        );
        if (closed || controller.signal.aborted) return true;
        const capture = {
          threadId,
          runId,
          ...wire,
          localCapturedReplay: true,
          sse: '',
          sseSha256: '',
        };
        let replay = wire.events;
        if (options.omitProcessCallback) {
          const processId = wire.state.values.messages.at(-2).id;
          const omitted = wire.events.filter(
            ([kind, value]) =>
              kind === 'messages' &&
              value[1].langgraph_node === 'process' &&
              value[0].id === processId &&
              value[0].type === 'ai'
          );
          if (omitted.length !== 1)
            throw Error('Observed finalized process identity is ambiguous');
          replay = wire.events.filter((value) => value !== omitted[0]);
          capture.omission = {
            label: 'Local transport projection regression only',
            count: 1,
            id: processId,
            node: 'process',
            event: omitted[0],
          };
        }
        capture.originalSseSha256 = hash(
          encode('metadata', { run_id: runId }) +
            wire.events.map((e) => encode(...e)).join('')
        );
        captures.push(capture);
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'content-location': `/threads/${threadId}/runs/${runId}`,
        });
        const write = (kind, data) => {
          const text = encode(kind, data);
          capture.sse += text;
          response.write(text);
        };
        write('metadata', { run_id: runId });
        let sent = 0;
        const finish = () => {
          if (closed || response.destroyed) {
            run.status = 'interrupted';
            return;
          }
          while (sent < replay.length) write(...replay[sent++]);
          capture.sseSha256 = hash(capture.sse);
          run.status = 'success';
          response.end();
        };
        if (holdStream) {
          while (sent < replay.length) {
            const e = replay[sent++];
            write(...e);
            if (e[0] === 'messages') break;
          }
          await hold(streams, response, finish);
          if (response.destroyed && !response.writableEnded)
            run.status = 'interrupted';
        } else finish();
        return true;
      }
      const runId = /^\/runs\/([^/]+)$/.exec(route)?.[1];
      if (
        runId &&
        request.method === 'GET' &&
        runs.get(runId)?.thread_id === threadId
      ) {
        json(response, runs.get(runId));
        return true;
      }
      json(response, {}, 404);
      return true;
    } finally {
      busy = false;
    }
  }
  async function handle(request, response, path) {
    if (!path.startsWith('/api/')) return false;
    if (handlers.size >= 8) {
      json(response, {}, 429);
      return true;
    }
    const controller = new AbortController();
    const abort = () => {
      if (!response.writableEnded) controller.abort();
    };
    let resolveClose;
    responses.set(
      response,
      new Promise((resolve) => {
        resolveClose = resolve;
      })
    );
    const done = () => {
      responses.delete(response);
      response.off('close', done);
      resolveClose();
    };
    response.once('close', done);
    response.once('close', abort);
    const task = dispatch(request, response, path, controller).catch(
      (error) => {
        if (!controller.signal.aborted)
          json(
            response,
            { error: 'Local fixture request rejected' },
            error.status ?? 400
          );
        return true;
      }
    );
    handlers.add(task);
    try {
      return await task;
    } finally {
      handlers.delete(task);
      response.off('close', abort);
    }
  }
  async function reset() {
    const responseClosures = [...responses.values()];
    for (const owner of [...reads, ...streams]) {
      owner.cancel();
      owner.response.destroy();
    }
    for (const response of responses.keys()) response.destroy();
    await worker?.close();
    await Promise.allSettled([...handlers]);
    await Promise.all(responseClosures);
    worker = undefined;
    threads.clear();
    runs.clear();
    captures.length = 0;
    requests.length = 0;
    holdRead = undefined;
    holdStream = false;
  }
  function close() {
    return (closing ??= (async () => {
      closed = true;
      await reset();
      if (server) {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
      }
    })());
  }
  return {
    handle,
    close,
    reset,
    receipt,
    captures,
    requests,
    holdReads: (kind) => {
      if (
        !['current', 'history', 'checkpoint', 'all', undefined].includes(kind)
      )
        throw Error('Invalid read control');
      holdRead = kind;
    },
    holdStreams: (value) => {
      holdStream = Boolean(value);
    },
    release: () => {
      for (const owner of [...reads, ...streams]) owner.release();
    },
    async listen() {
      server = createServer((req, res) => {
        handle(req, res, new URL(req.url, 'http://localhost').pathname).then(
          (ok) => {
            if (!ok) json(res, {}, 404);
          }
        );
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${server.address().port}/api`;
    },
  };
}
