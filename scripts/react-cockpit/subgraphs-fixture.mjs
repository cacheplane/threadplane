/** Local installed-SDK proof only; never assembled into public assets. */
export function createSubgraphsFixture() {
  let requests = [],
    sequence = 0,
    held;
  let holdStart = false,
    holdChild = false,
    failCreation = false;
  const threads = new Map(),
    runs = new Map();
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const event = (type, data) =>
    `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  function hold(response, finish) {
    const current = { response, finish };
    held = current;
    response.on('close', () => {
      if (held === current) held = undefined;
    });
  }
  return async function handle(request, response, pathname) {
    if (pathname === '/__reset') {
      held?.response.end();
      held = undefined;
      threads.clear();
      runs.clear();
      requests = [];
      sequence = 0;
      holdStart = holdChild = failCreation = false;
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
    const controls = {
      '/__hold-start': () => {
        holdStart = true;
      },
      '/__hold-child': () => {
        holdChild = true;
      },
      '/__fail-create': () => {
        failCreation = true;
      },
    };
    if (Object.hasOwn(controls, pathname)) {
      controls[pathname]();
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
      threads.set(body.thread_id, { values: { messages: [] } });
      json(response, { thread_id: body.thread_id });
      return true;
    }
    const threadId = /\/threads\/([^/]+)/.exec(pathname)?.[1],
      entry = threads.get(threadId);
    if (pathname.endsWith('/runs/stream')) {
      if (
        !entry ||
        body.assistant_id !== 'subgraphs' ||
        body.command ||
        !body.stream_subgraphs ||
        !Array.isArray(body.input?.messages)
      ) {
        json(
          response,
          { error: 'Expected a confirmed subgraphs message request' },
          400
        );
        return true;
      }
      const human = body.input.messages.at(-1),
        text = human.content;
      const runId =
        '00000000-0000-0000-0000-' + String(++sequence).padStart(12, '0');
      runs.set(runId, { thread_id: threadId, status: 'running' });
      // The real parent's add_messages reducer retains canonical prior turns.
      const previous = entry.values.messages.filter(
        (message) => message.id !== human.id
      );
      entry.values = { ...entry.values, messages: [...previous, human] };
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'content-location': `/threads/${threadId}/runs/${runId}`,
      });
      response.write(event('metadata', { run_id: runId }));
      response.write(event('values', entry.values));
      const nested = text !== 'Hello',
        namespace = 'research:' + runId;
      const topic =
        text === 'Literal'
          ? '<script>private topic</script>'
          : 'Fictional checkpoint topic';
      const brief =
        text === 'Literal'
          ? '<img src=x onerror=alert(1)> CHILD-ONLY brief'
          : 'CHILD-ONLY brief';
      const finish = () => {
        if (nested && text !== 'Missing child') {
          response.write(
            event('messages|' + namespace, [
              {
                type: 'AIMessageChunk',
                id: 'research-' + runId,
                content: brief,
              },
              { langgraph_node: 'research' },
            ])
          );
          response.write(
            event('values|' + namespace, {
              research_topic: topic,
              research_brief:
                text === 'Conflicting child' ? 'Conflicting brief' : brief,
            })
          );
          if (text === 'Child pause')
            response.write(
              event('updates|' + namespace, {
                __interrupt__: [{ value: 'PRIVATE pause' }],
              })
            );
          if (text === 'Child error')
            response.write(
              event('error|' + namespace, { message: 'PRIVATE child error' })
            );
          if (text === 'Child tool')
            response.write(
              event('messages|' + namespace, [
                {
                  type: 'tool',
                  id: 'tool-' + runId,
                  content: 'PRIVATE tool result',
                  tool_call_id: 'unknown-tool',
                },
                { langgraph_node: 'research' },
              ])
            );
        }
        entry.values = {
          ...entry.values,
          research_topic: nested ? topic : '',
          research_brief: nested ? brief : '',
        };
        response.write(event('values', entry.values));
        response.write(
          event('messages', [
            {
              type: 'AIMessageChunk',
              id: 'answer-chunk-' + runId,
              content: 'Parent answer',
            },
            { langgraph_node: 'answer' },
          ])
        );
        const answer = {
          type: 'ai',
          id: 'answer-final-' + runId,
          content: 'Parent answer',
        };
        entry.values = {
          ...entry.values,
          messages: [...previous, human, answer],
          completed_turn_id: human.id,
          completed_answer_id: answer.id,
        };
        if (text === 'Missing marker') delete entry.values.completed_turn_id;
        if (text === 'Stale marker')
          entry.values.completed_turn_id = previous[0]?.id ?? 'old-human';
        if (text === 'Missing answer marker')
          delete entry.values.completed_answer_id;
        if (text === 'Equal marker')
          entry.values.completed_answer_id = human.id;
        if (text === 'Root tool')
          answer.tool_calls = [
            { id: 'unknown-tool', name: 'unknown', args: {} },
          ];
        response.write(event('values', entry.values));
        runs.get(runId).status = 'success';
        response.end();
      };
      const route = () => {
        entry.values = {
          ...entry.values,
          research_topic: nested ? topic : '',
          research_brief: '',
        };
        response.write(event('values', entry.values));
        if (nested && text !== 'Missing child')
          response.write(
            event('values|' + namespace, {
              research_topic: topic,
              research_brief: '',
            })
          );
        if (holdChild) {
          holdChild = false;
          hold(response, finish);
        } else finish();
      };
      if (holdStart) {
        holdStart = false;
        hold(response, route);
      } else route();
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
