/** Local installed-SDK HTTP/SSE proof; never assembled into public assets. */
export function createPersistenceFixture() {
  let requests = [],
    sequence = 0,
    held;
  let holdHistory = false,
    failHistory = false,
    pauseHistory = false,
    failCreation = false;
  const threads = new Map(),
    runs = new Map();
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const event = (type, data) =>
    `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  return async function handle(request, response, pathname) {
    if (pathname === '/__reset') {
      held?.response.end();
      held = undefined;
      threads.clear();
      runs.clear();
      requests = [];
      sequence = 0;
      holdHistory = failHistory = pauseHistory = failCreation = false;
      json(response, {});
      return true;
    }
    if (pathname === '/__requests') {
      json(response, requests);
      return true;
    }
    if (pathname === '/__lifetime') {
      json(response, { active: Boolean(held) });
      return true;
    }
    if (pathname === '/__release') {
      const current = held;
      held = undefined;
      if (current && !current.response.destroyed) current.finish();
      json(response, {});
      return true;
    }
    if (pathname === '/__hold-history') {
      holdHistory = true;
      json(response, {});
      return true;
    }
    if (pathname === '/__fail-history') {
      failHistory = true;
      json(response, {});
      return true;
    }
    if (pathname === '/__pause-history') {
      pauseHistory = true;
      json(response, {});
      return true;
    }
    if (pathname === '/__fail-create') {
      failCreation = true;
      json(response, {});
      return true;
    }
    if (pathname === '/__empty-first') {
      const state = threads.values().next().value;
      if (state) state.messages = [];
      json(response, {});
      return true;
    }
    if (pathname === '/__replace-first') {
      const state = threads.values().next().value;
      if (state)
        state.messages = [
          {
            type: 'ai',
            id: 'server-correction',
            content: 'Server correction: Avery likes cocoa.',
          },
        ];
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
    if (pathname.endsWith('/threads')) {
      if (failCreation) {
        failCreation = false;
        json(response, { error: 'PRIVATE creation' }, 500);
        return true;
      }
      threads.set(body.thread_id, { messages: [] });
      json(response, { thread_id: body.thread_id });
      return true;
    }
    const threadId = /\/threads\/([^/]+)/.exec(pathname)?.[1];
    const state = threads.get(threadId);
    if (pathname.endsWith('/history')) {
      if (request.method !== 'POST' || !state) {
        json(response, { error: 'Unknown thread' }, 404);
        return true;
      }
      if (failHistory) {
        failHistory = false;
        json(response, { error: 'PRIVATE history' }, 500);
        return true;
      }
      const paused = pauseHistory;
      pauseHistory = false;
      const finish = () =>
        json(response, [
          {
            values: state,
            next: paused ? ['unknown'] : [],
            checkpoint: {
              thread_id: threadId,
              checkpoint_ns: '',
              checkpoint_id: 'checkpoint-' + sequence,
            },
            metadata: {},
            created_at: '2026-10-01T00:00:00Z',
            parent_checkpoint: null,
            tasks: paused
              ? [
                  {
                    id: 'task',
                    name: 'unknown',
                    interrupts: [{ id: 'pause', value: { kind: 'unknown' } }],
                  },
                ]
              : [],
          },
        ]);
      if (holdHistory) {
        holdHistory = false;
        const current = { response, finish };
        held = current;
        response.on('close', () => {
          if (held === current) held = undefined;
        });
      } else finish();
      return true;
    }
    if (pathname.endsWith('/runs/stream')) {
      if (
        !state ||
        body.assistant_id !== 'persistence' ||
        body.command ||
        !Array.isArray(body.input?.messages)
      ) {
        json(
          response,
          { error: 'Expected confirmed persistence message input' },
          400
        );
        return true;
      }
      const text = body.input.messages.at(-1).content;
      if (text === 'Error') {
        json(response, { error: 'PRIVATE run' }, 500);
        return true;
      }
      const runId =
        '00000000-0000-0000-0000-' + String(++sequence).padStart(12, '0');
      runs.set(runId, { thread_id: threadId, status: 'running' });
      const remembered = state.messages.find((message) =>
        /Remember (\w+) likes (\w+)/.test(message.content)
      );
      const match = remembered?.content.match(/Remember (\w+) likes (\w+)/);
      const answer =
        text === 'Recall'
          ? match
            ? `You are ${match[1]} and prefer ${match[2]}.`
            : 'No facts remembered.'
          : 'Conversation saved.';
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'content-location': `/threads/${threadId}/runs/${runId}`,
      });
      response.write(event('metadata', { run_id: runId }));
      state.messages = [...state.messages, ...body.input.messages];
      response.write(event('values', state));
      response.write(
        event('messages', [
          { type: 'AIMessageChunk', id: 'answer-' + runId, content: answer },
          { langgraph_node: 'generate' },
        ])
      );
      state.messages = [
        ...state.messages,
        { type: 'ai', id: 'answer-' + runId, content: answer },
      ];
      response.write(event('values', state));
      runs.get(runId).status = 'success';
      response.end();
      return true;
    }
    const runId = /\/runs\/([^/]+)$/.exec(pathname)?.[1];
    if (request.method === 'GET' && runId) {
      const run = runs.get(runId);
      json(
        response,
        run ? { run_id: runId, ...run } : { error: 'Unknown physical run' },
        run ? 200 : 404
      );
      return true;
    }
    json(response, {});
    return true;
  };
}
