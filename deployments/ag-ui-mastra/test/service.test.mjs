// Transcript-shape tests for the ag-ui-mastra service.
//
// Each surface's SSE event sequence is asserted against the MEASURED shapes
// from the 2026-08-31 Mastra spike captures (scratchpad spike-mastra
// transcripts 01/02/04a/05a/05c — inventoried in the comments below). The
// model is a scripted OpenAI responses-API mock (the endpoint Mastra's model
// router actually calls), so text differs from the live captures but the
// event grammar must match. The interrupt→resume round trip is additionally
// driven through the REAL @ag-ui/client 0.0.59 HttpAgent — the same client
// the Angular adapter uses — so every frame must parse and verify.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startScriptedService } from './scripted-service.mjs';

const TOKEN = 'test-internal-token';
let service;
let baseUrl;
before(async () => {
  service = await startScriptedService();
  baseUrl = service.baseUrl;
});
after(async () => { await service?.close(); });

async function runAgent(input, { token = TOKEN } = {}) {
  const res = await fetch(`${baseUrl}/agent/mastra`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': token },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  const events = text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)));
  return { status: res.status, events };
}

function baseInput(threadId, runId, content) {
  return {
    threadId,
    runId,
    state: {},
    messages: [{ id: `${runId}-u1`, role: 'user', content }],
    tools: [],
    context: [],
    forwardedProps: {},
  };
}

/** Compress consecutive duplicate event types: the spike inventory notation. */
function grammar(events) {
  const out = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.type === e.type) last.count++;
    else out.push({ type: e.type, count: 1 });
  }
  return out.map((o) => o.type);
}

