/** Local installed-SDK proof only; never assembled into public assets. */
export function createDurableFixture() {
  let requests = [],
    sequence = 0,
    held,
    lastThread;
  let holdStart = false,
    holdPlan = false,
    holdHistory = false,
    failHistory = false,
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
  function final(entry, marker = entry.human.id, unrelated = false) {
    entry.values = {
      messages: [
        unrelated ? { ...entry.human, id: 'unrelated-human' } : entry.human,
        { type: 'ai', id: 'answer-' + entry.runId, content: 'Final answer' },
      ],
      step: 'generate',
      ...(marker === undefined
        ? {}
        : {
            completed_turn_id: marker,
            completed_answer_id: 'answer-' + entry.runId,
          }),
    };
    entry.next = [];
  }
  return async function handle(request, response, pathname) {
    if (pathname === '/__reset') {
      held?.response.end();
      held = undefined;
      lastThread = undefined;
      threads.clear();
      runs.clear();
      requests = [];
      sequence = 0;
      holdStart = holdPlan = holdHistory = failHistory = failCreation = false;
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
      '/__hold-plan': () => {
        holdPlan = true;
      },
      '/__hold-history': () => {
        holdHistory = true;
      },
      '/__fail-history': () => {
        failHistory = true;
      },
      '/__fail-create': () => {
        failCreation = true;
      },
      '/__publish-final': () => {
        final(threads.get(lastThread));
      },
      '/__publish-wrong-marker': () => {
        final(threads.get(lastThread), 'wrong-human');
      },
      '/__publish-unrelated': () => {
        final(threads.get(lastThread), 'unrelated-human', true);
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
      threads.set(body.thread_id, { values: { messages: [] }, next: [] });
      json(response, { thread_id: body.thread_id });
      return true;
    }
    const threadId = /\/threads\/([^/]+)/.exec(pathname)?.[1],
      entry = threads.get(threadId);
    if (pathname.endsWith('/history')) {
      if (request.method !== 'POST' || !entry) {
        json(response, { error: 'Unknown thread' }, 404);
        return true;
      }
      if (failHistory) {
        failHistory = false;
        json(response, { error: 'PRIVATE history' }, 500);
        return true;
      }
      const finish = () =>
        json(response, [
          {
            values: entry.values,
            next: entry.next,
            checkpoint: {
              thread_id: threadId,
              checkpoint_ns: '',
              checkpoint_id: 'checkpoint-' + sequence,
            },
            metadata: {},
            created_at: '2026-10-01T00:00:00Z',
            parent_checkpoint: null,
            tasks: [],
          },
        ]);
      if (holdHistory) {
        holdHistory = false;
        hold(response, finish);
      } else finish();
      return true;
    }
    if (pathname.endsWith('/runs/stream')) {
      if (
        !entry ||
        body.assistant_id !== 'durable-execution' ||
        body.command ||
        !Array.isArray(body.input?.messages)
      ) {
        json(
          response,
          { error: 'Expected a confirmed durable message request' },
          400
        );
        return true;
      }
      const human = body.input.messages.at(-1),
        text = human.content;
      const runId =
        '00000000-0000-0000-0000-' + String(++sequence).padStart(12, '0');
      runs.set(runId, { thread_id: threadId, status: 'running' });
      lastThread = threadId;
      entry.human = human;
      entry.runId = runId;
      entry.values = { ...entry.values, messages: [...body.input.messages] };
      entry.next = ['analyze'];
      const uncertain = text === 'Uncertain',
        knownUncertain = text === 'Known uncertain';
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        ...(uncertain
          ? {}
          : { 'content-location': `/threads/${threadId}/runs/${runId}` }),
      });
      if (!uncertain) response.write(event('metadata', { run_id: runId }));
      response.write(event('values', entry.values));
      const chunk = (node, content) =>
        response.write(
          event('messages', [
            { type: 'AIMessageChunk', id: node + '-' + runId, content },
            { langgraph_node: node },
          ])
        );
      if (uncertain || knownUncertain) {
        chunk('analyze', 'Partial analysis');
        entry.values = {
          ...entry.values,
          messages: [
            human,
            { type: 'ai', id: 'analyze-' + runId, content: 'Analysis draft' },
          ],
          step: 'analyze',
        };
        entry.next = ['plan'];
        response.end();
        return true;
      }
      const finish = () => {
        chunk('plan', 'Plan draft');
        entry.values = {
          ...entry.values,
          messages: [
            ...entry.values.messages,
            { type: 'ai', id: 'plan-' + runId, content: 'Plan draft' },
          ],
          step: 'plan',
        };
        entry.next = ['generate'];
        response.write(event('values', entry.values));
        chunk('generate', 'Final answer');
        final(entry);
        if (text === 'Missing marker') delete entry.values.completed_turn_id;
        if (text === 'Stale marker')
          entry.values.completed_turn_id = 'previous-human';
        if (text === 'Wrong marker')
          entry.values.completed_turn_id = 'wrong-human';
        if (text === 'Missing answer marker')
          delete entry.values.completed_answer_id;
        if (text === 'Stale answer marker')
          entry.values.completed_answer_id = 'previous-answer';
        if (text === 'Human answer marker')
          entry.values.completed_answer_id = human.id;
        if (text === 'Unknown tool')
          entry.values.messages[1].tool_calls = [
            { id: 'unknown-call', name: 'unknown', args: {} },
          ];
        response.write(event('values', entry.values));
        runs.get(runId).status = 'success';
        response.end();
      };
      const analyze = () => {
        if (text === 'Final only') {
          chunk('generate', 'Final answer');
          final(entry);
          response.write(event('values', entry.values));
          runs.get(runId).status = 'success';
          response.end();
          return;
        }
        chunk('analyze', 'Analysis draft');
        entry.values = {
          ...entry.values,
          messages: [
            ...entry.values.messages,
            { type: 'ai', id: 'analyze-' + runId, content: 'Analysis draft' },
          ],
          step: 'analyze',
        };
        entry.next = ['plan'];
        response.write(event('values', entry.values));
        if (holdPlan) {
          holdPlan = false;
          hold(response, finish);
        } else finish();
      };
      if (holdStart) {
        holdStart = false;
        hold(response, analyze);
      } else analyze();
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
