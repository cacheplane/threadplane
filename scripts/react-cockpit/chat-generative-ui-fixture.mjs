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

export function createChatGenerativeUiFixture({
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
        'cockpit/chat/generative-ui/python',
        'python',
        'scripts/react-cockpit/chat-generative-ui-wire.py',
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          ...process.env,
          UV_CACHE_DIR:
            process.env.UV_CACHE_DIR ?? '/tmp/threadplane-genui-uv-cache',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ),
} = {}) {
  const expected = Object.fromEntries(
    [
      ['sourceSha256', 'src/graph.py'],
      ['lockSha256', 'uv.lock'],
    ].map(([key, path]) => [
      key,
      createHash('sha256')
        .update(
          readFileSync(
            new URL(
              '../../cockpit/chat/generative-ui/python/' + path,
              import.meta.url
            )
          )
        )
        .digest('hex'),
    ])
  );
  const productionSourceSha256 = Object.fromEntries(
    [
      'src/graph.py',
      'src/dashboard_tools.py',
      'src/operations.py',
      'src/dashboard_contract.py',
      'prompts/generative-ui.md',
    ].map((path) => [
      path,
      createHash('sha256')
        .update(
          readFileSync(
            new URL(
              '../../cockpit/chat/generative-ui/python/' + path,
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
  const threads = new Set(),
    runs = new Map(),
    requests = [],
    proofs = [],
    held = new Set();
  const options = {
    stateFault: null,
    streamFault: null,
    runStatus: null,
    holdStream: false,
    holdState: false,
  };
  const json = (res, data, status = 200) => {
    if (!res.destroyed && !res.writableEnded) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    }
  };
  const event = (kind, data) =>
    `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const only = (value, keys) =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => keys.includes(k));
  function operate(value) {
    const result = queue.then(async () => {
      if (closed) throw Error('Closed fixture');
      worker ??= graphWorker(spawnWorker, workerTimeoutMs);
      const result = await worker.send(value);
      if (
        closed ||
        !result.proof?.actualCompiledGraph ||
        result.proof.networkConnectAttempts !== 0 ||
        result.proof.titleMessageCallbacks !== 0 ||
        result.proof.decisionMessageCallbacks !== 0 ||
        result.proof.interpretationMessageCallbacks !== 0 ||
        result.proof.op !== value.op ||
        result.proof.threadId !== (value.threadId ?? null) ||
        Object.entries(expected).some(
          ([key, hash]) => result.proof[key] !== hash
        ) ||
        Object.keys(result.proof.productionSourceSha256 ?? {}).length !==
          Object.keys(productionSourceSha256).length ||
        Object.entries(productionSourceSha256).some(
          ([path, hash]) => result.proof.productionSourceSha256?.[path] !== hash
        )
      )
        throw Error('Invalid graph proof');
      proofs.push(result.proof);
      return result;
    });
    queue = result.catch(() => undefined);
    return result;
  }
  function distort(state, fault) {
    const s = structuredClone(state),
      v = s.values;
    if (!fault || !v) return s;
    if (fault === 'missing-terminal') delete v.completed_turn_id;
    if (fault === 'stale-terminal')
      v.completed_turn_id =
        v.messages.find((m) => m.type === 'human')?.id + '-stale';
    if (fault === 'foreign-terminal') v.completed_answer_id = randomUUID();
    if (fault === 'old-message' && v.messages.length)
      v.messages[0].content = 'Changed prior content';
    if (fault === 'old-data' && v.dashboard?.on_time)
      v.dashboard.on_time.value = '999%';
    if (fault === 'incomplete-tools')
      v.messages = v.messages.filter((m) => m.name !== 'render_spec');
    if (fault === 'malformed-layout') {
      const m = v.messages.find((m) =>
        m.tool_calls?.some((c) => c.name === 'render_spec')
      );
      if (m) m.content = '{"elements":{},"root":"missing"}';
    }
    if (fault === 'missing-dashboard') delete v.dashboard;
    if (fault === 'disagreeing-dashboard' && v.dashboard?.recent_disruptions)
      v.dashboard.recent_disruptions = [];
    if (fault === 'pending-tasks')
      s.tasks = [{ id: 'pending', name: 'respond', interrupts: [] }];
    if (fault === 'task-error')
      s.tasks = [
        {
          id: 'failed',
          name: 'respond',
          error: 'Local failure',
          interrupts: [],
        },
      ];
    return s;
  }
  function hold(response, finish, run) {
    const entry = { response, finish, run };
    held.add(entry);
    response.once('close', () => {
      if (held.delete(entry) && run) run.status = 'interrupted';
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
      let input = '';
      for await (const chunk of request) {
        input += chunk;
        if (input.length > 1024 * 1024) throw Error('Oversized request');
      }
      const body = input ? JSON.parse(input) : {};
      if (!only(body, Object.keys(body ?? {}))) {
        json(response, {}, 400);
        return true;
      }
      if (pathname === '/__requests') {
        json(response, structuredClone(requests));
        return true;
      }
      if (pathname === '/__graph-proof') {
        json(response, proofs);
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
        Object.assign(options, body);
        if (
          [
            'failTitle',
            'failAgent',
            'failInterpretation',
            'failMetadata',
            'failWrite',
            'mapped',
            'decisionFault',
            'partialDashboard',
            'failKpis',
            'malformedTrend',
          ].some((key) => key in body)
        )
          await operate({
            op: 'configure',
            failTitle: options.failTitle ?? false,
            failAgent: options.failAgent ?? false,
            failInterpretation: options.failInterpretation ?? false,
            failMetadata: options.failMetadata ?? false,
            failWrite: options.failWrite ?? false,
            mapped: options.mapped ?? false,
            decisionFault: options.decisionFault ?? null,
            partialDashboard: options.partialDashboard ?? false,
            failKpis: options.failKpis ?? false,
            malformedTrend: options.malformedTrend ?? false,
          });
        json(response, {});
        return true;
      }
      if (pathname === '/__release') {
        for (const entry of held) {
          held.delete(entry);
          entry.finish();
        }
        json(response, {});
        return true;
      }
      if (pathname.startsWith('/__')) {
        json(response, {}, 404);
        return true;
      }
      requests.push(
        structuredClone({ path: pathname, method: request.method, body })
      );
      if (pathname === '/api/threads' && request.method === 'POST') {
        if (
          !uuid.test(body.thread_id ?? '') ||
          threads.has(body.thread_id) ||
          Object.keys(body).some(
            (k) => !['thread_id', 'if_exists', 'metadata'].includes(k)
          ) ||
          (body.if_exists !== undefined && body.if_exists !== 'raise') ||
          (body.metadata !== undefined && !only(body.metadata, []))
        ) {
          json(response, {}, 400);
          return true;
        }
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
        if (
          suffix === '/state/checkpoint' &&
          (!only(body, ['checkpoint']) ||
            !only(body.checkpoint, [
              'thread_id',
              'checkpoint_id',
              'checkpoint_ns',
              'checkpoint_map',
            ]) ||
            typeof body.checkpoint.checkpoint_id !== 'string' ||
            !body.checkpoint.checkpoint_id ||
            typeof body.checkpoint.checkpoint_ns !== 'string' ||
            body.checkpoint.thread_id !== threadId ||
            (body.checkpoint.checkpoint_map !== undefined &&
              (!only(body.checkpoint.checkpoint_map, [
                body.checkpoint.checkpoint_ns,
              ]) ||
                Object.values(body.checkpoint.checkpoint_map).some(
                  (id) => id !== body.checkpoint.checkpoint_id
                ))))
        ) {
          json(response, {}, 400);
          return true;
        }
        if (body.checkpoint) {
          const { history } = await operate({ op: 'history', threadId });
          if (
            body.checkpoint.thread_id !== threadId ||
            !history.some(
              (s) =>
                s.checkpoint.checkpoint_id === body.checkpoint.checkpoint_id &&
                s.checkpoint.checkpoint_ns === body.checkpoint.checkpoint_ns
            )
          ) {
            json(response, {}, 400);
            return true;
          }
        }
        const { state } = await operate({
          op: 'state',
          threadId,
          checkpoint: body.checkpoint,
        });
        const delivered = distort(state, options.stateFault);
        const finish = () => json(response, delivered);
        if (options.holdState) hold(response, finish);
        else finish();
        return true;
      }
      if (suffix === '/history' && request.method === 'POST') {
        const { history } = await operate({ op: 'history', threadId });
        json(
          response,
          history
            .slice(0, body.limit ?? 10)
            .map((s) => distort(s, options.stateFault))
        );
        return true;
      }
      if (/^\/runs\/[^/]+$/.test(suffix) && request.method === 'GET') {
        const run = runs.get(suffix.split('/').at(-1));
        json(
          response,
          run?.thread_id === threadId
            ? { ...run, status: options.runStatus ?? run.status }
            : {},
          run?.thread_id === threadId ? 200 : 404
        );
        return true;
      }
      if (suffix === '/runs/stream' && request.method === 'POST') {
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
          body.assistant_id !== 'c-generative-ui' ||
          body.input?.messages?.length !== 1 ||
          message.type !== 'human' ||
          typeof message.content !== 'string' ||
          typeof message.id !== 'string' ||
          !message.id.trim() ||
          !Array.isArray(body.stream_mode) ||
          !body.stream_mode.length ||
          new Set(body.stream_mode).size !== body.stream_mode.length ||
          body.stream_mode.some(
            (m) =>
              ![
                'messages-tuple',
                'values',
                'updates',
                'custom',
                'checkpoints',
              ].includes(m)
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
          op: 'submit',
          threadId,
          messages: body.input.messages,
        });
        if (response.destroyed) {
          run.status = 'interrupted';
          return true;
        }
        const modes = new Set(
          body.stream_mode.map((m) => (m === 'messages-tuple' ? 'messages' : m))
        );
        const events = wire.events
          .filter(([kind]) => modes.has(kind) || kind === 'error')
          .map(([kind, data]) => [
            kind,
            kind === 'values'
              ? distort({ values: data }, options.streamFault).values
              : data,
          ]);
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'content-location': `/threads/${threadId}/runs/${run.run_id}`,
        });
        response.write(event('metadata', { run_id: run.run_id }));
        const finish = () => {
          if (response.destroyed || closed) return;
          for (const [kind, data] of events) response.write(event(kind, data));
          run.status = wire.graphFailure ? 'error' : 'success';
          response.end();
        };
        if (options.holdStream) hold(response, finish, run);
        else finish();
        return true;
      }
      json(response, {}, 404);
      return true;
    } catch {
      json(response, { error: 'Graph fixture failed.' }, 500);
      return true;
    }
  };
  handle.close = () =>
    (closing ??= (async () => {
      closed = true;
      for (const entry of held) entry.response.end();
      held.clear();
      await worker?.close();
    })());
  return handle;
}
