/** Local real-SDK HTTP/SSE proof. Never included in public deployment. */
export function createMemoryFixture() {
  let requests = [];
  const threads = new Map();
  const runs = new Map();
  let sequence = 0;
  let held;
  let holdExtraction = false;
  let failCreation = false;
  const event = (type, data) =>
    `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  return async function handle(request, response, pathname) {
    if (pathname === '/__reset') {
      held?.response.end();
      held = undefined;
      threads.clear();
      runs.clear();
      requests = [];
      sequence = 0;
      holdExtraction = failCreation = false;
      json(response, {});
      return true;
    }
    if (pathname === '/__release') {
      const current = held;
      held = undefined;
      if (current && !current.response.destroyed) current.finish();
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
    if (pathname === '/__hold-extraction') {
      holdExtraction = true;
      json(response, {});
      return true;
    }
    if (pathname === '/__fail-create') {
      failCreation = true;
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
        json(response, { error: 'PRIVATE creation response' }, 500);
        return true;
      }
      threads.set(body.thread_id, { messages: [], memory: {} });
      json(response, { thread_id: body.thread_id });
      return true;
    }
    const threadId = /\/threads\/([^/]+)/.exec(pathname)?.[1];
    if (pathname.endsWith('/runs/stream')) {
      const state = threads.get(threadId);
      if (
        !state ||
        body.assistant_id !== 'memory' ||
        body.command ||
        !Array.isArray(body.input?.messages)
      ) {
        json(
          response,
          { error: 'Expected confirmed memory message input' },
          400
        );
        return true;
      }
      const text = body.input.messages.at(-1).content;
      if (text === 'Error') {
        json(response, { error: 'PRIVATE run response' }, 500);
        return true;
      }
      const runId =
        '00000000-0000-0000-0000-' + String(++sequence).padStart(12, '0');
      runs.set(runId, { thread_id: threadId, status: 'running' });
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'content-location': `/threads/${threadId}/runs/${runId}`,
      });
      response.write(event('metadata', { run_id: runId }));
      state.messages = [...state.messages, ...body.input.messages];
      response.write(event('values', state));
      const answer =
        text === 'Recall'
          ? state.memory?.user_name
            ? `You are ${state.memory.user_name} and prefer ${state.memory.favorite_drink}.`
            : 'No facts remembered.'
          : 'Memory reply complete.';
      const partial = text === 'Recall' ? answer : 'Memory reply';
      response.write(
        event('messages', [
          { type: 'AIMessageChunk', id: 'answer-' + runId, content: partial },
          { langgraph_node: 'generate' },
        ])
      );
      if (text !== 'Recall')
        response.write(
          event('messages', [
            {
              type: 'AIMessageChunk',
              id: 'answer-' + runId,
              content: ' complete.',
            },
            { langgraph_node: 'generate' },
          ])
        );
      state.messages = [
        ...state.messages,
        { type: 'ai', id: 'answer-' + runId, content: answer },
      ];
      response.write(event('values', state));
      const finish = () => {
        const memory =
          text === 'Correct'
            ? { ...state.memory, favorite_drink: 'coffee' }
            : text === 'Replace'
            ? { favorite_drink: 'coffee' }
            : text === 'Literal'
            ? JSON.parse(
                '{"__proto__":"literal","a.b":"<script>tea</script>","long_key_abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz":"abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz"}'
              )
            : text === 'Malformed'
            ? null
            : text === 'Absent'
            ? undefined
            : text === 'Recall' || text === 'Pause'
            ? state.memory
            : { user_name: 'Mira', favorite_drink: 'tea' };
        state.memory = memory;
        const interrupts =
          text === 'Pause'
            ? [{ id: 'unexpected', value: { kind: 'unknown' } }]
            : [];
        response.write(
          event('values', {
            ...state,
            ...(interrupts.length ? { __interrupt__: interrupts } : {}),
          })
        );
        runs.get(runId).status = interrupts.length ? 'interrupted' : 'success';
        response.end();
      };
      if (holdExtraction) {
        holdExtraction = false;
        const current = { response, finish };
        held = current;
        response.on('close', () => {
          if (held === current) held = undefined;
        });
      } else finish();
      return true;
    }
    if (pathname.endsWith('/cancel')) {
      held?.response.end();
      held = undefined;
      json(response, {});
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
