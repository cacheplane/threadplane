/**
 * Local e2e only: a thin recording + fault-injection proxy between the React
 * cockpit static server and a real `langgraph dev` that talks to aimock.
 *
 * The graph, the LangGraph HTTP/SSE wire and the model replies are all real
 * (aimock replays the per-prompt fixtures shared with the Angular example).
 * This layer only adds what a browser contract test needs and a live server
 * cannot produce on demand:
 *
 *   GET  /__requests          every /api and /developer-api request, in order
 *   GET|POST /__ready         200 once `langgraph dev` answers /ok (graph loaded;
 *                             with `serve.mjs --backend`, after its lazy start).
 *                             GET lets a Playwright webServer use it as its
 *                             readiness URL, so the boot finishes before tests.
 *   GET  /__lifetime          { activeStream, activeHistory, activeTitle,
 *                               activeState, openResponses }
 *   GET  /__captures          per finished run: forwarded SSE text, saved
 *                             messages/values/checkpoint/next from the real
 *                             server, title
 *                             before and after the run (waits for captures
 *                             still being read)
 *   POST /__reset             forget requests, drop held responses, clear modes
 *   POST /__fail-create       next thread creation answers 500 without forwarding
 *   POST /__history/<mode>    safe | hold | changed | missing | pending | failed,
 *                             or tool evidence: args | result | name | ids |
 *                             interrupt | subgraph, or approval evidence:
 *                             mismatch | unsupported; foreign (checkpoint of
 *                             another thread); failure (= failed); paused
 *                             (pending with an unknown interrupt task)
 *   POST /__title/<mode>      thread metadata read: safe | hold | missing |
 *                             wrong-thread | invalid | titlefailure | literal |
 *                             long (mode captured when the read arrives)
 *   POST /__hold/title        hold the next thread metadata read
 *   POST /__hold/history      hold the next history read
 *   POST /__state/<mode>      checkpoint state reads: safe | hold | failure |
 *                             changed | foreign | malformed | unsafe (a pending
 *                             task on the source) | task-error (a failed task)
 *                             | missing-terminal (no completed_turn_id) |
 *                             malformed-layout (the render owner's content) |
 *                             stale-terminal | foreign-terminal | old-message |
 *                             old-data | incomplete-tools | missing-dashboard |
 *                             disagreeing-dashboard (chat/generative-ui's
 *                             saved-turn markers and dashboard)
 *   POST /__hold/state        hold the next checkpoint state read
 *   POST /__release-state     finish a held checkpoint state read
 *   POST /__mapped-checkpoints body { extra? }: until reset, checkpoints the
 *                             browser receives (history, state, `checkpoints`
 *                             events) carry the map { "": checkpoint_id,
 *                             ...extra } — the HTTP shape some deployments
 *                             return. Maps the browser sends back are recorded
 *                             as sent and stripped before forwarding.
 *   POST /__release-title     finish a held metadata read
 *   POST /__release-history   finish a held history read
 *   POST /__history-values    body { set?, omit?, entry? }: the next history
 *                             read's latest values get keys set or removed and
 *                             `entry` fields (e.g. next) overwritten (an
 *                             authoritative server-side correction, e.g.
 *                             replaced or emptied messages). Injected data.
 *   POST /__hold/stream       hold the next run stream; body { afterText? } holds
 *                             after the first AI message chunk (or once the AI text
 *                             contains afterText); { beforeToolResult: true }
 *                             holds just before the first tool result event;
 *                             { afterChildMessage: true } holds after the first
 *                             subgraph (namespaced `messages|…`) text chunk
 *   POST /__child/<mode>      role | task | error: before the next run's first
 *                             child `values|…` event, inject a malformed copy
 *                             (unsupported subagent_type, null task_description)
 *                             or a child `error|…` event carrying a private
 *                             diagnostic. Injected data, as the authored
 *                             subagents fixture did.
 *                             { immediate: true } holds right after the first
 *                             event (e.g. a resume whose graph emits no tokens);
 *                             { afterPattern } after the first event whose raw
 *                             text matches the regex; { end: true } ends the
 *                             browser's stream at that point instead (an
 *                             uncertain outcome) and closes the upstream run
 *   POST /__run-status/<s>    until reset, GET /runs/<id> reports status <s>
 *                             (running | success | …); `real` restores it
 *   POST /__interrupt/<mode>  unknown | multiple: until reset, root interrupts
 *                             the browser receives are rewritten to an
 *                             unsupported kind, or duplicated into a batch of
 *                             two. Injected data: a real graph emits one
 *                             supported interrupt per pause.
 *   POST /__values            body { set?, omit?, persist? }: the next run's
 *                             `values` events get keys set or removed (injected
 *                             authoritative state a real graph won't produce:
 *                             replaced or malformed fields, an unexpected
 *                             pause). `persist` is written to the real thread
 *                             before the stream ends so later turns agree.
 *   POST /__stream/edit       body { ops }: edits to the next run stream, each
 *                             { event: regex, op, ... } applied to matching SSE
 *                             events: drop | patch { path?, set } | omit
 *                             { path?, keys } | append { path, value } |
 *                             truncate { path, keep } | duplicateLast { path } |
 *                             copy { from, to } | insertAfter { insert: { event,
 *                             data } } (`$ns` in the inserted name is the
 *                             matched event's `|namespace`; the string
 *                             "$humanId" in data is the submitted message id).
 *                             `once: true` applies an op to its first match only;
 *                             `ifKey` only to events whose state has that key.
 *                             `dataPattern` only to events whose raw data
 *                             line matches that regex.
 *                             `unlessKey` skips events whose state has that key.
 *                             `anonymous: true` withholds the run identity (the
 *                             metadata event and Content-Location header).
 *                             With `state: true`, the value ops also apply to
 *                             later checkpoint state reads (until reset), so a
 *                             fork's confirmation read agrees with its stream.
 *                             For `checkpoints` events, ops address `values`.
 *                             Injected data for stream shapes a real graph
 *                             won't produce (missing/stale markers, child
 *                             pauses, errors and tool calls).
 *   POST /__hold/state-write  hold the next client state write (POST
 *                             /threads/<id>/state, e.g. a client tool result)
 *   POST /__fail/state-write  next client state write answers 500 unforwarded
 *   GET  /__thread/<id>       the real thread state (not recorded in /__requests)
 *   POST /__thread/<id>/state write the real thread state (unrecorded), e.g. a
 *                             competing tip committed by someone else
 *   POST /__history-copies    body { copies: [{ index?, set: { path: value } }] }:
 *                             the next history read gains copies of entries,
 *                             with dotted paths overwritten (duplicate, child
 *                             namespace or malformed references). Injected.
 *   POST /__stream/cut        body { beforePattern, error }: the next run's
 *                             browser stream ends with `event: error` (data
 *                             `error`) just before the first event whose raw
 *                             text matches beforePattern; the real run upstream
 *                             still finishes. Injected data: stands in for a
 *                             failure inside the graph (e.g. a store read) at
 *                             that point, which aimock can't cause.
 *   POST /__fail-stream       next run stream answers 500 without forwarding
 *                             (the graph worker is unavailable)
 *   POST /__release           flush and resume a held run stream (and finish a
 *                             held client state write)
 *   POST /__inject/reasoning  body { text }: until reset, every AI message the
 *                             browser receives (stream, history, state) carries
 *                             additional_kwargs.reasoning_content = text.
 *                             Injected data: ChatOpenAI over Chat Completions
 *                             never surfaces reasoning, so a real graph can't
 *                             produce it for the reasoning-styling checks.
 *
 * Nothing here is reachable from a production build: only
 * scripts/react-cockpit/serve.mjs imports it.
 */
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';

