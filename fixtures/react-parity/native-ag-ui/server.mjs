import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const order = [
  ['a', 'First'],
  ['a', 'Second'],
  ['b', 'Other'],
  ['a', 'Cancelable'],
];
const html =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Native AG-UI shared owner review</title></head><body><script type="module" src="/app.js"></script></body></html>';
const user = (id, content) => ({ id, role: 'user', content });
function firstHistory(first) {
  return [
    user(first.userId, 'First'),
    {
      id: `${first.runId}-answer`,
      role: 'assistant',
      content: 'Hello',
      toolCalls: [
        {
          id: `${first.runId}-call`,
          type: 'function',
          function: { name: 'weather', arguments: '{"city":"Paris"}' },
        },
      ],
      subagentRunId: 'worker',
    },
    {
      id: `${first.runId}-result`,
      role: 'tool',
      toolCallId: `${first.runId}-call`,
      content: '{"temperature":20}',
      subagentRunId: 'worker',
    },
  ];
}
function expectedInput(reviewId, role, command, runId, userId, review) {
  let messages = [];
  if (command === 'Second' || command === 'Cancelable')
    messages = firstHistory(review.accepted[0]);
  if (command === 'Cancelable') {
    const second = review.accepted[1];
    messages.push(user(second.userId, 'Second'), {
      id: `${second.runId}-answer`,
      role: 'assistant',
      content: 'Next answer',
    });
  }
  return {
    threadId: `${reviewId}-${role}`,
    runId,
    messages: [...messages, user(userId, command)],
    state: command === 'Second' || command === 'Cancelable' ? { count: 2 } : {},
    tools: [],
    context: [],
    forwardedProps: {},
  };
}
function emit(response, events) {
  assert.ok(
    !response.destroyed && !response.writableEnded,
    'cannot emit to a closed response'
  );
  for (const event of events)
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}
async function jsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    assert.ok(body.length <= 1_000_000, 'request too large');
  }
  return JSON.parse(body);
}

