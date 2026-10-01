/** Local real-SDK HTTP/SSE proof. No fixture routes or keys are deployed. */
export function createInterruptsFixture() {
  let requests = [];
  const runs = new Map();
  const threads = new Map();
  let sequence = 0;
  let held;
  let holdResume = false;
  let holdDraft = false;
  let failResume = false;
  let failCreation = false;
  const event = (type, data) =>
    `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  function release() {
    const current = held;
    held = undefined;
    if (current && !current.response.destroyed) current.finish();
  }
  return async function handle(request, response, pathname) {
    if (pathname === '/__reset') {
      held?.response.end();
      held = undefined;
      requests = [];
      runs.clear();
      threads.clear();
      sequence = 0;
      holdResume = holdDraft = failResume = failCreation = false;
      json(response, {});
      return true;
    }
    if (pathname === '/__release') {
      release();
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
    if (pathname === '/__hold-resume') {
      holdResume = true;
      json(response, {});
      return true;
    }
    if (pathname === '/__hold-draft') {
      holdDraft = true;
      json(response, {});
      return true;
    }
    if (pathname === '/__fail-resume') {
      failResume = true;
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
      threads.set(body.thread_id, { messages: [] });
      json(response, { thread_id: body.thread_id });
      return true;
    }
    const threadId = /\/threads\/([^/]+)/.exec(pathname)?.[1];
    if (pathname.endsWith('/runs/stream')) {
      const state = threads.get(threadId);
      if (!state) {
        json(response, { error: 'Unconfirmed thread' }, 400);
        return true;
      }
      const resumed = Object.hasOwn(body, 'command');
      if (resumed && failResume) {
        failResume = false;
        json(response, { error: 'PRIVATE resume response' }, 500);
        return true;
      }
      if (
        resumed &&
        (body.input !== null || !Object.hasOwn(body.command, 'resume'))
      ) {
        json(response, { error: 'Expected explicit resume' }, 400);
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
      if (!resumed) {
        const human = body.input.messages;
        const text = human.at(-1).content;
        const refund = {
          kind: 'refund_approval',
          amount: 47.5,
          customer_id: 'cus_a8x2k',
          reason: '<script>literal refund reason</script>',
        };
        const value =
          text === 'Unknown'
            ? { kind: 'unknown' }
            : text === 'Malformed'
            ? { ...refund, amount: -1 }
            : refund;
        const interrupts = [
          { id: 'refund-1', value },
          ...(text === 'Multiple' ? [{ id: 'refund-2', value: refund }] : []),
        ];
        state.messages = [...state.messages, ...human];
        response.write(event('values', { messages: state.messages }));
        response.write(
          event('messages', [
            {
              type: 'AIMessageChunk',
              id: 'draft-' + runId,
              content: 'Refund draft',
            },
            { langgraph_node: 'draft' },
          ])
        );
        const finish = () => {
          response.write(
            event('messages', [
              {
                type: 'AIMessageChunk',
                id: 'draft-' + runId,
                content: ' ready for review.',
              },
              { langgraph_node: 'draft' },
            ])
          );
          state.messages = [
            ...state.messages,
            {
              type: 'ai',
              id: 'draft-' + runId,
              content: 'Refund draft ready for review.',
            },
          ];
          response.write(
            event('values', {
              messages: state.messages,
              __interrupt__: interrupts,
            })
          );
          runs.get(runId).status = 'interrupted';
          response.end();
        };
        if (holdDraft) {
          holdDraft = false;
          const current = { response, finish };
          held = current;
          response.on('close', () => {
            if (held === current) held = undefined;
          });
        } else finish();
      } else {
        response.write(event('values', { messages: state.messages }));
        const decision = body.command.resume;
        const answer = decision.approved
          ? `Simulated refund of $${(decision.amount ?? 47.5).toFixed(
              2
            )} issued.`
          : 'Refund cancelled by operator.';
        const finish = () => {
          response.write(
            event('messages', [
              {
                type: 'AIMessageChunk',
                id: 'result-' + runId,
                content: answer,
              },
              { langgraph_node: 'issue' },
            ])
          );
          state.messages = [
            ...state.messages,
            { type: 'ai', id: 'result-' + runId, content: answer },
          ];
          response.write(event('values', { messages: state.messages }));
          runs.get(runId).status = 'success';
          response.end();
        };
        if (holdResume) {
          holdResume = false;
          const current = { response, finish };
          held = current;
          response.on('close', () => {
            if (held === current) held = undefined;
          });
        } else finish();
      }
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