// Saved-evidence rewrites of the latest history entry. Tool modes mirror the
// authored tool-calls fixture: corrupt one piece of tool evidence each.
const HISTORY_MODES = [
  'safe', 'hold', 'changed', 'missing', 'pending', 'failed',
  'args', 'result', 'name', 'ids', 'interrupt', 'subgraph',
  'mismatch', 'unsupported', 'foreign', 'failure', 'paused',
];
// Rewrites of checkpoint state reads (POST /threads/<id>/state/checkpoint).
const STATE_MODES = ['safe', 'hold', 'failure', 'changed', 'foreign', 'malformed', 'unsafe', 'missing-terminal', 'malformed-layout', 'task-error',
  'stale-terminal', 'foreign-terminal', 'old-message', 'old-data', 'incomplete-tools', 'missing-dashboard',
  'disagreeing-dashboard'];
// Rewrites of the thread metadata read (GET /threads/<id>) the client uses for titles.
const TITLE_MODES = ['safe', 'hold', 'missing', 'wrong-thread', 'invalid', 'titlefailure', 'literal', 'long'];
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'host']);

const json = (response, value, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};

function upstreamHeaders(headers, length) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) out[name] = value;
  }
  if (length !== undefined) out['content-length'] = String(length);
  return out;
}

function forwardedHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/** Text of an AI message chunk carried by a LangGraph `messages` SSE event. */
function aiText(rawEvent) {
  const name = /^event: *(.*)$/m.exec(rawEvent)?.[1]?.trim() ?? '';
  if (!name.startsWith('messages')) return null;
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  try {
    const value = JSON.parse(data);
    const message = Array.isArray(value) ? value[0] : null;
    if (!message || !String(message.type ?? '').startsWith('AI')) return null;
    return typeof message.content === 'string' ? message.content : '';
  } catch {
    return null;
  }
}

const at = (root, path) => {
  let target = root;
  for (const part of (path ?? '').split('.').filter(Boolean)) {
    if (target == null) return null;
    target = Array.isArray(target) ? target.at(Number(part)) : target[part];
  }
  return target;
};

/** Applies one /__stream/edit value op to a state object; true when it changed. */
function applyStateOp(op, state, humanId) {
  const withHuman = (value) => JSON.parse(JSON.stringify(value).replaceAll('"$humanId"', JSON.stringify(humanId)));
  if (op.ifKey && !(state && typeof state === 'object' && op.ifKey in state)) return false;
  if (op.op === 'patch' || op.op === 'omit') {
    const target = at(state, op.path);
    if (!target || typeof target !== 'object') return false;
    if (op.op === 'patch') Object.assign(target, withHuman(op.set ?? {}));
    else for (const key of op.keys ?? []) delete target[key];
    return true;
  }
  if (['append', 'truncate', 'duplicateLast'].includes(op.op)) {
    const list = at(state, op.path);
    if (!Array.isArray(list)) return false;
    if (op.op === 'append') list.push(withHuman(op.value));
    if (op.op === 'truncate') list.splice(0, Math.max(0, list.length - op.keep));
    if (op.op === 'duplicateLast' && list.length) list.push(structuredClone(list.at(-1)));
    return true;
  }
  if (op.op === 'copy') {
    const value = at(state, op.from);
    const parent = at(state, op.to.split('.').slice(0, -1).join('.'));
    if (value === undefined || !parent || typeof parent !== 'object') return false;
    parent[op.to.split('.').at(-1)] = structuredClone(value);
    return true;
  }
  return false;
}

