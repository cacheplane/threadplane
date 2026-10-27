/** Local installed AG-UI client HTTP/SSE proof; never assembled into public assets. */
export function createAgUiStreamingFixture() {
  let requests = [],
    sequence = 0,
    held;
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const event = (response, value) =>
    response.write(`data: ${JSON.stringify(value)}\n\n`);
  return async function handle(request, response, pathname) {
    if (pathname === '/__reset') {
      held?.response.end();
      held = undefined;
      requests = [];
      sequence = 0;
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
    if (!['/ag-ui/streaming/agent', '/developer-agent'].includes(pathname))
      return false;
    let input = '';
    for await (const chunk of request) input += chunk;
    const body = input ? JSON.parse(input) : {};
    requests.push({ path: pathname, method: request.method, body });
    const human = body.messages?.at(-1);
    if (
      request.method !== 'POST' ||
      body.protocolVersion !== '1.0' ||
      typeof body.threadId !== 'string' ||
      typeof body.runId !== 'string' ||
      human?.role !== 'user' ||
      typeof human.content !== 'string'
    ) {
      json(response, { error: 'Invalid native request' }, 400);
      return true;
    }
    const answer = {
      id: `answer-${++sequence}`,
      role: 'assistant',
      content: 'Reply to ' + human.content,
    };
    const mode = human.content;
    if (mode === 'HTTP error') {
      json(response, { error: 'PRIVATE upstream failure' }, 500);
      return true;
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });
    event(response, {
      type: 'RUN_STARTED',
      threadId: body.threadId,
      runId: body.runId,
    });
    if (mode === 'Run error') {
      event(response, {
        type: 'RUN_ERROR',
        message: 'PRIVATE model failure',
        code: 'TEST',
      });
      response.end();
      return true;
    }
    if (mode === 'Child')
      event(response, {
        type: 'SUBAGENT_STARTED',
        subagentRunId: 'child',
        name: 'worker',
      });
    event(response, {
      type: 'TEXT_MESSAGE_START',
      messageId: answer.id,
      role: 'assistant',
    });
    event(response, {
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: answer.id,
      delta: human.content === 'Hold' ? 'Live partial' : answer.content,
    });
    const finish = () => {
      event(response, { type: 'TEXT_MESSAGE_END', messageId: answer.id });
      if (mode === 'Notice EOF') {
        event(response, {
          type: 'CUSTOM',
          name: 'on_interrupt',
          value: { note: 'notice' },
        });
        response.end();
        return;
      }
      let messages = [...body.messages, answer];
      if (mode === 'Duplicate identity')
        messages = [...body.messages, { ...answer, id: human.id }];
      if (mode === 'Truncated prefix') messages = [human, answer];
      if (mode === 'Old pair') messages = body.messages.slice(0, -1);
      if (mode === 'Tool')
        messages = [
          ...body.messages,
          {
            ...answer,
            toolCalls: [
              {
                id: 'call',
                type: 'function',
                function: { name: 'weather', arguments: '{}' },
              },
            ],
          },
        ];
      event(response, { type: 'MESSAGES_SNAPSHOT', messages });
      const outcome =
        mode === 'Pending tools'
          ? { type: 'success', pendingToolCallIds: ['call'] }
          : mode === 'Interrupt'
          ? {
              type: 'interrupt',
              interrupts: [{ id: 'pause', reason: 'approval' }],
            }
          : mode === 'Cancelled'
          ? { type: 'cancelled' }
          : undefined;
      event(response, {
        type: 'RUN_FINISHED',
        threadId: body.threadId,
        runId: mode === 'Wrong terminal' ? 'different-run' : body.runId,
        ...(outcome ? { outcome } : {}),
      });
      response.end();
    };
    if (human.content === 'Hold') {
      const current = { response, finish };
      held = current;
      response.once('close', () => {
        if (held === current) held = undefined;
      });
    } else finish();
    return true;
  };
}
