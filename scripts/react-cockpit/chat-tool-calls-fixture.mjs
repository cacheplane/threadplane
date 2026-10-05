/** Local installed-SDK fixture. Real graph checkpoints never become public assets. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function graphWorker(spawnWorker) {
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
        }, 30000);
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

export function createChatToolCallsFixture({
  spawnWorker = () =>
    spawn(
      'uv',
      [
        'run',
        '--frozen',
        '--python',
        '3.12',
        '--project',
        'cockpit/chat/tool-calls/python',
        'python',
        'scripts/react-cockpit/chat-tool-calls-wire.py',
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
    heldRun,
    heldHistory;
  let holdStream = false,
    holdTool = false,
    failCreate = false,
    historyMode = 'safe';
  const threads = new Set(),
    runs = new Map(),
    operations = new Set();
  const json = (response, value, status = 200) => {
    if (response.destroyed) return;
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
      worker ??= graphWorker(spawnWorker);
      const result = await worker.send(value);
      if (closed || epoch !== captured) throw new Error('Stale graph response');
      return result;
    });
    queue = result.catch(() => undefined);
    return result.finally(() => operations.delete(ticket));
  }
  function endHeld() {
    heldRun?.response.end();
    heldHistory?.response.end();
    heldRun = heldHistory = undefined;
  }
  async function reset() {
    ++epoch;
    endHeld();
    const previous = worker;
    worker = undefined;
    queue = Promise.resolve();
    operations.clear();
    requests = [];
    proofs = [];
    threads.clear();
    runs.clear();
    holdStream = holdTool = failCreate = false;
    historyMode = 'safe';
    await previous?.close();
  }
  const handle = async (request, response, pathname) => {
    if (pathname === '/__lifetime') {
      json(response, {
        workers: worker ? 1 : 0,
        workerPid: worker?.pid,
        pendingOperations: operations.size,
        activeStream: Boolean(heldRun),
        activeHistory: Boolean(heldHistory),
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
      if (pathname === '/__hold-stream') {
        holdStream = true;
        json(response, {});
        return true;
      }
      if (pathname === '/__fail-create') {
        failCreate = true;
        json(response, {});
        return true;
      }
      if (pathname === '/__metadata-failure') {
        await operate({ op: 'configure', failMetadata: true });
        json(response, {});
        return true;
      }
      if (pathname === '/__hold-tool') {
        holdTool = true;
        json(response, {});
        return true;
      }
      if (pathname === '/__worker-failure') {
        await operate({ op: 'configure' });
        await worker.close();
        json(response, {});
        return true;
      }
      if (pathname === '/__release') {
        const held = heldRun;
        heldRun = undefined;
        held?.finish();
        json(response, {});
        return true;
      }
      if (pathname === '/__release-history') {
        const held = heldHistory;
        heldHistory = undefined;
        held?.finish();
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
            'failed',
            'args',
            'result',
            'name',
            'ids',
            'interrupt',
            'subgraph',
          ].includes(mode)
        ) {
          json(response, {}, 400);
          return true;
        }
        historyMode = mode;
        json(response, {});
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
      if (pathname.endsWith('/threads') && request.method === 'POST') {
        if (failCreate) {
          failCreate = false;
          throw new Error('Creation failed');
        }
        if (typeof body.thread_id !== 'string' || threads.has(body.thread_id)) {
          json(response, {}, 400);
          return true;
        }
        threads.add(body.thread_id);
        json(response, { thread_id: body.thread_id });
        return true;
      }
      const threadId = /\/threads\/([^/]+)/.exec(pathname)?.[1];
      if (!threads.has(threadId)) {
        json(response, {}, 404);
        return true;
      }
      if (pathname.endsWith('/history') && request.method === 'POST') {
        if (historyMode === 'failed') throw new Error('History failed');
        const wire = await operate({ op: 'history', threadId }),
          history = wire.history;
        const latest = history[0];
        if (latest && historyMode === 'changed')
          latest.values.messages.at(-1).content = 'Changed canonical content';
        if (latest && historyMode === 'missing') latest.values.messages.pop();
        if (latest && historyMode === 'pending') latest.next = ['unexpected'];
        const assistant = latest?.values.messages.find(
          (message) => message.tool_calls?.length
        );
        const result = latest?.values.messages.find(
          (message) => message.type === 'tool'
        );
        if (assistant && historyMode === 'args')
          assistant.tool_calls[0].args = { flight_number: 'Changed' };
        if (result && historyMode === 'result')
          result.content = 'Changed tool observation';
        if (result && historyMode === 'name') result.name = 'unsupported';
        if (result && historyMode === 'ids') result.tool_call_id = 'orphan';
        if (latest && historyMode === 'interrupt')
          latest.tasks = [
            {
              id: 'unexpected',
              name: 'tools',
              interrupts: [{ id: 'unexpected', value: { type: 'unexpected' } }],
            },
          ];
        if (latest && historyMode === 'subgraph')
          latest.checkpoint.checkpoint_ns = 'foreign:checkpoint';
        const finish = () => {
          if (captured === epoch && !closed) json(response, history);
        };
        if (historyMode === 'hold') {
          const held = { response, finish };
          heldHistory = held;
          response.on('close', () => {
            if (heldHistory === held) heldHistory = undefined;
          });
        } else finish();
        return true;
      }
      if (pathname.endsWith('/runs/stream') && request.method === 'POST') {
        if (
          body.assistant_id !== 'c-tool-calls' ||
          body.command !== undefined ||
          body.input?.messages?.length !== 1 ||
          body.input.messages[0].type !== 'human'
        ) {
          json(response, {}, 400);
          return true;
        }
        const wire = await operate({
          op: 'submit',
          threadId,
          messages: body.input.messages,
        });
        proofs.push(wire.proof);
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
          run.status = wire.state.next.length ? 'interrupted' : 'success';
          response.end();
        };
        if (holdStream || holdTool) {
          const limit = holdTool
            ? Math.max(
                0,
                wire.events.findIndex(
                  ([kind, value]) =>
                    kind === 'messages' && value[0]?.type === 'tool'
                )
              )
            : Math.min(2, wire.events.length);
          holdStream = false;
          holdTool = false;
          while (sent < limit) response.write(event(...wire.events[sent++]));
          const held = { response, finish, run };
          heldRun = held;
          response.on('close', () => {
            if (heldRun === held) {
              heldRun = undefined;
              run.status = 'interrupted';
            }
          });
        } else finish();
        return true;
      }
      const cancelId = /\/runs\/([^/]+)\/cancel$/.exec(pathname)?.[1];
      if (cancelId && request.method === 'POST') {
        const run = runs.get(cancelId);
        if (run?.thread_id !== threadId) {
          json(response, {}, 404);
          return true;
        }
        run.status = 'interrupted';
        if (heldRun?.run === run) {
          heldRun.response.end();
          heldRun = undefined;
        }
        json(response, {});
        return true;
      }
      if (request.method === 'GET' && /\/runs\/[^/]+$/.test(pathname)) {
        const run = runs.get(pathname.split('/').at(-1));
        json(response, run ?? {}, run?.thread_id === threadId ? 200 : 404);
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