// ── auth / health contract (mirrors ag-ui-dev server.py middleware) ────────
test('GET /ok is unauthenticated', async () => {
  const res = await fetch(`${baseUrl}/ok`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('agent route without the internal token → clean 401 JSON', async () => {
  const { status, events } = await runAgent(baseInput('t-auth', 'r-auth', 'Say hello.'), { token: 'wrong' });
  assert.equal(status, 401);
  assert.equal(events.length, 0);
});

test('unknown topic → 404 JSON', async () => {
  const res = await fetch(`${baseUrl}/agent/nope`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': TOKEN },
    body: '{}',
  });
  assert.equal(res.status, 404);
});

// ── surface grammars vs the measured spike shapes ──────────────────────────
test('chat: RUN_STARTED → TEXT_MESSAGE_CHUNK+ → RUN_FINISHED (spike 01-chat)', async () => {
  const { events } = await runAgent(baseInput('t-chat', 'r-chat-1', 'Say hello.'));
  assert.deepEqual(grammar(events), ['RUN_STARTED', 'TEXT_MESSAGE_CHUNK', 'RUN_FINISHED']);
  assert.equal(events.at(-1).outcome, undefined);
});

test('backend tool: TOOL_CALL_* → TOOL_CALL_RESULT → text (spike 02-backend-tool)', async () => {
  const { events } = await runAgent(baseInput('t-tool', 'r-tool-1', "What's the weather at Yosemite Valley?"));
  assert.deepEqual(grammar(events), [
    'RUN_STARTED',
    'TOOL_CALL_START',
    'TOOL_CALL_ARGS',
    'TOOL_CALL_END',
    'TOOL_CALL_RESULT',
    'TEXT_MESSAGE_CHUNK',
    'RUN_FINISHED',
  ]);
  const start = events.find((e) => e.type === 'TOOL_CALL_START');
  assert.equal(start.toolCallName, 'check_conditions');
  const result = events.find((e) => e.type === 'TOOL_CALL_RESULT');
  assert.ok(result.content.includes('Clear skies'));
});

test('state: STATE_SNAPSHOT + real STATE_DELTA patches (spike 04a-state)', async () => {
  const { events } = await runAgent(
    baseInput('t-state', 'r-state-1', "Start a packing list titled 'Yosemite Weekend' with a tent and two sleeping bags."),
  );
  const types = events.map((e) => e.type);
  assert.equal(types[0], 'RUN_STARTED');
  assert.equal(types.at(-1), 'RUN_FINISHED');
  const firstSnapshot = types.indexOf('STATE_SNAPSHOT');
  const firstDelta = types.indexOf('STATE_DELTA');
  assert.ok(firstSnapshot !== -1, 'expected a STATE_SNAPSHOT');
  assert.ok(firstDelta !== -1, 'expected at least one STATE_DELTA (Mastra emits real deltas)');
  assert.ok(firstSnapshot < firstDelta, 'snapshot precedes deltas');
  const deltaOps = events.filter((e) => e.type === 'STATE_DELTA').flatMap((e) => e.delta);
  assert.ok(deltaOps.every((op) => op.path.startsWith('/packing_list')), 'deltas patch /packing_list');
  const finalSnapshot = events.filter((e) => e.type === 'STATE_SNAPSHOT').at(-1);
  assert.equal(finalSnapshot.snapshot.packing_list?.title, 'Yosemite Weekend');
});

test('interrupt: CUSTOM on_interrupt + RUN_FINISHED outcome (spike 05a-interrupt)', async () => {
  const { events } = await runAgent(baseInput('t-hitl', 'r-hitl-1', 'Please reserve the North Pines campsite for 2 nights.'));
  assert.deepEqual(grammar(events), ['RUN_STARTED', 'CUSTOM', 'RUN_FINISHED']);

  const custom = events.find((e) => e.type === 'CUSTOM');
  assert.equal(custom.name, 'on_interrupt');
  const value = JSON.parse(custom.value);
  assert.equal(value.type, 'mastra_suspend');
  assert.equal(value.toolName, 'reserve_campsite');
  assert.equal(typeof value.toolCallId, 'string');
  assert.equal(value.runId, 'r-hitl-1');
  assert.equal(value.suspendPayload.site, 'North Pines');
  assert.equal(value.suspendPayload.total_usd, 90);

  const finished = events.at(-1);
  assert.equal(finished.outcome.type, 'interrupt');
  assert.equal(finished.outcome.interrupts[0].toolCallId, value.toolCallId);

  // Stash for the resume test below (node:test runs serially by default).
  globalThis.__pendingInterrupt = value;
});

test('resume: command.interruptEvent{toolCallId,runId} completes the run (spike 05c-resume-correct)', async () => {
  const pending = globalThis.__pendingInterrupt;
  assert.ok(pending, 'interrupt test must run first');
  const input = {
    ...baseInput('t-hitl', 'r-hitl-2', 'Please reserve the North Pines campsite for 2 nights.'),
    forwardedProps: {
      command: {
        resume: { approved: true },
        interruptEvent: { toolCallId: pending.toolCallId, runId: pending.runId },
      },
    },
  };
  const { events } = await runAgent(input);
  assert.deepEqual(grammar(events), ['RUN_STARTED', 'TOOL_CALL_RESULT', 'TEXT_MESSAGE_CHUNK', 'RUN_FINISHED']);
  const result = events.find((e) => e.type === 'TOOL_CALL_RESULT');
  assert.equal(result.toolCallId, pending.toolCallId);
  assert.ok(result.content.includes('North Pines'));
  assert.equal(events.at(-1).outcome, undefined);
});

// ── the REAL client: every frame must parse + verify on @ag-ui/client 0.0.59 ─
test('interrupt → resume round trip through @ag-ui/client HttpAgent', async () => {
  const { HttpAgent } = await import('@ag-ui/client');
  const agent = new HttpAgent({
    url: `${baseUrl}/agent/mastra`,
    headers: { 'x-internal-token': TOKEN },
    threadId: 't-client-hitl',
  });
  agent.messages = [{ id: 'cu1', role: 'user', content: 'Please reserve the North Pines campsite for 2 nights.' }];

  let interruptValue = null;
  const seen = [];
  agent.subscribe({
    onEvent({ event }) {
      seen.push(event.type);
      if (event.type === 'CUSTOM' && event.name === 'on_interrupt') {
        interruptValue = JSON.parse(event.value);
      }
    },
  });

  await agent.runAgent({});
  assert.ok(interruptValue, 'client observed the on_interrupt signal');
  assert.deepEqual(seen, ['RUN_STARTED', 'CUSTOM', 'RUN_FINISHED']);

  seen.length = 0;
  // @ag-ui/client 0.0.59 records the RUN_FINISHED interrupt outcome on
  // `pendingInterrupts` and refuses runAgent() unless a top-level `resume`
  // addresses it. Mastra's measured wire shape carries the resume in
  // forwardedProps instead, so the Threadplane adapter clears the ledger
  // before a forwardedProps resume (libs/ag-ui/src/lib/to-agent.ts). Mirror
  // that here — this test drives the raw client the way the adapter does.
  agent.pendingInterrupts = [];
  await agent.runAgent({
    forwardedProps: {
      command: {
        resume: { approved: true },
        interruptEvent: { toolCallId: interruptValue.toolCallId, runId: interruptValue.runId },
      },
    },
  });
  assert.ok(seen.includes('TOOL_CALL_RESULT'), `resume stream: ${seen.join(' ')}`);
  const last = agent.messages.at(-1);
  assert.equal(last.role, 'assistant');
  assert.ok(String(last.content).includes('North Pines'));
});

// ── failure mapping ────────────────────────────────────────────────────────
test('model failure surfaces as RUN_ERROR frame, not a dropped socket', async () => {
  // No script entry matches this text → the mock returns HTTP 500 → the
  // bridge Observable errors → the service must emit RUN_ERROR.
  const { status, events } = await runAgent(baseInput('t-err', 'r-err-1', 'zzz-unmatched-zzz'));
  assert.equal(status, 200);
  const types = events.map((e) => e.type);
  assert.ok(types.includes('RUN_ERROR'), `got: ${types.join(' ')}`);
});
