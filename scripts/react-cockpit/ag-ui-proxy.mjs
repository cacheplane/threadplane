/**
 * Local e2e only: a recording proxy in front of an AG-UI example's real
 * server (uvicorn `src/server.py`, ag-ui-langgraph, on aimock fixtures shared
 * with the Angular example). The AG-UI flavor of langgraph-proxy.mjs.
 *
 * The graph, the AG-UI HTTP/SSE wire and the model replies are real. This
 * layer only adds what a browser contract test needs and a live server cannot
 * produce on demand:
 *
 *   GET  /__requests          every agent POST, in order: { path, method, body }
 *   GET  /__captures          per finished run: { path, sse, events } as the
 *                             real server sent them (before any edit)
 *   GET  /__lifetime          { active (a held stream), openResponses }
 *   GET|POST /__ready         200 once the server answers /ok (with
 *                             `serve.mjs --backend`, after its lazy start)
 *   POST /__reset             forget requests and captures, drop one-shot
 *                             controls, end a held stream
 *   POST /__hold/stream       hold the next run stream after the first event
 *                             whose type matches `afterType` (default
 *                             TEXT_MESSAGE_CONTENT) or whose raw JSON matches
 *                             `afterPattern`; buffers the rest
 *   POST /__release           flush and resume a held stream
 *   POST /__fail-stream       next agent POST answers 500 unforwarded (the
 *                             server is unavailable)
 *   POST /__stream/edit       body { ops }: edits to the next run stream, each
 *                             { type: regex on the event type, op, once? }:
 *                               drop                     remove the event
 *                               patch { set }            merge fields into it
 *                               omit { keys }            remove fields
 *                               outcome { mode }         rewrite the real
 *                                                        interrupt of a
 *                                                        RUN_FINISHED outcome:
 *                                                        multiple, malformed,
 *                                                        expired, child
 *                               insertBefore|insertAfter { event }
 *                               end                      end the stream just
 *                                                        before the event
 *                               snapshot { mode }        rewrite a
 *                                                        MESSAGES_SNAPSHOT:
 *                                                        duplicate-identity,
 *                                                        truncated-prefix,
 *                                                        old-pair, answer-only,
 *                                                        sent, drop-sent,
 *                                                        duplicate-result,
 *                                                        orphan-result,
 *                                                        unstable-result,
 *                                                        result-content
 *                                                        { content },
 *                                                        tool-call
 *                             `persist: true` applies the ops to every later
 *                             run until reset (a backend property, not a
 *                             one-off fault).
 *                             "$threadId", "$runId", "$humanId" and
 *                             "$answerId" in values are the run's own ids.
 *                             Injected data: protocol shapes a correct server
 *                             won't produce, for the client's fault handling.
 *
 * Nothing here is reachable from a production build: only
 * scripts/react-cockpit/serve.mjs and local tests import it.
 */
import { request as httpRequest } from 'node:http';

const json = (response, value, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};
const readAll = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

/** The snapshot shapes the authored AG-UI fixtures produced. */
function rewriteSnapshot(mode, event, body, options = {}) {
  const sent = body.messages ?? [];
  const human = sent.at(-1);
  const messages = [...event.messages];
  const answer = messages.at(-1);
  if (mode === 'duplicate-identity') messages[messages.length - 1] = { ...answer, id: human.id };
  else if (mode === 'truncated-prefix') return { ...event, messages: [human, answer] };
  else if (mode === 'old-pair') return { ...event, messages: sent.slice(0, -1) };
  else if (mode === 'answer-only') return { ...event, messages: [answer] };
  else if (mode === 'drop-sent') {
    const sentIds = new Set(sent.map((message) => message.id));
    return { ...event, messages: messages.filter((message) => !sentIds.has(message.id)) };
  } else if (mode === 'duplicate-result') {
    const index = messages.findLastIndex((message) => message.role === 'tool');
    messages.splice(messages.length - 1, 0, { ...messages[index], id: 'duplicate-result' });
  } else if (mode === 'unstable-result') {
    // Every saved result under another identity (with `persist`, the proxy
    // maps them back on the way upstream, so the server's history agrees).
    return {
      ...event,
      messages: messages.map((message) =>
        message.role === 'tool' ? { ...message, id: `graph-${message.toolCallId}` } : message
      ),
    };
  } else if (mode === 'result-content') {
    const index = messages.findLastIndex((message) => message.role === 'tool');
    messages[index] = { ...messages[index], content: options.content };
  } else if (mode === 'orphan-result')
    messages.splice(messages.length - 1, 0, { id: 'orphan', role: 'tool', toolCallId: 'orphan-call', content: '{}' });
  else if (mode === 'sent') return { ...event, messages: sent };
  else if (mode === 'tool-call')
    messages[messages.length - 1] = {
      ...answer,
      toolCalls: [{ id: 'call', type: 'function', function: { name: 'weather', arguments: '{}' } }],
    };
  else throw new Error('Unsupported snapshot mode');
  return { ...event, messages };
}

