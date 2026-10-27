/** Frozen native AG-UI refund wire proof; excluded from public assembly. */
export function createAgUiInterruptsFixture() {
  let requests = [],
    sequence = 0,
    held;
  const conversations = new Map();
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
      conversations.clear();
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
    if (
      !['/ag-ui/interrupts/agent/native', '/developer-agent'].includes(pathname)
    )
      return false;
    let input = '';
    for await (const chunk of request) input += chunk;
    const body = input ? JSON.parse(input) : {};
    requests.push({ path: pathname, method: request.method, body });
    if (
      request.method !== 'POST' ||
      body.protocolVersion !== '1.0' ||
      typeof body.threadId !== 'string' ||
      !body.threadId ||
      typeof body.runId !== 'string' ||
      !body.runId ||
      !Array.isArray(body.messages)
    ) {
      json(response, { error: 'Invalid native request' }, 400);
      return true;
    }
    const previous = conversations.get(body.threadId);
    const resumed = body.resume !== undefined;
    const human = body.messages.at(-1);
    if (
      (!resumed &&
        (human?.role !== 'user' || typeof human.content !== 'string')) ||
      (resumed &&
        (!previous ||
          !Array.isArray(body.resume) ||
          body.resume.length !== 1 ||
          body.resume[0].interruptId !== previous.interrupt.id ||
          body.resume[0].status !== 'resolved' ||
          typeof body.resume[0].payload?.approved !== 'boolean' ||
          JSON.stringify(body.messages) !== JSON.stringify(previous.messages)))
    ) {
      json(response, { error: 'Invalid current native decision' }, 400);
      return true;
    }
    const mode = resumed ? previous.mode : human.content;
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
    if (mode === 'Run error' || (resumed && mode === 'Resume error')) {
      event(response, {
        type: 'RUN_ERROR',
        message: 'PRIVATE provider failure',
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
    const answer = {
      id: `answer-${++sequence}`,
      role: 'assistant',
      content: resumed
        ? body.resume[0].payload.approved
          ? `Refund of $${Number(
              body.resume[0].payload.amount ??
                previous.interrupt.metadata.langgraph.raw.amount
            ).toFixed(2)} issued to cus_demo.`
          : 'Refund cancelled by operator. No charge issued.'
        : 'Draft ready.',
    };
    event(response, {
      type: 'TEXT_MESSAGE_START',
      messageId: answer.id,
      role: 'assistant',
    });
    const hold =
      (!resumed && mode === 'Hold') || (resumed && mode === 'Resume hold');
    event(response, {
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: answer.id,
      delta: hold ? 'Live partial' : answer.content,
    });
    const finish = () => {
      event(response, { type: 'TEXT_MESSAGE_END', messageId: answer.id });
      let messages = [...body.messages, answer];
      if (
        mode === 'Duplicate identity' ||
        (resumed && mode === 'Resume duplicate identity')
      )
        messages = [...body.messages, { ...answer, id: body.messages[0].id }];
      if (mode === 'Tool')
        messages = [
          ...body.messages,
          {
            ...answer,
            toolCalls: [
              {
                id: 'call',
                type: 'function',
                function: { name: 'private', arguments: '{}' },
              },
            ],
          },
        ];
      if (resumed && mode === 'Resume truncated prefix') messages = [answer];
      if (resumed && mode === 'Resume old state') messages = body.messages;
      event(response, { type: 'MESSAGES_SNAPSHOT', messages });
      if (resumed) {
        conversations.delete(body.threadId);
        event(response, {
          type: 'STATE_SNAPSHOT',
          snapshot: {
            decision_approved: body.resume[0].payload.approved,
            refund_id: body.resume[0].payload.approved ? 're_demo_fake' : null,
          },
        });
        event(response, {
          type: 'RUN_FINISHED',
          threadId: body.threadId,
          runId: mode === 'Resume wrong terminal' ? 'wrong-run' : body.runId,
          ...(mode === 'Resume interrupted'
            ? { outcome: { type: 'cancelled' } }
            : {}),
          ...(mode === 'Resume second pause'
            ? {
                outcome: {
                  type: 'interrupt',
                  interrupts: [previous.interrupt],
                },
              }
            : {}),
        });
      } else {
        const interrupt = {
          id: `interrupt-${sequence}`,
          reason: 'human_approval',
          metadata: {
            langgraph: {
              raw: {
                kind: 'refund_approval',
                amount: 25,
                customer_id: 'cus_demo',
                reason: 'Fictional damaged item',
              },
            },
          },
        };
        if (mode === 'Malformed')
          interrupt.metadata.langgraph.raw.kind = 'other';
        if (mode === 'Negative amount')
          interrupt.metadata.langgraph.raw.amount = -1;
        if (mode === 'Expired') interrupt.expiresAt = '2020-01-01T00:00:00Z';
        if (mode === 'Child interrupt') interrupt.subagentRunId = 'child';
        conversations.set(body.threadId, { interrupt, messages, mode });
        if (mode === 'Legacy' || mode === 'Notice EOF') {
          event(response, {
            type: 'CUSTOM',
            name: 'on_interrupt',
            value: JSON.stringify([interrupt.metadata.langgraph.raw]),
          });
          if (mode === 'Notice EOF') {
            response.end();
            return;
          }
        }
        event(response, {
          type: 'RUN_FINISHED',
          threadId: body.threadId,
          runId: mode === 'Wrong terminal' ? 'wrong-run' : body.runId,
          ...(mode === 'Legacy'
            ? {}
            : {
                outcome: {
                  type: 'interrupt',
                  interrupts:
                    mode === 'Multiple'
                      ? [interrupt, { ...interrupt, id: 'second' }]
                      : [interrupt],
                },
              }),
        });
      }
      response.end();
    };
    if (hold) {
      const current = { response, finish };
      held = current;
      response.once('close', () => {
        if (held === current) held = undefined;
      });
    } else finish();
    return true;
  };
}