/** Independent oracle: only validated unpredictable IDs come from requests. */
export async function createReviewServer({ bundle, provenance }) {
  const requests = [],
    errors = [],
    reviews = new Map(),
    ids = new Set(),
    sockets = new Set(),
    closures = new Set();
  const stats = () => structuredClone({ requests, errors });
  const server = createServer(async (request, response) => {
    let resolveClosed;
    const closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    closures.add(closed);
    response.once('close', () => {
      closures.delete(closed);
      resolveClosed();
    });
    const route = new URL(request.url, 'http://127.0.0.1');
    let reviewId = route.searchParams.get('review');
    let record;
    const json = (status, value) => {
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(value));
    };
    try {
      if (request.method === 'GET' && route.pathname === '/') {
        response
          .writeHead(200, {
            'content-type': 'text/html',
            'cache-control': 'no-store',
          })
          .end(html);
      } else if (request.method === 'GET' && route.pathname === '/app.js') {
        response
          .writeHead(200, {
            'content-type': 'text/javascript',
            'cache-control': 'no-store',
          })
          .end(bundle);
      } else if (
        request.method === 'GET' &&
        route.pathname === '/favicon.ico'
      ) {
        response.writeHead(204).end();
      } else if (request.method === 'GET' && route.pathname === '/stats') {
        json(200, stats());
      } else if (request.method === 'GET' && route.pathname === '/provenance') {
        json(200, provenance);
      } else if (request.method === 'POST' && route.pathname === '/agent') {
        record = { reviewId, verified: false, closed: false };
        requests.push(record);
        response.once('close', () => {
          record.closed = true;
        });
        const input = await jsonBody(request);
        record.body = input;
        assert.match(reviewId ?? '', uuid, 'valid review ID required');
        const role = route.searchParams.get('owner');
        assert.deepEqual(
          [...route.searchParams.keys()].sort(),
          ['owner', 'review'],
          'exact agent query'
        );
        assert.ok(role === 'a' || role === 'b', 'known owner required');
        const review = reviews.get(reviewId) ?? {
          accepted: [],
          phase: 'initial',
        };
        const next = order[review.accepted.length];
        assert.ok(next, 'review already submitted four commands');
        assert.equal(role, next[0], 'owner command order');
        const command = next[1];
        assert.match(input.runId ?? '', uuid, 'valid run ID required');
        assert.ok(Array.isArray(input.messages), 'messages required');
        const last = input.messages.at(-1);
        assert.match(last?.id ?? '', uuid, 'valid user ID required');
        assert.equal(last.content, command, 'command order/content');
        assert.ok(
          input.runId !== last.id && !ids.has(input.runId) && !ids.has(last.id),
          'fresh distinct run and user IDs required'
        );
        if (command === 'Second')
          assert.ok(
            review.phase === 'first-advanced' &&
              review.accepted[0].record.closed,
            'First must pause and close before Second'
          );
        if (command === 'Other')
          assert.ok(
            review.phase === 'second-complete' &&
              review.accepted[1].record.closed,
            'Second must complete and close before Other'
          );
        assert.deepEqual(
          input,
          expectedInput(reviewId, role, command, input.runId, last.id, review),
          'exact full native input envelope'
        );
        ids.add(input.runId);
        ids.add(last.id);
        const accepted = {
          runId: input.runId,
          userId: last.id,
          response,
          record,
        };
        review.accepted.push(accepted);
        review.phase = `${command.toLowerCase()}-held`;
        reviews.set(reviewId, review);
        Object.assign(record, { owner: role, command, verified: true });
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
        });
        emit(response, [
          {
            type: 'RUN_STARTED',
            threadId: `${reviewId}-${role}`,
            runId: input.runId,
          },
        ]);
        if (command === 'First') {
          emit(response, [
            { type: 'STATE_SNAPSHOT', snapshot: { count: 1 } },
            {
              type: 'SUBAGENT_STARTED',
              subagentRunId: 'worker',
              name: 'Worker',
            },
            {
              type: 'TOOL_CALL_START',
              toolCallId: `${input.runId}-call`,
              toolCallName: 'weather',
              parentMessageId: `${input.runId}-answer`,
              subagentRunId: 'worker',
            },
            {
              type: 'TOOL_CALL_ARGS',
              toolCallId: `${input.runId}-call`,
              delta: '{"city":',
            },
          ]);
        } else {
          const content = {
            Second: 'Next answer',
            Other: 'Other answer',
            Cancelable: 'Cancelable answer',
          }[command];
          emit(response, [
            {
              type: 'TEXT_MESSAGE_START',
              messageId: `${input.runId}-answer`,
              role: 'assistant',
            },
            {
              type: 'TEXT_MESSAGE_CONTENT',
              messageId: `${input.runId}-answer`,
              delta: content,
            },
            { type: 'TEXT_MESSAGE_END', messageId: `${input.runId}-answer` },
            {
              type: 'STATE_SNAPSHOT',
              snapshot: {
                count:
                  command === 'Other' ? 99 : command === 'Cancelable' ? 3 : 2,
              },
            },
          ]);
        }
      } else if (request.method === 'POST' && route.pathname === '/control') {
        const body = await jsonBody(request);
        reviewId = body.reviewId;
        assert.match(reviewId ?? '', uuid, 'valid review ID required');
        assert.ok(
          ['advance-first', 'complete-second'].includes(body.action),
          'known control action required'
        );
        assert.deepEqual(
          body,
          { reviewId, action: body.action },
          'exact control envelope'
        );
        const review = reviews.get(reviewId);
        const first = body.action === 'advance-first';
        assert.equal(
          review?.phase,
          first ? 'first-held' : 'second-held',
          'invalid control phase'
        );
        const target = review.accepted[first ? 0 : 1];
        assert.equal(
          target.record.closed,
          false,
          'target response already closed'
        );
        const runId = target.runId;
        const terminal = {
          type: 'RUN_FINISHED',
          threadId: `${reviewId}-a`,
          runId,
        };
        if (first) {
          emit(target.response, [
            {
              type: 'TOOL_CALL_ARGS',
              toolCallId: `${runId}-call`,
              delta: '"Paris"}',
            },
            { type: 'TOOL_CALL_END', toolCallId: `${runId}-call` },
            {
              type: 'TOOL_CALL_RESULT',
              messageId: `${runId}-result`,
              toolCallId: `${runId}-call`,
              content: '{"temperature":20}',
              subagentRunId: 'worker',
            },
            {
              type: 'TEXT_MESSAGE_START',
              messageId: `${runId}-answer`,
              role: 'assistant',
              subagentRunId: 'worker',
            },
            {
              type: 'TEXT_MESSAGE_CONTENT',
              messageId: `${runId}-answer`,
              delta: 'Hello',
            },
            { type: 'TEXT_MESSAGE_END', messageId: `${runId}-answer` },
            {
              type: 'STATE_DELTA',
              delta: [{ op: 'replace', path: '/count', value: 2 }],
            },
            {
              type: 'SUBAGENT_FINISHED',
              subagentRunId: 'worker',
              outcome: { type: 'suspended', interruptIds: ['approval'] },
            },
            {
              ...terminal,
              outcome: {
                type: 'interrupt',
                interrupts: [{ id: 'approval', reason: 'Approve' }],
              },
            },
          ]);
        } else emit(target.response, [terminal]);
        review.phase = first ? 'first-advanced' : 'second-complete';
        json(200, { sent: body.action });
      } else throw new Error('Unexpected method or route');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ reviewId, message });
      if (record) record.error = message;
      if (!response.headersSent) json(422, { error: message });
      else response.destroy();
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let closing;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    stats,
    close: () =>
      (closing ??= Promise.all([
        ...closures,
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          for (const socket of sockets) socket.destroy();
        }),
      ]).then(() => undefined)),
  };
}
