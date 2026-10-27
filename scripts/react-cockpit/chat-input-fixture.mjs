/** Local installed-SDK proof; graph output is derived, never public assets. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function graphWire(input) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(
      'uv',
      [
        'run',
        '--frozen',
        '--python',
        '3.12',
        '--project',
        'cockpit/chat/input/python',
        'python',
        'scripts/react-cockpit/chat-input-wire.py',
      ],
      { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.resume();
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error('Authored graph wire failed.'));
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error('Authored graph wire was invalid.'));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
export function createChatInputFixture() {
  let requests = [],
    sequence = 0,
    failCreation = false,
    historyMode = 'safe',
    heldRun,
    heldHistory;
  const threads = new Map(),
    runs = new Map(),
    proofs = [];
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const event = (kind, value) =>
    `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`;
  return async function handle(request, response, pathname) {
    if (pathname === '/__reset') {
      heldRun?.response.end();
      heldHistory?.response.end();
      heldRun = heldHistory = undefined;
      requests = [];
      sequence = 0;
      failCreation = false;
      historyMode = 'safe';
      threads.clear();
      runs.clear();
      proofs.length = 0;
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
    if (pathname === '/__lifetime') {
      json(response, {
        activeStream: Boolean(heldRun),
        activeHistory: Boolean(heldHistory),
      });
      return true;
    }
    if (pathname === '/__fail-create') {
      failCreation = true;
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
        !['safe', 'hold', 'changed', 'missing', 'pending', 'failed'].includes(
          mode
        )
      ) {
        json(response, {}, 400);
        return true;
      }
      historyMode = mode;
      json(response, {});
      return true;
    }
    if (
      !pathname.startsWith('/api/') &&
      !pathname.startsWith('/developer-api/')
    )
      return false;
    let input = '';
    for await (const chunk of request) input += chunk;
    const body = input ? JSON.parse(input) : {};
    requests.push({
      path: pathname,
      method: request.method,
      body,
      key: request.headers['x-api-key'] ?? null,
    });
    if (pathname.endsWith('/threads') && request.method === 'POST') {
      if (failCreation) {
        failCreation = false;
        json(response, { error: 'PRIVATE creation' }, 500);
        return true;
      }
      if (typeof body.thread_id !== 'string' || threads.has(body.thread_id)) {
        json(response, {}, 400);
        return true;
      }
      threads.set(body.thread_id, { messages: [], title: null, next: [] });
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
        if (response.destroyed) return;
        if (historyMode === 'failed') {
          json(response, { error: 'PRIVATE history' }, 500);
          return;
        }
        let messages = state.messages;
        if (historyMode === 'changed')
          messages = messages.map((m, i) =>
            i === messages.length - 1
              ? { ...m, content: 'Changed saved answer' }
              : m
          );
        if (historyMode === 'missing') messages = messages.slice(0, -1);
        json(response, [
          {
            values: { messages },
            next: historyMode === 'pending' ? ['generate'] : state.next,
            checkpoint: {
              thread_id: threadId,
              checkpoint_ns: '',
              checkpoint_id: 'authored-checkpoint-' + sequence,
            },
            parent_checkpoint: null,
            created_at: '2026-10-04T00:00:00Z',
            metadata: {},
            tasks: [],
          },
        ]);
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
        body.assistant_id !== 'c-input' ||
        body.command ||
        body.input?.messages?.length !== 1 ||
        body.input.messages[0].type !== 'human'
      ) {
        json(response, {}, 400);
        return true;
      }
      const human = body.input.messages[0],
        runId =
          '00000000-0000-0000-0000-' + String(++sequence).padStart(12, '0');
      const run = { thread_id: threadId, status: 'running' };
      runs.set(runId, run);
      let wire;
      try {
        wire = await graphWire({
          threadId,
          answerId: 'authored-answer-' + sequence,
          messages: [...state.messages, human],
          title: state.title,
        });
      } catch {
        json(response, { error: 'Graph fixture failed' }, 500);
        return true;
      }
      proofs.push(wire.proof);
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'content-location': `/threads/${threadId}/runs/${runId}`,
      });
      response.write(event('metadata', { run_id: runId }));
      let sent = 0;
      const emitNext = () => response.write(event(...wire.events[sent++]));
      const finish = () => {
        if (response.destroyed) return;
        while (sent < wire.events.length) emitNext();
        state.messages = wire.messages;
        state.next = wire.next;
        state.title = wire.title;
        run.status = 'success';
        response.end();
      };
      if (human.content === 'Hold' || human.content === 'Hold fence') {
        let content = '';
        while (sent < wire.events.length) {
          const [kind, value] = wire.events[sent];
          emitNext();
          if (kind === 'messages') {
            content += value[0].content;
            if (human.content === 'Hold' || content.includes('const answer ='))
              break;
          }
        }
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
      if (heldRun?.run === runs.get(cancelId)) {
        heldRun.run.status = 'interrupted';
        heldRun.response.end();
        heldRun = undefined;
      }
      json(response, {});
      return true;
    }
    const runId = /\/runs\/([^/]+)$/.exec(pathname)?.[1],
      run = runs.get(runId);
    if (runId && request.method === 'GET' && run?.thread_id === threadId) {
      json(response, { run_id: runId, ...run });
      return true;
    }
    json(response, { error: 'Unsupported authored endpoint' }, 404);
    return true;
  };
}
