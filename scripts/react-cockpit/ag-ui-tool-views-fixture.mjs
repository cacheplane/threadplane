/** Local installed-client proof server. Never included in public assets. */
export function createAgUiToolViewsFixture() {
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
    if (!['/ag-ui/tool-views/agent', '/developer-agent'].includes(pathname))
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
    const mode = human.content,
      turn = ++sequence;
    if (mode === 'HTTP error') {
      json(response, { error: 'PRIVATE upstream failure' }, 500);
      return true;
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });
    const emit = (value) => event(response, value);
    emit({ type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId });
    if (mode === 'Run error') {
      emit({ type: 'RUN_ERROR', message: 'PRIVATE provider failure' });
      response.end();
      return true;
    }
    if (mode === 'Child')
      emit({
        type: 'SUBAGENT_STARTED',
        subagentRunId: 'child',
        name: 'worker',
      });
    if (mode === 'Legacy notice')
      emit({
        type: 'CUSTOM',
        name: 'on_interrupt',
        value: { note: 'legacy pause' },
      });
    const additions = [];
    const hold = (finish) => {
      const current = { response, finish };
      held = current;
      response.once('close', () => {
        if (held === current) held = undefined;
      });
    };
    const finish = () => {
      const answer = {
        id: `answer-${turn}`,
        role: 'assistant',
        content:
          mode === 'Literal'
            ? '<script>private markup</script>'
            : `Reply to ${mode}`,
      };
      emit({
        type: 'TEXT_MESSAGE_START',
        messageId: answer.id,
        role: 'assistant',
      });
      emit({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: answer.id,
        delta: answer.content,
      });
      emit({ type: 'TEXT_MESSAGE_END', messageId: answer.id });
      let messages = [...body.messages, ...additions, answer];
      if (mode === 'Truncated prefix') messages = [...additions, answer];
      if (mode === 'Duplicate result')
        messages.splice(messages.length - 1, 0, {
          ...additions[1],
          id: 'duplicate-result',
        });
      if (mode === 'Orphan result')
        messages.splice(messages.length - 1, 0, {
          id: 'orphan',
          role: 'tool',
          toolCallId: 'orphan-call',
          content: '{}',
        });
      if (mode === 'Notice EOF') {
        emit({ type: 'CUSTOM', name: 'unsupported', value: {} });
        response.end();
        return;
      }
      emit({ type: 'MESSAGES_SNAPSHOT', messages });
      if (mode === 'EOF') {
        response.end();
        return;
      }
      const outcome =
        mode === 'Pending tools'
          ? { type: 'success', pendingToolCallIds: ['unobserved'] }
          : mode === 'Decision'
          ? {
              type: 'interrupt',
              interrupts: [{ id: 'pause', reason: 'approval' }],
            }
          : { type: 'success' };
      const terminal = () => {
        emit({
          type: 'RUN_FINISHED',
          threadId: body.threadId,
          runId: mode === 'Wrong terminal' ? 'different-run' : body.runId,
          outcome,
        });
        response.end();
      };
      if (mode === 'Hold final') hold(terminal);
      else terminal();
    };
    const round = (index, count, next) => {
      const owner = {
        id: `owner-${turn}-${index}`,
        role: 'assistant',
        content: '',
        toolCalls: [],
      };
      const readings = [];
      for (let position = 0; position < count; position++) {
        const id = `call-${turn}-${index}-${position}`,
          location =
            mode === 'Literal'
              ? '<img src=x onerror=alert(1)>'
              : position
              ? 'Boston'
              : 'San Francisco';
        const name = mode === 'Unknown tool' ? 'unknown' : 'weather_card';
        const args =
          mode === 'Malformed args' ? '{}' : JSON.stringify({ location });
        owner.toolCalls.push({
          id,
          type: 'function',
          function: { name, arguments: args },
        });
        readings.push({ id, location, args, name });
      }
      emit({
        type: 'TEXT_MESSAGE_START',
        messageId: owner.id,
        role: 'assistant',
      });
      const argumentTail = () => {
        for (const reading of readings) {
          emit({
            type: 'TOOL_CALL_ARGS',
            toolCallId: reading.id,
            delta: reading.args.slice(10),
          });
          emit({ type: 'TOOL_CALL_END', toolCallId: reading.id });
        }
        emit({ type: 'TEXT_MESSAGE_END', messageId: owner.id });
        additions.push(owner);
        const results = () => {
          for (const reading of readings) {
            const content = JSON.stringify({
              location: reading.location,
              temperatureF: mode === 'Malformed weather' ? 'hot' : 68,
              conditions: 'Sunny',
              humidity: 55,
              windMph: 8,
            });
            emit({
              type: 'TOOL_CALL_RESULT',
              messageId: reading.id,
              toolCallId: reading.id,
              content,
              role: 'tool',
            });
            additions.push({
              id:
                mode === 'Unstable result identity'
                  ? `graph-${reading.id}`
                  : reading.id,
              role: 'tool',
              toolCallId: reading.id,
              content,
            });
          }
          if (mode === 'Hold result') hold(next);
          else next();
        };
        if (mode === 'Hold call') hold(results);
        else results();
      };
      for (const reading of readings) {
        emit({
          type: 'TOOL_CALL_START',
          toolCallId: reading.id,
          toolCallName: reading.name,
          parentMessageId: owner.id,
        });
        emit({
          type: 'TOOL_CALL_ARGS',
          toolCallId: reading.id,
          delta: reading.args.slice(0, 10),
        });
      }
      if (mode === 'Hold args') hold(argumentTail);
      else argumentTail();
    };
    if (mode === 'Zero') finish();
    else if (mode === 'Rounds') round(0, 1, () => round(1, 1, finish));
    else round(0, mode === 'Batch' ? 2 : 1, finish);
    return true;
  };
}
