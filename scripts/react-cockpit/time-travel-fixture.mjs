/** Local installed-SDK verification only; never assembled into public assets. */
export function createTimeTravelFixture() {
  let requests = [],
    sequence = 0,
    lastThread,
    held;
  const threads = new Map(),
    runs = new Map();
  let holdState = false,
    holdStream = false,
    holdHistory = false;
  let failHistory = false,
    failCreation = false,
    unsafeSource = false,
    badHistory = false,
    mappedCheckpoints = false;
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const event = (type, data) =>
    `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  function hold(response, finish) {
    const selected = { response, finish };
    held = selected;
    response.on('close', () => {
      if (held === selected) held = undefined;
    });
  }
  const position = (thread, id) => ({
    thread_id: thread,
    checkpoint_ns: '',
    checkpoint_id: id,
    ...(mappedCheckpoints
      ? { checkpoint_map: { '': id, child: 'literal-map-value' } }
      : {}),
  });
  function matchesReference(candidate, expected) {
    if (
      !candidate ||
      candidate.thread_id !== expected.thread_id ||
      candidate.checkpoint_ns !== expected.checkpoint_ns ||
      candidate.checkpoint_id !== expected.checkpoint_id
    )
      return false;
    const actual = candidate.checkpoint_map ?? {},
      wanted = expected.checkpoint_map ?? {};
    if (
      candidate.checkpoint_map === null ||
      typeof actual !== 'object' ||
      Array.isArray(actual)
    )
      return false;
    const keys = Object.keys(actual).sort(),
      expectedKeys = Object.keys(wanted).sort();
    return (
      JSON.stringify(keys) === JSON.stringify(expectedKeys) &&
      keys.every(
        (key) => typeof actual[key] === 'string' && actual[key] === wanted[key]
      )
    );
  }
  const saved = (thread, id, values, parent, runId, next = [], tasks = []) => ({
    checkpoint: position(thread, id),
    values,
    parent_checkpoint: parent,
    next,
    tasks,
    metadata: { run_id: runId },
    created_at: '2026-10-02T00:00:00Z',
  });
  function checkpointEvent(state) {
    return event('checkpoints', {
      config: {
        configurable: { ...state.checkpoint, run_id: state.metadata.run_id },
      },
      values: state.values,
      next: state.next,
      tasks: state.tasks.map(({ id, name }) => ({ id, name })),
    });
  }
  return async function handle(request, response, pathname) {
    if (pathname === '/__reset') {
      held?.response.end();
      held = undefined;
      requests = [];
      sequence = 0;
      lastThread = undefined;
      threads.clear();
      runs.clear();
      holdState =
        holdStream =
        holdHistory =
        failHistory =
        failCreation =
        unsafeSource =
        badHistory =
        mappedCheckpoints =
          false;
      json(response, {});
      return true;
    }
    if (pathname === '/__requests') {
      json(response, requests);
      return true;
    }
    if (pathname === '/__lifetime') {
      json(response, { active: !!held });
      return true;
    }
    if (pathname === '/__states') {
      json(response, [...(threads.get(lastThread)?.states.values() ?? [])]);
      return true;
    }
    if (pathname === '/__release') {
      const selected = held;
      held = undefined;
      if (selected && !selected.response.destroyed) selected.finish();
      json(response, {});
      return true;
    }
    const controls = {
      '/__hold-state': () => {
        holdState = true;
      },
      '/__hold-stream': () => {
        holdStream = true;
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
      '/__unsafe-source': () => {
        unsafeSource = true;
      },
      '/__bad-history': () => {
        badHistory = true;
      },
      '/__mapped-checkpoints': () => {
        mappedCheckpoints = true;
      },
      '/__advance-tip': () => {
        const thread = threads.get(lastThread);
        if (!thread) throw new Error('No fixture conversation');
        const state = saved(
          lastThread,
          'competing-tip',
          {
            messages: [
              {
                type: 'human',
                id: 'competing-human',
                content: 'Competing tip',
              },
              {
                type: 'ai',
                id: 'competing-answer',
                content: 'Competing tip answer',
              },
            ],
          },
          thread.tip,
          'competing-run'
        );
        thread.states.set('competing-tip', state);
        thread.tip = state.checkpoint;
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
      threads.set(body.thread_id, { states: new Map(), tip: null });
      lastThread = body.thread_id;
      json(response, { thread_id: body.thread_id });
      return true;
    }
    const threadId = /\/threads\/([^/]+)/.exec(pathname)?.[1],
      thread = threads.get(threadId);
    if (!thread) {
      json(response, { error: 'Unknown thread' }, 404);
      return true;
    }
    if (pathname.endsWith('/history')) {
      if (failHistory) {
        failHistory = false;
        json(response, { error: 'PRIVATE read' }, 500);
        return true;
      }
      const finish = () => {
        const page = [...thread.states.values()].reverse();
        json(
          response,
          badHistory
            ? [
                ...page,
                { ...page[0] },
                {
                  ...page[0],
                  checkpoint: {
                    ...page[0].checkpoint,
                    checkpoint_id: 'child-root',
                    checkpoint_ns: 'child:literal',
                  },
                },
                {
                  ...page[0],
                  checkpoint: {
                    ...page[0].checkpoint,
                    checkpoint_id: 'invalid-map',
                    checkpoint_map: null,
                  },
                },
              ]
            : page
        );
      };
      if (holdHistory) {
        holdHistory = false;
        hold(response, finish);
      } else finish();
      return true;
    }
    if (pathname.endsWith('/state/checkpoint')) {
      const finish = () => {
        const state = thread.states.get(body.checkpoint?.checkpoint_id);
        if (!state || !matchesReference(body.checkpoint, state.checkpoint)) {
          json(response, { error: 'Unknown exact checkpoint' }, 404);
          return;
        }
        json(
          response,
          unsafeSource
            ? {
                ...state,
                tasks: [
                  { id: 'pending-task', name: 'generate', interrupts: [] },
                ],
              }
            : state
        );
      };
      if (holdState) {
        holdState = false;
        hold(response, finish);
      } else finish();
      return true;
    }
    if (pathname.endsWith('/runs/stream')) {
      if (
        body.assistant_id !== 'time-travel' ||
        body.command ||
        !Array.isArray(body.input?.messages)
      ) {
        json(response, { error: 'Expected a Time Travel message' }, 400);
        return true;
      }
      const selected = body.checkpoint ?? thread.tip;
      const source = selected
        ? thread.states.get(selected.checkpoint_id)
        : undefined;
      if (
        selected &&
        (!source || !matchesReference(selected, source.checkpoint))
      ) {
        json(response, { error: 'Unknown source' }, 400);
        return true;
      }
      const human = body.input.messages.at(-1),
        text = human.content;
      const number = ++sequence,
        runId = '00000000-0000-0000-0000-' + String(number).padStart(12, '0');
      runs.set(runId, { thread_id: threadId, status: 'running' });
      lastThread = threadId;
      const messages = [...(source?.values.messages ?? []), human];
      const initial = saved(
        threadId,
        'checkpoint-input-' + number,
        { ...source?.values, messages },
        source?.checkpoint ?? null,
        runId,
        ['generate'],
        [
          {
            id: 'task-' + number,
            name: 'generate',
            interrupts: [],
            result: null,
            error: null,
          },
        ]
      );
      thread.states.set(initial.checkpoint.checkpoint_id, initial);
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'content-location': `/threads/${threadId}/runs/${runId}`,
      });
      response.write(event('metadata', { run_id: runId, thread_id: threadId }));
      response.write(event('values', initial.values));
      response.write(
        event('messages', [
          {
            type: 'AIMessageChunk',
            id: 'chunk-' + runId,
            content: 'Transient chunk',
          },
          { langgraph_node: 'generate' },
        ])
      );
      const finish = () => {
        const answer = {
          type: 'ai',
          id: 'answer-' + runId,
          content:
            text === 'Literal'
              ? '<script>literal answer</script>'
              : 'Answer to ' + text,
        };
        const canonical = [...messages, answer];
        const values = {
          messages: canonical,
          completed_turn_id: human.id,
          completed_answer_id: answer.id,
          completed_message_ids: canonical.map((message) => message.id),
        };
        if (text === 'Truncated history')
          values.completed_message_ids = [human.id, answer.id];
        if (text === 'Missing marker') delete values.completed_turn_id;
        if (text === 'Stale marker')
          values.completed_turn_id =
            source?.values.messages[0]?.id ?? 'old-human';
        if (text === 'Equal marker') values.completed_answer_id = human.id;
        if (text === 'Unknown tool')
          answer.tool_calls = [
            { id: 'unknown-tool', name: 'unknown', args: {} },
          ];
        const final = saved(
          threadId,
          'checkpoint-' + number,
          values,
          initial.checkpoint,
          runId
        );
        thread.states.set(final.checkpoint.checkpoint_id, final);
        thread.tip = final.checkpoint;
        response.write(event('values', values));
        response.write(checkpointEvent(final));
        runs.get(runId).status = 'success';
        response.end();
      };
      if (holdStream) {
        holdStream = false;
        hold(response, finish);
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
    json(response, { error: 'Unsupported fixture endpoint' }, 404);
    return true;
  };
}