export function createLanggraphProxy({ upstream, ready = async () => {} }) {
  const target = new URL(upstream);
  let requests = [];
  let failCreate = false;
  let failStream = false;
  let nextStreamCut = null;
  let childFault = null;
  let titleMode = 'safe';
  let holdNextTitle = false;
  let heldTitle;
  let holdNextHistory = false;
  let stateMode = 'safe';
  let holdNextState = false;
  let heldState;
  let mapped = false;
  let interruptMode = null;
  let nextValues = null;
  let nextHistoryValues = null;
  let nextStreamEdits = null;
  let stateEdits = null;
  let nextHistoryCopies = null;
  let runStatus = null;
  let holdNextStateWrite = false;
  let failNextStateWrite = false;
  let heldStateWrite;
  let historyMode = 'safe';
  let holdNextStream = null;
  let heldStream;
  let heldHistory;
  let captures = [];
  const pendingCaptures = new Set();
  let openResponses = 0;
  let reasoning = null;

  const withReasoning = (message) =>
    reasoning && message?.type === 'ai'
      ? { ...message, additional_kwargs: { ...message.additional_kwargs, reasoning_content: reasoning } }
      : message;
  const decorateValues = (values) =>
    reasoning && Array.isArray(values?.messages)
      ? { ...values, messages: values.messages.map(withReasoning) }
      : values;
  // `updates` and `checkpoints` events carry saved messages nested under node
  // names or checkpoint values; decorate every `messages` array they hold.
  const decorateDeep = (value) => {
    if (Array.isArray(value)) return value.map(decorateDeep);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, entry] of Object.entries(value))
      out[key] = key === 'messages' && Array.isArray(entry) ? entry.map(withReasoning) : decorateDeep(entry);
    return out;
  };
  const mapCheckpoint = (checkpoint) =>
    mapped && checkpoint?.checkpoint_id
      ? { ...checkpoint, checkpoint_map: { '': checkpoint.checkpoint_id, ...mapped.extra } }
      : checkpoint;
  const mapState = (state) =>
    mapped && state && typeof state === 'object'
      ? { ...state, checkpoint: mapCheckpoint(state.checkpoint), parent_checkpoint: mapCheckpoint(state.parent_checkpoint) }
      : state;
  const rewriteInterrupts = (value) => {
    if (Array.isArray(value)) return value.map(rewriteInterrupts);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__interrupt__' && Array.isArray(entry) && entry.length) {
        out[key] = interruptMode === 'unknown'
          ? entry.map((item) => ({ ...item, value: { kind: 'unknown' } }))
          : [...entry, { ...entry[0], id: `${entry[0].id ?? 'interrupt'}-duplicate` }];
      } else out[key] = rewriteInterrupts(entry);
    }
    return out;
  };
  /** Rewrite one SSE event for an armed injection; first AI chunk per message only. */
  const decoratedChunks = new Set();
  function decorateEvent(raw) {
    if (mapped && /^event: *checkpoints/m.test(raw)) {
      const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith('data:'));
      const value = JSON.parse(dataLine.slice(5));
      const config = value?.config?.configurable;
      if (config?.checkpoint_id) value.config.configurable = mapCheckpoint(config);
      raw = raw.replace(dataLine, 'data: ' + JSON.stringify(value));
    }
    if (interruptMode && raw.includes('"__interrupt__"')) {
      const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith('data:'));
      raw = raw.replace(dataLine, 'data: ' + JSON.stringify(rewriteInterrupts(JSON.parse(dataLine.slice(5)))));
    }
    if (!reasoning) return raw;
    const name = /^event: *(.*)$/m.exec(raw)?.[1]?.trim() ?? '';
    const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith('data:'));
    if (!dataLine) return raw;
    let value;
    try { value = JSON.parse(dataLine.slice(5)); } catch { return raw; }
    if (name.startsWith('messages') && Array.isArray(value) && String(value[0]?.type ?? '').startsWith('AI')) {
      if (decoratedChunks.has(value[0].id)) return raw;
      decoratedChunks.add(value[0].id);
      value = [{ ...value[0], additional_kwargs: { ...value[0].additional_kwargs, reasoning_content: reasoning } }, ...value.slice(1)];
    } else if (/^(values|updates|checkpoints)\b/.test(name)) value = decorateDeep(value);
    else return raw;
    return raw.replace(dataLine, 'data: ' + JSON.stringify(value));
  }

  function reset() {
    heldStream?.response.destroy();
    heldHistory?.response.destroy();
    heldStream = heldHistory = undefined;
    requests = [];
    captures = [];
    reasoning = null;
    decoratedChunks.clear();
    failCreate = false;
    failStream = false;
    nextStreamCut = null;
    childFault = null;
    titleMode = 'safe';
    holdNextTitle = false;
    heldTitle?.response.destroy();
    heldTitle = undefined;
    holdNextHistory = false;
    stateMode = 'safe';
    holdNextState = false;
    heldState?.response.destroy();
    heldState = undefined;
    mapped = false;
    interruptMode = null;
    nextValues = null;
    nextHistoryValues = null;
    nextStreamEdits = null;
    stateEdits = null;
    nextHistoryCopies = null;
    runStatus = null;
    holdNextStateWrite = false;
    failNextStateWrite = false;
    heldStateWrite?.response.destroy();
    heldStateWrite = undefined;
    historyMode = 'safe';
    holdNextStream = null;
  }

  function send(method, path, headers, body) {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          method,
          path,
          headers: upstreamHeaders(headers, body.length),
        },
        resolve,
      );
      outgoing.once('error', reject);
      outgoing.end(body);
    });
  }

  async function readAll(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  function transformHistory(input, rewrite, copyRequests) {
    const states = Array.isArray(input)
      ? input.map((state) => mapState({ ...state, values: decorateValues(state.values) }))
      : input;
    if (!Array.isArray(states) || states.length === 0) return states;
    const latest = structuredClone(states[0]);
    const copies = (copyRequests ?? []).map((request) => {
      const entry = structuredClone(states[request.index ?? 0]);
      for (const [path, value] of Object.entries(request.set ?? {})) {
        const parent = at(entry, path.split('.').slice(0, -1).join('.'));
        if (parent && typeof parent === 'object') parent[path.split('.').at(-1)] = value;
      }
      return entry;
    });
    if (rewrite) {
      latest.values = { ...latest.values, ...(rewrite.set ?? {}) };
      for (const key of rewrite.omit ?? []) delete latest.values[key];
      Object.assign(latest, rewrite.entry ?? {});
    }
    const messages = latest.values?.messages ?? [];
    const assistant = messages.find((m) => m.tool_calls?.length);
    const result = messages.find((m) => m.type === 'tool');
    if (historyMode === 'changed' && messages.length)
      messages.at(-1).content = 'Changed saved answer';
    if (historyMode === 'missing') messages.pop();
    if (historyMode === 'pending') latest.next = ['unexpected'];
    if (historyMode === 'paused') {
      latest.next = ['unknown'];
      latest.tasks = [{ id: 'task', name: 'unknown', interrupts: [{ id: 'pause', value: { kind: 'unknown' } }] }];
    }
    if (historyMode === 'args' && assistant)
      assistant.tool_calls[0].args = { flight_number: 'Changed' };
    if (historyMode === 'result' && result) result.content = 'Changed tool observation';
    if (historyMode === 'name' && result) result.name = 'unsupported';
    if (historyMode === 'ids' && result) result.tool_call_id = 'orphan';
    if (historyMode === 'interrupt')
      latest.tasks = [{ id: 'unexpected', name: 'tools', interrupts: [{ id: 'unexpected', value: { type: 'unexpected' } }] }];
    const approval = latest.tasks?.[0]?.interrupts?.[0]?.value;
    if (historyMode === 'mismatch' && approval?.flight) approval.flight.flight_number = 'DL999';
    if (historyMode === 'unsupported' && approval) approval.type = 'unsupported';
    if (historyMode === 'foreign' && latest.checkpoint)
      latest.checkpoint = { ...latest.checkpoint, thread_id: randomUUID() };
    if (historyMode === 'subgraph' && latest.checkpoint)
      latest.checkpoint = { ...latest.checkpoint, checkpoint_ns: 'foreign:checkpoint' };
    return [latest, ...states.slice(1), ...copies];
  }

  async function proxyHistory(request, response, path, body) {
    const holdThis = holdNextHistory || historyMode === 'hold';
    holdNextHistory = false;
    const rewrite = nextHistoryValues;
    nextHistoryValues = null;
    const copyRequests = nextHistoryCopies;
    nextHistoryCopies = null;
    if (historyMode === 'failed' || historyMode === 'failure') {
      json(response, { error: 'PRIVATE history' }, 500);
      return;
    }
    const upstreamResponse = await send(request.method, path, request.headers, body);
    const raw = await readAll(upstreamResponse);
    const finish = () => {
      if (response.destroyed) return;
      if (upstreamResponse.statusCode !== 200) {
        response.writeHead(upstreamResponse.statusCode, forwardedHeaders(upstreamResponse.headers));
        response.end(raw);
        return;
      }
      json(response, transformHistory(JSON.parse(raw.toString('utf8')), rewrite, copyRequests));
    };
    if (!holdThis) return finish();
    const held = { response, finish };
    heldHistory = held;
    response.on('close', () => {
      if (heldHistory === held) heldHistory = undefined;
    });
  }

  async function proxyTitle(request, response, path, body) {
    const mode = titleMode;
    const hold = holdNextTitle || mode === 'hold';
    holdNextTitle = false;
    if (mode === 'titlefailure') {
      json(response, { error: 'PRIVATE title' }, 500);
      return;
    }
    const upstreamResponse = await send(request.method, path, request.headers, body);
    const raw = await readAll(upstreamResponse);
    const finish = () => {
      if (response.destroyed) return;
      if (upstreamResponse.statusCode !== 200) {
        response.writeHead(upstreamResponse.statusCode, forwardedHeaders(upstreamResponse.headers));
        response.end(raw);
        return;
      }
      const thread = JSON.parse(raw.toString('utf8'));
      const metadata = { ...thread.metadata };
      if (mode === 'missing') delete metadata.title;
      if (mode === 'invalid') metadata.title = { invalid: true };
      if (mode === 'literal') metadata.title = '<script>alert("title")</script>';
      if (mode === 'long') metadata.title = 'Long authored title '.repeat(30);
      json(response, {
        ...thread,
        metadata,
        ...(mode === 'wrong-thread' ? { thread_id: randomUUID() } : {}),
      });
    };
    if (!hold) return finish();
    const held = { response, finish };
    heldTitle = held;
    response.on('close', () => {
      if (heldTitle === held) heldTitle = undefined;
    });
  }

  async function proxyState(request, response, path, body) {
    const mode = stateMode;
    const hold = holdNextState || mode === 'hold';
    holdNextState = false;
    if (mode === 'failure') {
      json(response, { error: 'PRIVATE state' }, 500);
      return;
    }
    const upstreamResponse = await send(request.method, path, request.headers, body);
    const raw = await readAll(upstreamResponse);
    const finish = () => {
      if (response.destroyed) return;
      if (upstreamResponse.statusCode !== 200) {
        response.writeHead(upstreamResponse.statusCode, forwardedHeaders(upstreamResponse.headers));
        response.end(raw);
        return;
      }
      const state = mapState(structuredClone(JSON.parse(raw.toString('utf8'))));
      state.values = decorateValues(state.values);
      const messages = state.values?.messages;
      if (mode === 'changed' && messages?.length) messages.at(-1).content = 'Changed canonical content';
      if (mode === 'foreign' && state.checkpoint) state.checkpoint.thread_id = randomUUID();
      if (mode === 'malformed') state.values = { ...state.values, messages: [{ type: 'human', content: { bad: true }, id: 'malformed' }] };
      if (mode === 'unsafe') state.tasks = [{ id: 'pending-task', name: 'generate', interrupts: [] }];
      if (mode === 'task-error') state.tasks = [{ id: 'failed-task', name: 'respond', error: 'Local failure', interrupts: [] }];
      if (mode === 'missing-terminal' && state.values) delete state.values.completed_turn_id;
      const values = state.values;
      if (mode === 'stale-terminal' && values)
        values.completed_turn_id = values.messages?.find((message) => message.type === 'human')?.id + '-stale';
      if (mode === 'foreign-terminal' && values) values.completed_answer_id = randomUUID();
      if (mode === 'old-message' && values?.messages?.length) values.messages[0].content = 'Changed prior content';
      if (mode === 'old-data' && values?.dashboard?.on_time) values.dashboard.on_time.value = '999%';
      if (mode === 'incomplete-tools' && values?.messages)
        values.messages = values.messages.filter((message) => message.name !== 'render_spec');
      if (mode === 'missing-dashboard' && values) delete values.dashboard;
      if (mode === 'disagreeing-dashboard' && values?.dashboard?.recent_disruptions) values.dashboard.recent_disruptions = [];
      if (mode === 'malformed-layout') {
        const owner = state.values?.messages?.find((message) => message.tool_calls?.some((call) => call.name === 'render_spec'));
        if (owner) owner.content = '{"elements":{},"root":"missing"}';
      }
      for (const op of stateEdits?.ops ?? []) applyStateOp(op, state.values, stateEdits.humanId);
      json(response, state);
    };
    if (!hold) return finish();
    const held = { response, finish };
    heldState = held;
    response.on('close', () => {
      if (heldState === held) heldState = undefined;
    });
  }

  async function upstreamJson(path) {
    const answer = await send('GET', path, { accept: 'application/json' }, Buffer.alloc(0));
    const raw = await readAll(answer);
    return answer.statusCode === 200 ? JSON.parse(raw.toString('utf8')) : null;
  }

  async function threadTitle(threadId) {
    return (await upstreamJson(`/threads/${threadId}`))?.metadata?.title ?? null;
  }

  async function proxyStream(request, response, path, body) {
    const hold = holdNextStream;
    holdNextStream = null;
    const cut = nextStreamCut;
    nextStreamCut = null;
    let cutDone = false;
    let fault = childFault;
    childFault = null;
    const values = nextValues;
    nextValues = null;
    const edits = (nextStreamEdits?.ops ?? []).map((edit) => ({ ...edit, pattern: new RegExp(edit.event), used: false }));
    const streamStateEdits = nextStreamEdits?.state ? { ops: edits.filter((op) => !['drop', 'insertAfter'].includes(op.op)) } : null;
    const anonymous = nextStreamEdits?.anonymous === true;
    nextStreamEdits = null;
    let humanId = null;
    try { humanId = JSON.parse(body.toString('utf8')).input?.messages?.at(-1)?.id ?? null; } catch { /* no input */ }
    if (streamStateEdits && streamStateEdits.ops.length) stateEdits = { ops: streamStateEdits.ops, humanId };
    const withHuman = (value) => JSON.parse(JSON.stringify(value).replaceAll('"$humanId"', JSON.stringify(humanId)));
    const edit = (raw) => {
      if (!edits.length) return raw;
      const name = /^event: *([^\r\n]*)/m.exec(raw)?.[1]?.trim() ?? '';
      const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith('data:'));
      const data = dataLine ? JSON.parse(dataLine.slice(5)) : null;
      const after = [];
      let changed = false;
      for (const op of edits) {
        if ((op.once && op.used) || !op.pattern.test(name)) continue;
        if (op.dataPattern && !new RegExp(op.dataPattern).test(dataLine ?? '')) continue;
        // A `checkpoints` event carries state under `values`; ops address the state.
        const state = name.startsWith('checkpoints') ? data?.values : data;
        if (op.ifKey && !(state && typeof state === 'object' && op.ifKey in state)) continue;
        if (op.unlessKey && state && typeof state === 'object' && op.unlessKey in state) continue;
        op.used = true;
        if (op.op === 'drop') return '';
        if (op.op === 'insertAfter') {
          const namespace = name.includes('|') ? name.slice(name.indexOf('|')) : '';
          after.push(`event: ${op.insert.event.replace('$ns', namespace)}\ndata: ${JSON.stringify(withHuman(op.insert.data))}\n\n`);
        } else if (applyStateOp(op, state, humanId)) changed = true;
      }
      return (changed ? raw.replace(dataLine, 'data: ' + JSON.stringify(data)) : raw) + after.join('');
    };
    const apply = (state) => {
      if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
      const out = { ...state, ...(values.set ?? {}) };
      for (const key of values.omit ?? []) delete out[key];
      return out;
    };
    const touched = (state) =>
      state && typeof state === 'object' &&
      [...Object.keys(values.set ?? {}), ...(values.omit ?? [])].some((key) => key in state);
    const inject = (raw) => {
      if (anonymous && /^event: *metadata\s*$/m.test(raw)) return '';
      raw = edit(raw);
      if (!raw) return raw;
      if (raw.indexOf('event:') !== raw.lastIndexOf('event:'))
        return raw.split(/(?<=\r?\n\r?\n)/).map((part) => inject2(part)).join('');
      return inject2(raw);
    };
    const inject2 = (raw) => {
      raw = decorateEvent(raw);
      if (!values) return raw;
      // Root graph only: `values`, node outputs in `updates`, and the values a
      // `checkpoints` event carries, so every view of the state agrees.
      const name = /^event: *([^\r\n]*)/m.exec(raw)?.[1]?.trim();
      if (!['values', 'updates', 'checkpoints'].includes(name)) return raw;
      const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith('data:'));
      let value = JSON.parse(dataLine.slice(5));
      if (name === 'values') value = apply(value);
      else if (name === 'checkpoints') value = { ...value, values: apply(value.values) };
      else
        value = Object.fromEntries(Object.entries(value).map(([node, output]) =>
          [node, touched(output) ? apply(output) : output]));
      return raw.replace(dataLine, 'data: ' + JSON.stringify(value));
    };
    const threadId = /\/threads\/([^/]+)\/runs\/stream/.exec(path)?.[1];
    const titleBefore = threadId ? await threadTitle(threadId) : null;
    const upstreamResponse = await send(request.method, path, request.headers, body);
    const headers = forwardedHeaders(upstreamResponse.headers);
    if (anonymous)
      for (const name of Object.keys(headers)) if (name.toLowerCase() === 'content-location') delete headers[name];
    response.writeHead(upstreamResponse.statusCode, headers);
    response.flushHeaders();
    response.on('close', () => upstreamResponse.destroy());
    // Forward whole SSE events; when a hold is armed, buffer after its condition.
    let pending = '';
    let text = '';
    let sse = '';
    let holding = false;
    let armed = Boolean(hold);
    let ended = false;
    const buffered = [];
    let persisted = false;
    const finish = () => {
      if (values?.persist && threadId && !persisted) {
        persisted = true;
        const update = Buffer.from(JSON.stringify({ values: values.persist }));
        void send('POST', `/threads/${threadId}/state`, { 'content-type': 'application/json' }, update)
          .then(readAll, () => undefined)
          .finally(finish);
        return;
      }
      if (!response.destroyed && !response.writableEnded) response.end();
      if (upstreamResponse.statusCode !== 200 || !threadId) return;
      // Saved state and title as the real server persisted them. /__captures
      // waits for captures in flight, so tests never race the stream end.
      const capture = (async () => {
        const state = await upstreamJson(`/threads/${threadId}/state`).catch(() => null);
        captures.push({
          path: request.url && new URL(request.url, 'http://localhost').pathname,
          sse,
          savedMessages: state?.values?.messages ?? [],
          values: state?.values ?? null,
          checkpoint: state?.checkpoint ?? null,
          next: state?.next ?? [],
          titleBefore,
          titleAfter: await threadTitle(threadId).catch(() => null),
        });
      })();
      pendingCaptures.add(capture);
      void capture.finally(() => pendingCaptures.delete(capture));
    };
    const held = {
      response,
      release() {
        if (heldStream === held) heldStream = undefined;
        holding = false;
        let rest = buffered.splice(0).join('');
        let match;
        while ((match = /\r?\n\r?\n/.exec(rest))) {
          const end = match.index + match[0].length;
          response.write(inject(rest.slice(0, end)));
          rest = rest.slice(end);
        }
        pending = rest + pending;
        if (ended) {
          if (pending) response.write(inject(pending));
          pending = '';
          finish();
        }
      },
    };
    upstreamResponse.setEncoding('utf8');
    upstreamResponse.on('data', (chunk) => {
      sse += chunk;
      if (cutDone) return;
      if (holding) return void buffered.push(chunk);
      pending += chunk;
      let match;
      while (!holding && (match = /\r?\n\r?\n/.exec(pending))) {
        const end = match.index + match[0].length;
        const raw = pending.slice(0, end);
        pending = pending.slice(end);
        const eventName = /^event: *(.*)$/m.exec(raw)?.[1]?.trim() ?? '';
        if (cut && new RegExp(cut.beforePattern).test(raw)) {
          cutDone = true;
          response.end(`event: error\ndata: ${JSON.stringify(cut.error)}\n\n`);
          pending = '';
          break;
        }
        if (fault && eventName.startsWith('values|')) {
          const namespace = eventName.slice('values'.length);
          const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith('data:'));
          const value = JSON.parse(dataLine.slice(5));
          const injected = fault === 'error'
            ? ['error' + namespace, { error: 'AuthoredChildError', message: 'PRIVATE_CHILD_DIAGNOSTIC' }]
            : ['values' + namespace, fault === 'role'
              ? { ...value, subagent_type: 'unsupported-specialist' }
              : { ...value, task_description: null }];
          response.write(`event: ${injected[0]}\ndata: ${JSON.stringify(injected[1])}\n\n`);
          fault = null;
        }
        if (armed && hold.beforeToolResult && /"type": ?"tool"/.test(raw)) {
          // Hold this event (the first carrying a tool result) and everything after.
          armed = false;
          holding = true;
          heldStream = held;
          pending = raw + pending;
          break;
        }
        response.write(inject(raw));
        if (armed && hold.afterPattern && new RegExp(hold.afterPattern).test(raw)) {
          armed = false;
          holding = true;
          heldStream = held;
          continue;
        }
        if (armed && hold.immediate) {
          armed = false;
          holding = true;
          heldStream = held;
          continue;
        }
        if (armed && hold.afterChildMessage && eventName.startsWith('messages|') && aiText(raw)) {
          armed = false;
          holding = true;
          heldStream = held;
          continue;
        }
        const delta = aiText(raw);
        if (delta === null) continue;
        text += delta;
        if (armed && !hold.beforeToolResult && !hold.afterChildMessage && !hold.immediate && !hold.afterPattern && (hold.afterText ? text.includes(hold.afterText) : true)) {
          armed = false;
          holding = true;
          heldStream = held;
        }
      }
      if (holding && pending) {
        buffered.push(pending);
        pending = '';
      }
      if (holding && hold.end && !response.writableEnded) {
        // An uncertain outcome: the browser's stream ends here, and the
        // upstream connection closes without a terminal event.
        if (heldStream === held) heldStream = undefined;
        response.end();
        upstreamResponse.destroy();
      }
    });
    upstreamResponse.on('end', () => {
      ended = true;
      if (holding) return;
      if (cutDone) return void finish();
      if (pending) response.write(inject(pending));
      finish();
    });
    response.on('close', () => {
      if (heldStream === held) heldStream = undefined;
    });
  }

  const controls = {
    '/__requests': ['GET', () => requests],
    '/__captures': ['GET', async () => {
      await Promise.all(pendingCaptures);
      return captures;
    }],
    '/__lifetime': ['GET', () => ({
      activeStream: Boolean(heldStream),
      activeHistory: Boolean(heldHistory),
      activeTitle: Boolean(heldTitle),
      activeState: Boolean(heldState),
      activeStateWrite: Boolean(heldStateWrite),
      openResponses,
    })],
    '/__reset': ['POST', () => { reset(); return {}; }],
    '/__fail-create': ['POST', () => { failCreate = true; return {}; }],
    '/__release': ['POST', () => {
      heldStream?.release();
      const write = heldStateWrite;
      heldStateWrite = undefined;
      write?.finish();
      return {};
    }],
    '/__release-history': ['POST', () => {
      const held = heldHistory;
      heldHistory = undefined;
      held?.finish();
      return {};
    }],
    '/__inject/reasoning': ['POST', (body) => { reasoning = String(body.text ?? ''); return {}; }],
    '/__hold/stream': ['POST', (body) => {
      holdNextStream = {
        afterText: body.afterText ?? null,
        beforeToolResult: body.beforeToolResult === true,
        afterChildMessage: body.afterChildMessage === true,
        immediate: body.immediate === true,
        afterPattern: typeof body.afterPattern === 'string' ? body.afterPattern : null,
        end: body.end === true,
      };
      return {};
    }],
    '/__fail-stream': ['POST', () => { failStream = true; return {}; }],
    '/__stream/cut': ['POST', (body) => {
      nextStreamCut = { beforePattern: String(body.beforePattern), error: body.error ?? {} };
      return {};
    }],
    '/__values': ['POST', (body) => { nextValues = body; return {}; }],
    '/__stream/edit': ['POST', (body) => {
      nextStreamEdits = { ops: body.ops ?? [], state: body.state === true, anonymous: body.anonymous === true };
      return {};
    }],
    '/__history-values': ['POST', (body) => { nextHistoryValues = body; return {}; }],
    '/__history-copies': ['POST', (body) => { nextHistoryCopies = body.copies ?? []; return {}; }],
    '/__hold/title': ['POST', () => { holdNextTitle = true; return {}; }],
    '/__hold/history': ['POST', () => { holdNextHistory = true; return {}; }],
    '/__hold/state': ['POST', () => { holdNextState = true; return {}; }],
    '/__mapped-checkpoints': ['POST', (body) => { mapped = { extra: body.extra ?? {} }; return {}; }],
    '/__hold/state-write': ['POST', () => { holdNextStateWrite = true; return {}; }],
    '/__fail/state-write': ['POST', () => { failNextStateWrite = true; return {}; }],
    '/__release-state': ['POST', () => {
      const held = heldState;
      heldState = undefined;
      held?.finish();
      return {};
    }],
    '/__release-title': ['POST', () => {
      const held = heldTitle;
      heldTitle = undefined;
      held?.finish();
      return {};
    }],
    '/__ready': [['GET', 'POST'], async () => {
      await ready();
      const answer = await send('GET', '/ok', { accept: 'application/json' }, Buffer.alloc(0));
      await readAll(answer);
      if (answer.statusCode !== 200) throw new Error('LangGraph is not ready');
      return {};
    }],
  };

  return async function handle(request, response, pathname) {
    if (pathname.startsWith('/__child/')) {
      const mode = pathname.slice('/__child/'.length);
      if (!['role', 'task', 'error'].includes(mode)) json(response, {}, 400);
      else {
        childFault = mode;
        json(response, {});
      }
      return true;
    }
    if (pathname.startsWith('/__thread/') && pathname.endsWith('/state') && request.method === 'POST') {
      const threadId = pathname.slice('/__thread/'.length, -'/state'.length);
      const update = await readAll(request);
      const answer = await send('POST', `/threads/${encodeURIComponent(threadId)}/state`, { 'content-type': 'application/json' }, update);
      json(response, JSON.parse((await readAll(answer)).toString('utf8') || '{}'), answer.statusCode);
      return true;
    }
    if (pathname.startsWith('/__thread/') && request.method === 'GET') {
      const threadId = pathname.slice('/__thread/'.length);
      json(response, await upstreamJson(`/threads/${encodeURIComponent(threadId)}/state`));
      return true;
    }
    if (pathname.startsWith('/__run-status/')) {
      const status = pathname.slice('/__run-status/'.length);
      runStatus = status === 'real' ? null : status;
      json(response, {});
      return true;
    }
    if (pathname.startsWith('/__interrupt/')) {
      const mode = pathname.slice('/__interrupt/'.length);
      if (!['unknown', 'multiple'].includes(mode)) json(response, {}, 400);
      else {
        interruptMode = mode;
        json(response, {});
      }
      return true;
    }
    if (pathname.startsWith('/__state/')) {
      const mode = pathname.slice('/__state/'.length);
      if (!STATE_MODES.includes(mode)) json(response, {}, 400);
      else {
        stateMode = mode;
        json(response, {});
      }
      return true;
    }
    if (pathname.startsWith('/__title/')) {
      const mode = pathname.slice('/__title/'.length);
      if (!TITLE_MODES.includes(mode)) json(response, {}, 400);
      else {
        titleMode = mode;
        json(response, {});
      }
      return true;
    }
    if (pathname.startsWith('/__history/')) {
      const mode = pathname.slice('/__history/'.length);
      if (!HISTORY_MODES.includes(mode)) json(response, {}, 400);
      else {
        historyMode = mode;
        json(response, {});
      }
      return true;
    }
    if (Object.hasOwn(controls, pathname)) {
      const [method, run] = controls[pathname];
      if (![method].flat().includes(request.method)) {
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
    const prefix = pathname.startsWith('/api/')
      ? '/api'
      : pathname.startsWith('/developer-api/')
        ? '/developer-api'
        : null;
    if (!prefix) return false;

    openResponses += 1;
    response.once('close', () => { openResponses -= 1; });
    await ready();
    let body = await readAll(request);
    const search = new URL(request.url, 'http://localhost').search;
    const path = pathname.slice(prefix.length) + search;
    requests.push({
      path: pathname,
      method: request.method,
      body: body.length ? JSON.parse(body.toString('utf8')) : {},
      key: request.headers['x-api-key'] ?? null,
    });
    if (mapped && body.length) {
      const parsed = JSON.parse(body.toString('utf8'));
      if (parsed?.checkpoint?.checkpoint_map) {
        delete parsed.checkpoint.checkpoint_map;
        body = Buffer.from(JSON.stringify(parsed));
      }
    }
    try {
      if (request.method === 'POST' && /^\/threads\/?$/.test(pathname.slice(prefix.length))) {
        if (failCreate) {
          failCreate = false;
          json(response, { error: 'PRIVATE creation' }, 500);
          return true;
        }
      }
      if (request.method === 'POST' && /\/threads\/[^/]+\/history$/.test(pathname))
        await proxyHistory(request, response, path, body);
      else if (request.method === 'POST' && /\/runs\/stream$/.test(pathname)) {
        if (failStream) {
          failStream = false;
          json(response, { error: 'PRIVATE graph worker failure' }, 500);
        } else await proxyStream(request, response, path, body);
      }
      else if (runStatus && request.method === 'GET' && /\/threads\/[^/]+\/runs\/[^/]+$/.test(pathname)) {
        const upstreamResponse = await send(request.method, path, request.headers, body);
        const raw = await readAll(upstreamResponse);
        const run = upstreamResponse.statusCode === 200 ? JSON.parse(raw.toString('utf8')) : null;
        if (!run) {
          response.writeHead(upstreamResponse.statusCode, forwardedHeaders(upstreamResponse.headers));
          response.end(raw);
        } else json(response, { ...run, status: runStatus });
      }
      else if (request.method === 'POST' && /\/threads\/[^/]+\/state$/.test(pathname)) {
        if (failNextStateWrite) {
          failNextStateWrite = false;
          json(response, { error: 'PRIVATE state write' }, 500);
        } else {
          const hold = holdNextStateWrite;
          holdNextStateWrite = false;
          const upstreamResponse = await send(request.method, path, request.headers, body);
          const raw = await readAll(upstreamResponse);
          const finish = () => {
            if (response.destroyed) return;
            response.writeHead(upstreamResponse.statusCode, forwardedHeaders(upstreamResponse.headers));
            response.end(raw);
          };
          if (!hold) finish();
          else {
            const held = { response, finish };
            heldStateWrite = held;
            response.on('close', () => {
              if (heldStateWrite === held) heldStateWrite = undefined;
            });
          }
        }
      }
      else if (request.method === 'POST' && /\/threads\/[^/]+\/state\/checkpoint$/.test(pathname))
        await proxyState(request, response, path, body);
      else if (request.method === 'GET' && /^\/threads\/[^/]+$/.test(pathname.slice(prefix.length)))
        await proxyTitle(request, response, path, body);
      else if (reasoning && request.method === 'GET' && /\/threads\/[^/]+\/state$/.test(pathname)) {
        const upstreamResponse = await send(request.method, path, request.headers, body);
        const raw = await readAll(upstreamResponse);
        if (upstreamResponse.statusCode !== 200) {
          response.writeHead(upstreamResponse.statusCode, forwardedHeaders(upstreamResponse.headers));
          response.end(raw);
        } else {
          const state = JSON.parse(raw.toString('utf8'));
          json(response, { ...state, values: decorateValues(state.values) });
        }
      } else {
        const upstreamResponse = await send(request.method, path, request.headers, body);
        response.writeHead(upstreamResponse.statusCode, forwardedHeaders(upstreamResponse.headers));
        upstreamResponse.pipe(response);
      }
    } catch {
      if (!response.headersSent) json(response, { error: 'LangGraph upstream unavailable' }, 502);
      else response.destroy();
    }
    return true;
  };
}
