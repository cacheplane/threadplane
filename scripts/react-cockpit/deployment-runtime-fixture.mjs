/** Local installed-SDK HTTP/SSE proof; never assembled into public assets. */
export function createDeploymentRuntimeFixture() {
  let requests = [],
    sequence = 0,
    held,
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
      requests = [];
      sequence = 0;
      failCreation = false;
      threads.clear();
      runs.clear();
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
    if (pathname === '/__fail-create') {
      failCreation = true;
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
      if (
        request.method !== 'POST' ||
        typeof body.thread_id !== 'string' ||
        threads.has(body.thread_id)
      ) {
        json(response, { error: 'Invalid confirmed UUID' }, 400);
        return true;
      }
      threads.set(body.thread_id, { messages: [] });
      json(response, { thread_id: body.thread_id });
      return true;
    }
    const threadId = /\/threads\/([^/]+)/.exec(pathname)?.[1],
      state = threads.get(threadId);
    if (pathname.endsWith('/runs/stream')) {
      if (
        !state ||
        request.method !== 'POST' ||
        body.assistant_id !== 'deployment-runtime' ||
        body.command ||
        !Array.isArray(body.input?.messages) ||
        body.input.messages.length !== 1 ||
        body.input.messages[0].type !== 'human'
      ) {
        json(
          response,
          {
            error:
              'Expected ordinary confirmed deployment-runtime message input',
          },
          400
        );
        return true;
      }
      const human = body.input.messages[0],
        text = human.content;
      if (text === 'Error') {
        json(response, { error: 'PRIVATE run' }, 500);
        return true;
      }
      const runId =
        '00000000-0000-0000-0000-' + String(++sequence).padStart(12, '0');
      const run = { thread_id: threadId, status: 'running' };
      runs.set(runId, run);
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'content-location': `/threads/${threadId}/runs/${runId}`,
      });
      response.write(event('metadata', { run_id: runId }));
      state.messages = [...state.messages, human];
      response.write(event('values', state));
      response.write(
        event('messages', [
          {
            type: 'AIMessageChunk',
            id: 'transient-' + runId,
            content: text === 'Hold' ? 'Live partial' : 'Transient draft',
          },
          { langgraph_node: 'generate' },
        ])
      );
      const finish = () => {
        if (text === 'No final values') {
          run.status = 'success';
          response.end();
          return;
        }
        const answer = {
          type: 'ai',
          id: 'answer-' + runId,
          content: 'Reply to ' + text,
        };
        state.messages = [...state.messages, answer];
        const values = { ...state };
        if (text === 'Truncated prefix') values.messages = [human, answer];
        if (text !== 'Missing markers' && text !== 'Old pair')
          Object.assign(values, {
            completed_turn_id: text === 'Wrong pair' ? 'wrong-human' : human.id,
            completed_answer_id: answer.id,
            completed_message_ids: values.messages.map((message) => message.id),
          });
        if (text === 'Duplicate identity')
          values.completed_message_ids = [
            ...values.completed_message_ids,
            answer.id,
          ];
        if (text === 'Tool')
          values.messages = [
            ...state.messages,
            {
              type: 'tool',
              id: 'unsupported-tool-' + runId,
              tool_call_id: '',
              content: 'Unsupported tool result',
            },
          ];
        if (text === 'Interrupt')
          values.__interrupt__ = [
            { id: 'pause', value: { kind: 'unsupported' } },
          ];
        response.write(event('values', values));
        Object.assign(state, values);
        run.status = text === 'Interrupt' ? 'interrupted' : 'success';
        response.end();
      };
      if (text === 'Hold') {
        const current = { response, finish, run };
        held = current;
        response.on('close', () => {
          if (held === current) {
            held = undefined;
            run.status = 'interrupted';
          }
        });
      } else finish();
      return true;
    }
    const cancelId = /\/runs\/([^/]+)\/cancel$/.exec(pathname)?.[1];
    if (cancelId) {
      if (held?.run === runs.get(cancelId)) {
        held.response.end();
        held.run.status = 'interrupted';
        held = undefined;
      }
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
    json(response, { error: 'Unsupported runtime request' }, 404);
    return true;
  };
}