/** Rewrites the real interrupt in a RUN_FINISHED interrupt outcome. */
function rewriteOutcome(mode, event) {
  const [first] = event.outcome?.interrupts ?? [];
  if (!first) return event;
  const copy = structuredClone(first);
  if (mode === 'multiple') return { ...event, outcome: { ...event.outcome, interrupts: [first, { ...copy, id: 'second' }] } };
  if (mode === 'malformed') copy.metadata.langgraph.raw.kind = 'other';
  else if (mode === 'expired') copy.expiresAt = '2020-01-01T00:00:00Z';
  else if (mode === 'child') copy.subagentRunId = 'child';
  else throw new Error('Unsupported outcome mode');
  return { ...event, outcome: { ...event.outcome, interrupts: [copy] } };
}

export function createAgUiProxy({ upstream, agentPaths, agentPath = '/agent', ready = async () => {} }) {
  let requests = [];
  let captures = [];
  const pendingCaptures = new Set();
  let holdNext = null;
  let held;
  let failNext = false;
  let nextEdits = null;
  let stickyEdits = [];
  let openResponses = 0;

  function reset() {
    requests = [];
    captures = [];
    holdNext = null;
    failNext = false;
    nextEdits = null;
    stickyEdits = [];
    held?.end();
    held = undefined;
  }

  async function proxyRun(request, response, pathname, raw) {
    const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    requests.push({ path: pathname, method: request.method, body });
    if (stickyEdits.some((op) => op.mode === 'unstable-result') && Array.isArray(body.messages))
      raw = Buffer.from(
        JSON.stringify({
          ...body,
          messages: body.messages.map((message) =>
            message.role === 'tool' && message.id === `graph-${message.toolCallId}`
              ? { ...message, id: message.toolCallId }
              : message
          ),
        })
      );
    if (failNext) {
      failNext = false;
      json(response, { error: 'PRIVATE AG-UI server failure' }, 500);
      return;
    }
    const hold = holdNext;
    holdNext = null;
    const edits = [...stickyEdits, ...(nextEdits ?? [])].map((op) => ({ ...op, pattern: new RegExp(op.type ?? '.*'), used: false }));
    nextEdits = null;
    const ids = { threadId: body.threadId, runId: body.runId, humanId: body.messages?.at(-1)?.id, answerId: null };
    const fill = (value) =>
      JSON.parse(
        JSON.stringify(value).replace(/"\$(threadId|runId|humanId|answerId)"/g, (_, key) => JSON.stringify(ids[key]))
      );
    const upstreamResponse = await new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        new URL(agentPath, upstream),
        { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' } },
        resolve
      );
      outgoing.once('error', reject);
      outgoing.end(raw);
    });
    response.writeHead(upstreamResponse.statusCode, {
      'content-type': upstreamResponse.headers['content-type'] ?? 'text/event-stream',
      'cache-control': 'no-cache',
    });
    response.flushHeaders();
    response.on('close', () => upstreamResponse.destroy());
    let settle;
    const settled = new Promise((done) => { settle = done; });
    pendingCaptures.add(settled);
    void settled.then(() => pendingCaptures.delete(settled));
    response.once('close', () => settle());
    let sse = '';
    let pending = '';
    let holding = false;
    let armed = Boolean(hold);
    let ended = false;
    const buffered = [];
    const events = [];
    const write = (event) => {
      if (!response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    /** Apply edits to one real event; returns false once the stream must end. */
    const forward = (event) => {
      if (event.type === 'TEXT_MESSAGE_START' && !ids.answerId) ids.answerId = event.messageId;
      const after = [];
      let current = event;
      for (const op of edits) {
        if ((op.once && op.used) || !op.pattern.test(event.type)) continue;
        op.used = true;
        if (op.op === 'drop') return true;
        if (op.op === 'end') {
          response.end();
          return false;
        }
        if (op.op === 'patch') current = { ...current, ...fill(op.set) };
        if (op.op === 'omit') {
          current = { ...current };
          for (const key of op.keys ?? []) delete current[key];
        }
        if (op.op === 'outcome') current = rewriteOutcome(op.mode, current);
        if (op.op === 'snapshot') current = rewriteSnapshot(op.mode, current, body, op);
        if (op.op === 'insertBefore') write(fill(op.event));
        if (op.op === 'insertAfter') after.push(fill(op.event));
      }
      write(current);
      for (const extra of after) write(extra);
      return true;
    };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (!response.writableEnded) response.end();
      captures.push({ path: pathname, sse, events });
      settle();
    };
    const held_ = {
      release() {
        if (held === held_) held = undefined;
        holding = false;
        for (const event of buffered.splice(0)) if (!forward(event)) return;
        if (ended) finish();
      },
      end() {
        if (!response.writableEnded) response.end();
      },
    };
    upstreamResponse.setEncoding('utf8');
    upstreamResponse.on('data', (chunk) => {
      sse += chunk;
      pending += chunk;
      let match;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        const block = pending.slice(0, match.index);
        pending = pending.slice(match.index + match[0].length);
        const line = block.split(/\r?\n/).find((l) => l.startsWith('data:'));
        if (!line) continue;
        const event = JSON.parse(line.slice(5));
        events.push(event);
        if (response.writableEnded) continue;
        if (holding) {
          buffered.push(event);
          continue;
        }
        if (!forward(event)) continue;
        if (
          armed &&
          (hold.afterPattern ? new RegExp(hold.afterPattern).test(line) : event.type === (hold.afterType ?? 'TEXT_MESSAGE_CONTENT'))
        ) {
          armed = false;
          holding = true;
          held = held_;
        }
      }
    });
    upstreamResponse.on('end', () => {
      ended = true;
      if (!holding) finish();
    });
    // The real server drops the connection when the graph raises mid-run:
    // end the browser's stream there too, without a terminal event.
    upstreamResponse.on('aborted', () => {
      ended = true;
      if (!holding) finish();
    });
    upstreamResponse.on('error', () => {
      ended = true;
      if (!holding) finish();
    });
    response.on('close', () => {
      if (held === held_) held = undefined;
    });
  }

  const controls = {
    '/__requests': [['GET'], () => requests],
    '/__captures': [['GET'], async () => {
      await Promise.all(pendingCaptures);
      return captures;
    }],
    '/__lifetime': [['GET'], () => ({ active: Boolean(held), openResponses })],
    '/__ready': [['GET', 'POST'], async () => {
      await ready();
      const answer = await fetch(new URL('/ok', upstream));
      if (!answer.ok) throw new Error('AG-UI server is not ready');
      return {};
    }],
    '/__reset': [['POST'], () => { reset(); return {}; }],
    '/__hold/stream': [['POST'], (body) => {
      holdNext = { afterType: body.afterType, afterPattern: body.afterPattern };
      return {};
    }],
    '/__release': [['POST'], () => { held?.release(); return {}; }],
    '/__fail-stream': [['POST'], () => { failNext = true; return {}; }],
    '/__stream/edit': [['POST'], (body) => {
      if (body.persist) stickyEdits = body.ops ?? [];
      else nextEdits = body.ops ?? [];
      return {};
    }],
  };

  return async function handle(request, response, pathname) {
    if (Object.hasOwn(controls, pathname)) {
      const [methods, run] = controls[pathname];
      if (!methods.includes(request.method)) {
        json(response, {}, 405);
        return true;
      }
      const raw = (await readAll(request)).toString('utf8');
      try {
        json(response, await run(raw ? JSON.parse(raw) : {}));
      } catch {
        json(response, { error: 'Local proxy control failed' }, 500);
      }
      return true;
    }
    if (!agentPaths.includes(pathname)) return false;
    if (request.method !== 'POST') {
      json(response, {}, 405);
      return true;
    }
    openResponses += 1;
    response.once('close', () => { openResponses -= 1; });
    await ready();
    const raw = await readAll(request);
    try {
      await proxyRun(request, response, pathname, raw);
    } catch {
      if (!response.headersSent) json(response, { error: 'PRIVATE AG-UI proxy failure' }, 502);
      else response.end();
    }
    return true;
  };
}
