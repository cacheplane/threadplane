/** Local compiled graph/installed SDK seam. Never imported by production assets. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAX_BODY = 65536,
  MAX_OUTPUT = 2 * 1024 * 1024;
const json = (res, value, status = 200) => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};
const event = (kind, value) =>
  `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function createChatThemingFixture({
  wireTimeoutMs = 10000,
  wireOutputBytes = MAX_OUTPUT,
} = {}) {
  if (
    !Number.isInteger(wireTimeoutMs) ||
    wireTimeoutMs < 1 ||
    wireTimeoutMs > 10000 ||
    !Number.isInteger(wireOutputBytes) ||
    wireOutputBytes < 1 ||
    wireOutputBytes > MAX_OUTPUT
  )
    throw Error(
      'Local wire bounds must be positive and cannot exceed the fixed maxima'
    );
  const threads = new Map(),
    runs = new Map(),
    children = new Set();
  const childReceipts = [],
    streams = new Set(),
    histories = new Set(),
    handlers = new Set(),
    responses = new Map();
  let requests = [],
    captures = [],
    historyMode = 'safe',
    closed = false,
    closing;
  const receipt = () => ({
    closed,
    active: {
      children: children.size,
      streams: streams.size,
      histories: histories.size,
      handlers: handlers.size,
    },
    responseOpen: responses.size,
    children: childReceipts.map((r) => ({ ...r })),
  });
  function terminate(owner, signal) {
    if (owner.child.exitCode !== null || owner.child.signalCode !== null)
      return;
    try {
      process.kill(-owner.pid, signal);
      owner.record.signals.push({ signal, group: owner.pid, result: 'sent' });
    } catch (error) {
      owner.record.signalErrors.push({ signal, code: error.code });
      owner.record.signals.push({
        signal,
        group: owner.pid,
        result: error.code,
      });
      if (error.code !== 'ESRCH') {
        // Direct Python is the sole owned child: keep draining even if the OS
        // refuses a group signal. This is not a cancellation acknowledgment.
        try {
          const sent = owner.child.kill(signal);
          owner.record.signals.push({
            signal,
            pid: owner.pid,
            directChild: true,
            result: sent ? 'sent' : 'not-sent',
          });
        } catch (fallbackError) {
          owner.record.signalErrors.push({
            signal,
            directChild: true,
            code: fallbackError.code,
          });
          owner.record.signals.push({
            signal,
            pid: owner.pid,
            directChild: true,
            result: fallbackError.code,
          });
        }
      }
    }
  }
  async function graphWire(input) {
    if (closed) throw Error('Fixture closed');
    const child = spawn(
      fileURLToPath(
        new URL(
          '../../cockpit/chat/theming/python/.venv/bin/python',
          import.meta.url
        )
      ),
      ['-E', '-B', 'scripts/react-cockpit/chat-theming-wire.py'],
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
    const record = {
      pid: child.pid ?? null,
      pgid: child.pid ?? null,
      reaped: false,
      exitCode: null,
      signal: null,
      stdoutBytes: 0,
      stderrBytes: 0,
      signalErrors: [],
      signals: [],
    };
    childReceipts.push(record);
    let finish, fail;
    const ended = new Promise((resolve) => {
      finish = resolve;
    });
    const result = new Promise((resolve, rejectPromise) => {
      fail = rejectPromise;
      let output = '',
        rejected = false;
      // Handlers attach synchronously before acquisition can settle.
      child.once('error', (error) => {
        rejected = true;
        rejectPromise(error);
      });
      child.stdout.on('data', (bytes) => {
        record.stdoutBytes += bytes.length;
        if (record.stdoutBytes > wireOutputBytes) {
          rejected = true;
          rejectPromise(Error('Wire output bound exceeded'));
          terminate(owner, 'SIGTERM');
        } else output += bytes;
      });
      child.stderr.on('data', (bytes) => {
        record.stderrBytes += bytes.length;
        if (record.stderrBytes > 65536) {
          rejected = true;
          rejectPromise(Error('Wire diagnostic bound exceeded'));
          terminate(owner, 'SIGTERM');
        }
      });
      child.stdin.on('error', () => {
        /* close/error is settled by the child owner */
      });
      child.once('close', (code, signal) => {
        clearTimeout(owner.timer);
        clearTimeout(owner.killTimer);
        record.reaped = true;
        record.exitCode = code;
        record.signal = signal;
        children.delete(owner);
        finish();
        if (rejected) return;
        if (closed || code !== 0)
          return rejectPromise(Error('Compiled graph child failed or closed'));
        try {
          resolve(JSON.parse(output));
        } catch {
          rejectPromise(Error('Invalid compiled graph output'));
        }
      });
    });
    const owner = {
      child,
      pid: child.pid,
      record,
      ended,
      timer: null,
      killTimer: null,
      fail,
    };
    children.add(owner);
    owner.timer = setTimeout(() => {
      fail(Error('Compiled graph deadline exceeded'));
      terminate(owner, 'SIGTERM');
      owner.killTimer = setTimeout(() => terminate(owner, 'SIGKILL'), 250);
    }, wireTimeoutMs);
    child.stdin.end(JSON.stringify(input));
    try {
      return await result;
    } finally {
      if (!record.reaped) {
        terminate(owner, 'SIGTERM');
        owner.killTimer ??= setTimeout(() => terminate(owner, 'SIGKILL'), 250);
      }
      await Promise.race([
        ended,
        delay(1500).then(() => {
          if (!record.reaped) throw Error('Owned wire child did not reap');
        }),
      ]);
    }
  }
  function hold(set, response, finish, onAbort = () => {}) {
    const held = {
      response,
      finish: () => {
        clearTimeout(held.timer);
        set.delete(held);
        finish();
      },
      timer: null,
    };
    set.add(held);
    response.once('close', () => {
      clearTimeout(held.timer);
      if (set.delete(held)) onAbort();
    });
    held.timer = setTimeout(() => {
      set.delete(held);
      onAbort();
      response.destroy();
    }, 30000);
    return held;
  }
  async function bodyOf(request) {
    const chunks = [];
    let bytes = 0;
    const timer = setTimeout(() => request.destroy(), 2000);
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > MAX_BODY) {
          const e = Error('Input bound');
          e.status = 413;
          throw e;
        }
        chunks.push(chunk);
      }
      if (bytes === 0) return {};
      // HTTP chunks can split a UTF-8 code point. Enforce the raw byte bound
      // first, then decode the complete input once without replacement text.
      const body = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks, bytes)
      );
      return JSON.parse(body);
    } finally {
      clearTimeout(timer);
    }
  }
  async function dispatch(request, response, pathname) {
    if (closed) {
      json(response, { error: 'Fixture closed' }, 503);
      return true;
    }
    if (pathname === '/__requests') {
      json(response, requests);
      return true;
    }
    if (pathname === '/__captures') {
      json(response, captures);
      return true;
    }
    if (pathname === '/__graph-proof') {
      json(
        response,
        captures.map((c) => c.proof)
      );
      return true;
    }
    if (pathname === '/__lifetime') {
      json(response, receipt());
      return true;
    }
    if (pathname.startsWith('/__')) {
      if (request.method !== 'POST') {
        json(response, {}, 405);
        return true;
      }
      if (pathname === '/__reset') {
        if (children.size || streams.size || histories.size) {
          json(response, { error: 'Owned work remains' }, 409);
          return true;
        }
        requests = [];
        captures = [];
        threads.clear();
        runs.clear();
        historyMode = 'safe';
        json(response, {});
        return true;
      }
      if (pathname === '/__release') {
        for (const h of [...streams]) h.finish();
        json(response, {});
        return true;
      }
      if (pathname === '/__release-history') {
        for (const h of [...histories]) h.finish();
        json(response, {});
        return true;
      }
      if (pathname === '/__history/hold' || pathname === '/__history/safe') {
        historyMode = pathname.endsWith('hold') ? 'hold' : 'safe';
        json(response, {});
        return true;
      }
      json(response, {}, 404);
      return true;
    }
    if (!/^\/(?:api|developer-api)\//.test(pathname)) return false;
    let body;
    try {
      body = await bodyOf(request);
    } catch (error) {
      json(response, { error: 'Invalid local input' }, error.status ?? 400);
      return true;
    }
    if (requests.length >= 256) {
      json(response, {}, 429);
      return true;
    }
    requests.push({ path: pathname, method: request.method, body });
    if (/\/threads$/.test(pathname) && request.method === 'POST') {
      if (
        !/^[0-9a-f-]{36}$/.test(body.thread_id) ||
        body.if_exists !== 'raise' ||
        threads.has(body.thread_id)
      ) {
        json(response, {}, 400);
        return true;
      }
      threads.set(body.thread_id, {
        messages: [],
        title: null,
        next: [],
        checkpoint: null,
      });
      json(response, { thread_id: body.thread_id });
      return true;
    }
    const threadId = /\/threads\/([^/]+)/.exec(pathname)?.[1],
      state = threads.get(threadId);
    if (!state) {
      json(response, {}, 404);
      return true;
    }
    if (pathname.endsWith('/history') && request.method === 'POST') {
      const finish = () => {
        const saved = [
          {
            values: { messages: state.messages },
            next: state.next,
            checkpoint: state.checkpoint,
            parent_checkpoint: state.parentCheckpoint,
            created_at: state.createdAt,
            metadata: {},
            tasks: [],
          },
        ];
        const capture = captures.findLast((c) => c.threadId === threadId);
        capture?.historyResponses.push(saved);
        json(response, saved);
      };
      if (historyMode === 'hold') hold(histories, response, finish);
      else finish();
      return true;
    }
    if (pathname.endsWith('/runs/stream') && request.method === 'POST') {
      const human = body.input?.messages?.[0];
      if (
        body.assistant_id !== 'c-theming' ||
        body.command ||
        body.input?.messages?.length !== 1 ||
        human?.type !== 'human' ||
        typeof human.id !== 'string' ||
        typeof human.content !== 'string' ||
        state.messages.some((m) => m.id === human.id) ||
        streams.size ||
        children.size ||
        captures.length >= 16 ||
        childReceipts.length >= 256
      ) {
        json(response, {}, 400);
        return true;
      }
      const runId = randomUUID(),
        run = { thread_id: threadId, status: 'running' };
      runs.set(runId, run);
      let wire;
      try {
        wire = await graphWire({
          threadId,
          answerId: 'authored-answer-' + runId,
          messages: [...state.messages, human],
          title: state.title,
        });
      } catch {
        json(response, { error: 'Compiled graph seam failed' }, 500);
        return true;
      }
      if (closed || response.destroyed) {
        run.status = 'interrupted';
        return true;
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'content-location': `/threads/${threadId}/runs/${runId}`,
      });
      const capture = {
        threadId,
        runId,
        proof: wire.proof,
        titleUpdates: wire.titleUpdates,
        events: wire.events,
        savedMessages: wire.messages,
        checkpoint: wire.checkpoint,
        parentCheckpoint: wire.parentCheckpoint,
        createdAt: wire.createdAt,
        historyResponses: [],
        sse: '',
        sseSha256: '',
      };
      captures.push(capture);
      const write = (kind, value) => {
        const bytes = event(kind, value);
        capture.sse += bytes;
        capture.sseSha256 = createHash('sha256')
          .update(capture.sse)
          .digest('hex');
        response.write(bytes);
      };
      write('metadata', { run_id: runId });
      let sent = 0;
      const finish = () => {
        if (response.destroyed || closed) return;
        while (sent < wire.events.length) write(...wire.events[sent++]);
        state.messages = wire.messages;
        state.next = wire.next;
        state.title = wire.title;
        state.checkpoint = wire.checkpoint;
        state.parentCheckpoint = wire.parentCheckpoint;
        state.createdAt = wire.createdAt;
        run.status = 'success';
        response.end();
      };
      if (human.content === 'Hold') {
        let content = '';
        while (sent < wire.events.length) {
          const [kind, value] = wire.events[sent++];
          write(kind, value);
          if (kind === 'messages') {
            content += value[0].content;
            if (content.includes('answer')) break;
          }
        }
        hold(streams, response, finish, () => {
          run.status = 'interrupted';
        }).runId = runId;
      } else finish();
      return true;
    }
    const cancelId = /\/runs\/([^/]+)\/cancel$/.exec(pathname)?.[1];
    if (
      cancelId &&
      request.method === 'POST' &&
      runs.get(cancelId)?.thread_id === threadId
    ) {
      if (runs.get(cancelId).status === 'running')
        runs.get(cancelId).status = 'interrupted';
      for (const h of [...streams]) {
        if (h.runId !== cancelId) continue;
        clearTimeout(h.timer);
        streams.delete(h);
        h.response.end();
      }
      json(response, {});
      return true;
    }
    const runId = /\/runs\/([^/]+)$/.exec(pathname)?.[1],
      run = runs.get(runId);
    if (request.method === 'GET' && run?.thread_id === threadId) {
      json(response, { run_id: runId, ...run });
      return true;
    }
    json(response, {}, 404);
    return true;
  }
  async function handle(request, response, pathname) {
    // Controls are not owned business handlers; lifetime observes only real work.
    if (pathname.startsWith('/__'))
      return dispatch(request, response, pathname);
    if (!/^\/(?:api|developer-api)\//.test(pathname)) return false;
    if (handlers.size >= 16) {
      json(response, {}, 429);
      return true;
    }
    let resolveClose;
    const responseClosed = new Promise((r) => {
      resolveClose = r;
    });
    responses.set(response, responseClosed);
    response.once('close', () => {
      responses.delete(response);
      resolveClose();
    });
    let resolve;
    const settled = new Promise((r) => {
      resolve = r;
    });
    handlers.add(settled);
    try {
      return await dispatch(request, response, pathname);
    } catch {
      json(response, { error: 'Local fixture failed' }, 500);
      return true;
    } finally {
      handlers.delete(settled);
      resolve();
    }
  }
  handle.receipt = receipt;
  handle.close = () =>
    (closing ??= (async () => {
      closed = true;
      for (const h of [...streams, ...histories]) {
        clearTimeout(h.timer);
        h.response.destroy();
      }
      streams.clear();
      histories.clear();
      for (const response of responses.keys()) response.destroy();
      for (const owner of children) {
        owner.fail(Error('Fixture closed'));
        terminate(owner, 'SIGTERM');
        owner.killTimer ??= setTimeout(() => terminate(owner, 'SIGKILL'), 250);
      }
      await Promise.race([
        Promise.all(
          [...children]
            .map((c) => c.ended)
            .concat([...handlers], [...responses.values()])
        ),
        delay(2000).then(() => {
          if (children.size || handlers.size || responses.size)
            throw Error('Fixture close deadline exceeded');
        }),
      ]);
      if (
        children.size ||
        handlers.size ||
        streams.size ||
        histories.size ||
        responses.size
      )
        throw Error('Fixture retained owned work');
    })());
  return handle;
}
