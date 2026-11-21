# Mastra sub-agents: installed-API findings and delegation wire capture

Task 0 spike evidence for the Mastra subagent PRs. Captured 2026-09-02 against
the live `deployments/ag-ui-mastra` service (`@mastra/core@1.63.2`,
`@ag-ui/mastra@1.1.2`) with a scratch `weather_forecaster` child agent
registered on the camping-trip supervisor. The scratch changes were reverted;
this document is the only artifact.

## Verdict summary

| Question | Answer |
| --- | --- |
| Sub-agents API present at installed `@mastra/core@1.63.2`? | **Yes** — no version bump needed. |
| Child registration | `agents: { weather_forecaster: childAgent }` on the supervisor's `Agent` config. |
| Delegation hooks | `delegation: { onDelegationStart, onDelegationComplete }` in stream options; works via the supervisor's `defaultOptions` (verified live — both hooks fired). |
| Delegation on the AG-UI wire today | An ordinary backend tool call named `agent-<childKey>`: `TOOL_CALL_START` → one `TOOL_CALL_ARGS` blob → `TOOL_CALL_END` → `TOOL_CALL_RESULT` whose `content` is JSON `{text, subAgentThreadId, subAgentResourceId, subAgentToolResults}`. |
| Does child text stream incrementally anywhere? | **In-process yes, on the wire no.** The parent `fullStream` carries every child chunk wrapped as `tool-output` (`payload: {output: <childChunk>, toolCallId, toolName}`) — 82 inner `text-delta` chunks in the raw tap — but `@ag-ui/mastra`'s chunk processor drops them (`case "tool-output": break`). Only the final text reaches AG-UI, inside `TOOL_CALL_RESULT`. — superseded, see [After streaming](#after-streaming) |
| Delegation tool-call id (for `parentToolCallId`) | The LLM's tool-call id (e.g. `call_aUfV9K0RCDZdZK3NWt9dRDKx`). Identical across `TOOL_CALL_START/ARGS/END/RESULT` and both hooks' `toolCallId`. |

## Installed-API details (`node_modules/@mastra/core/dist`)

- **Registration** — `agent/types.d.ts:656` (AgentConfig):
  `agents?: DynamicArgument<Record<string, SubAgent<string, TRequestContext>>>` —
  "Sub-Agents that the agent can access." A plain `Agent` instance satisfies
  `SubAgent` (`agent/subagent.d.ts:42`). Give the child a `description`; it
  becomes the delegation tool's description.
- **Tool naming** — compiled `agent-B8m3ps7U.js:34916/35498/35513`: each child
  becomes a tool `agent-${agentName}` where `agentName` is the key in the
  `agents` record. Its input schema is
  `{prompt, threadId, resourceId, instructions, maxSteps, suspendedToolRunId, resumeData}`.
- **Hook config site** — `agent/agent.types.d.ts` (~line 671 in
  `AgentExecutionOptionsBase`): `delegation?: DelegationConfig` is a
  **per-invocation stream/generate option**, not an `Agent` constructor field.
  Since the AG-UI bridge calls `agent.stream()` without it, set it via the
  supervisor's `defaultOptions: { delegation: {...} }` — verified live that
  the merged defaults fire both hooks. `DelegationConfig`
  (`agent.types.d.ts:294-344`) also offers `messageFilter`,
  `includeSubAgentToolResultsInModelContext`, `hookErrorStrategy`.
- **Hook signatures** (`agent.types.d.ts:61-207`):
  - `onDelegationStart(ctx: DelegationStartContext)` — `primitiveId`,
    `primitiveType: 'agent'|'workflow'`, `prompt`, `params{threadId, resourceId,
    instructions, maxSteps}`, `iteration`, `runId` (the PARENT run id),
    `threadId`, `resourceId`, `parentAgentId`, `parentAgentName`,
    **`toolCallId`** (the LLM tool-call id), `messages`, `requestContext`.
    May return `{proceed, rejectionReason, modifiedPrompt, modifiedInstructions,
    modifiedMaxSteps}`.
  - `onDelegationComplete(ctx: DelegationCompleteContext)` — same identity
    fields plus `result{text, subAgentThreadId, subAgentResourceId,
    finishReason, subAgentToolResults[], usage}`, `duration`, `success`,
    `error?`, `bail()`. May return `{feedback, resultText}`.
  - **Neither hook exposes a child run id.** The only child-run identifiers are
    `subAgentThreadId`/`subAgentResourceId` in the complete-hook result — a
    synthesized `subagentRunId` (`<toolCallId>-sub` or `<runId>-sub`) is
    required.
- **Parent stream chunks during delegation** (`stream/types.d.ts:313-319, 904`):
  every child chunk is forwarded to the parent stream as
  `{type: 'tool-output', payload: {output: <childChunk>, toolCallId, toolName}}`
  (compiled subagent tool execute, `agent-B8m3ps7U.js:35290-35300`:
  `for await (chunk of streamResult.fullStream) context.writer.write(chunk)`).
  The inner `start` chunk even carries the child agent id:
  `output.payload = {id: 'weather_forecaster', messageId: ...}`.
  The `agent-execution-*` / `routing-agent-*` chunk types belong to the
  deprecated AgentNetwork path and never appeared; do not use `.network()`.

## Raw parent-stream tap (direct `agent.stream()`, chunk types observed)

```
start, step-start,
tool-call-input-streaming-start/delta/end (name agent-weather_forecaster),
tool-call            toolName=agent-weather_forecaster toolCallId=call_…
tool-output x266     payload.output.type ∈ {start, step-start, text-start,
                     text-delta(x82), text-end, tool-call, tool-call-delta,
                     tool-call-input-streaming-*, tool-result, step-finish,
                     finish}   ← the ENTIRE child stream, incrementally
tool-result          toolName=agent-weather_forecaster (same toolCallId)
step-start, text-start, text-delta(x43), text-end, step-finish, finish
```

So incremental child text exists at the Mastra layer, keyed to the delegation
`toolCallId` — it is `@ag-ui/mastra` that discards it.

## Live AG-UI SSE capture (scrubbed, capture-2)

Request: `POST /agent/mastra` with
`{"threadId":"t-spike-2","runId":"r-spike-2","messages":[{"role":"user","content":"Plan a trip to Bear Lake this weekend — what will the weather be?"}], ...}`.
Delegated on the first attempt in both runs.

```
data: {"type":"RUN_STARTED","threadId":"t-spike-2","runId":"r-spike-2"}
data: {"type":"TOOL_CALL_START","parentMessageId":"4aca0872-…","toolCallId":"call_aUfV9K0RCDZdZK3NWt9dRDKx","toolCallName":"agent-weather_forecaster"}
data: {"type":"TOOL_CALL_ARGS","toolCallId":"call_aUfV9K0RCDZdZK3NWt9dRDKx","delta":"{\"prompt\":\"What will the weather be like at Bear Lake this weekend?\",\"threadId\":null,\"resourceId\":null,\"instructions\":null,\"maxSteps\":5,\"suspendedToolRunId\":null,\"resumeData\":null}"}
data: {"type":"TOOL_CALL_END","toolCallId":"call_aUfV9K0RCDZdZK3NWt9dRDKx"}
data: {"type":"TOOL_CALL_RESULT","toolCallId":"call_aUfV9K0RCDZdZK3NWt9dRDKx","content":"{\"text\":\"Here's the weather forecast for Bear Lake this weekend:\\n\\n- **Friday**: Mostly sunny…\",\"subAgentThreadId\":\"t-spike-2-f50a7c26-…\",\"subAgentResourceId\":\"t-spike-2-weather_forecaster\",\"subAgentToolResults\":[{\"toolName\":\"updateWorkingMemory\",\"toolCallId\":\"call_rSLW…\",\"result\":{\"success\":true},…}]}","messageId":"70b04476-…","role":"tool"}
data: {"type":"STATE_SNAPSHOT","snapshot":{}}
data: {"type":"STATE_DELTA","delta":[{"op":"add","path":"/packing_list","value":{}}]}   (x3 — child inherited working memory and wrote to it)
data: {"type":"TEXT_MESSAGE_CHUNK","role":"assistant","messageId":"4aca0872-…-agui-text","delta":"The"}   (x26 — the PARENT's own summary, streamed)
…
data: {"type":"STATE_SNAPSHOT","snapshot":{"packing_list":{"title":"","items":[]}}}
data: {"type":"RUN_FINISHED","threadId":"t-spike-2","runId":"r-spike-2","usage":[{…}]}
```

Event-type totals for the run: 1 RUN_STARTED, 1 each TOOL_CALL_START/ARGS/END/
RESULT, 2 STATE_SNAPSHOT, 3 STATE_DELTA, 26 TEXT_MESSAGE_CHUNK, 1 RUN_FINISHED.
Notes:

- `TOOL_CALL_ARGS` arrives as ONE blob, not deltas — the bridge buffers backend
  `tool-call` chunks and flushes start+args+end together. The child's `prompt`
  is therefore readable on the wire before the result.
- The child's final text is embedded in `TOOL_CALL_RESULT.content` (JSON
  string) — no child TEXT_MESSAGE events of any kind today.
- Working-memory injection: with no memory of its own the child inherits the
  supervisor's working-memory tooling (`injectSupervisorMemory`), so it called
  `updateWorkingMemory`; those nested calls appear only in
  `subAgentToolResults`, never as top-level TOOL_CALL_* events.

## Hook payloads (stderr, capture-1 run — same shape every run)

```
[HOOK onDelegationStart] {"primitiveId":"weather_forecaster","primitiveType":"agent",
  "prompt":"What will the weather be like at Bear Lake this weekend?",
  "params":{"threadId":"t-spike-1","resourceId":"t-spike-1","maxSteps":5},
  "iteration":1,"runId":"r-spike-1","threadId":"t-spike-1","resourceId":"t-spike-1",
  "parentAgentId":"mastra","parentAgentName":"mastra",
  "toolCallId":"call_cmS8mH1Up9o5MxKyMmTsYCPU","messages":"<1 messages>"}
[HOOK onDelegationComplete] {"primitiveId":"weather_forecaster","primitiveType":"agent",
  "result":{"text":"Here's the weather forecast…","finishReason":"stop",
    "subAgentThreadId":"t-spike-1-e80e0b3d-…","subAgentResourceId":"t-spike-1-weather_forecaster",
    "subAgentToolResults":[…],"usage":{"inputTokens":1066,"outputTokens":127,…}},
  "duration":4987,"success":true,"iteration":1,"runId":"r-spike-1",
  "toolCallId":"call_cmS8mH1Up9o5MxKyMmTsYCPU",…}
```

The `toolCallId` in both hooks equals the wire tool-call id exactly.

## Emitter wiring decision

Inject the SUBAGENT_* events in **`deployments/ag-ui-mastra/server.mjs`'s
translation loop** — the `sub.run(input).subscribe({ next })` handler
(server.mjs:111-126) — keyed off the AG-UI events themselves, NOT off the
delegation hooks:

1. On `TOOL_CALL_START` with `toolCallName.startsWith('agent-')`: emit
   `SUBAGENT_STARTED { subagentRunId: `${toolCallId}-sub`, name:
   toolCallName.slice('agent-'.length), parentToolCallId: toolCallId }`
   before forwarding the frame, and remember the toolCallId → name mapping.
2. On `TOOL_CALL_RESULT` for a remembered toolCallId: parse `content` JSON,
   emit an attributed `TEXT_MESSAGE_CHUNK` (single final chunk — that is all
   the wire has) carrying `result.text` under the subagent identity, then
   `SUBAGENT_FINISHED { subagentRunId, parentToolCallId }`, then forward (or
   suppress) the TOOL_CALL_RESULT per the target contract.

Rationale:

- The bridge gives the server only the AG-UI Observable; the Mastra chunk
  stream (where `tool-output` child deltas live) is consumed inside
  `@ag-ui/mastra` and dropped there. Recovering incremental child text would
  mean bypassing/forking the bridge (subscribe to `agent.stream()` ourselves
  and re-implement its ~800-line chunk processor) — not worth it for Task 0's
  single-final-chunk contract, but the data provably exists if a later PR
  wants real streaming.
- The delegation hooks (via `defaultOptions` in `agents.mjs`) fire in a
  different async context than the Observable events, with no ordering
  guarantee relative to `res.write` frames — unsafe as the primary emitter
  trigger. They remain available for metadata enrichment (prompt, duration,
  usage, `subAgentToolResults`) if SUBAGENT_FINISHED wants a payload beyond
  ids.
- Everything needed for the target contract is already deterministic on the
  wire: the `agent-` name prefix, the stable `toolCallId`, and the final text
  in `TOOL_CALL_RESULT.content.text`.

## Scratch setup used (reverted)

- Child: `new Agent({ id/name: 'weather_forecaster', description: 'Forecasts
  weather for a campsite and date range…', instructions: '…3-bullet forecast
  summary…', model: 'openai/gpt-4o-mini' })`.
- Supervisor additions: `agents: { weather_forecaster }`,
  `defaultOptions: { delegation: { onDelegationStart, onDelegationComplete } }`
  (hooks logging to stderr), and one instruction line changed to "For questions
  about weather forecasts you MUST delegate to the weather_forecaster agent"
  (the stock instructions force `check_conditions` for weather, which would
  have fought delegation).

## After the emitter

Live smoke against the committed emitter (`deployments/ag-ui-mastra/subagent-emitter.mjs`
wired into `server.mjs`'s translation loop), 2026-09-02. Request:
`POST /agent/mastra` with `{"threadId":"t-post-emitter-1","runId":"r-post-emitter-1",
"messages":[{"role":"user","content":"Plan a trip to Bear Lake this weekend — what
will the weather be?"}], ...}`. Delegated on the first attempt; the injected
sequence appeared exactly once, ids consistent throughout (scrubbed):

```
data: {"type":"RUN_STARTED","threadId":"t-post-emitter-1","runId":"r-post-emitter-1"}
data: {"type":"TOOL_CALL_START","parentMessageId":"28f84e1d-…","toolCallId":"call_1W2Rmq…","toolCallName":"agent-weather_forecaster"}
data: {"type":"SUBAGENT_STARTED","subagentRunId":"call_1W2Rmq…-sub","name":"weather_forecaster","parentToolCallId":"call_1W2Rmq…"}
data: {"type":"TOOL_CALL_ARGS","toolCallId":"call_1W2Rmq…","delta":"{\"prompt\":\"What will the weather be like at Bear Lake this weekend?\",…}"}
data: {"type":"TOOL_CALL_END","toolCallId":"call_1W2Rmq…"}
data: {"type":"TEXT_MESSAGE_START","messageId":"call_1W2Rmq…-sub-m1","role":"assistant","subagentRunId":"call_1W2Rmq…-sub"}
data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"call_1W2Rmq…-sub-m1","delta":"Here's the weather forecast for Bear Lake this weekend:\n\n- **Saturday**: Mostly sunny…","subagentRunId":"call_1W2Rmq…-sub"}
data: {"type":"TEXT_MESSAGE_END","messageId":"call_1W2Rmq…-sub-m1","subagentRunId":"call_1W2Rmq…-sub"}
data: {"type":"SUBAGENT_FINISHED","subagentRunId":"call_1W2Rmq…-sub","outcome":{"type":"success"}}
data: {"type":"TOOL_CALL_RESULT","toolCallId":"call_1W2Rmq…","content":"{\"text\":\"Here's the weather forecast…\",\"subAgentThreadId\":…}","messageId":"…","role":"tool"}
data: {"type":"STATE_SNAPSHOT","snapshot":{}}
data: {"type":"STATE_DELTA","delta":[…]}   (x3)
data: {"type":"TEXT_MESSAGE_CHUNK","role":"assistant","messageId":"28f84e1d-…-agui-text","delta":"…"}   (x31 — the parent's own summary)
data: {"type":"STATE_SNAPSHOT","snapshot":{"packing_list":…}}
data: {"type":"RUN_FINISHED","threadId":"t-post-emitter-1","runId":"r-post-emitter-1","usage":[…]}
```

Event-type totals: 1 each RUN_STARTED / TOOL_CALL_START / SUBAGENT_STARTED /
TOOL_CALL_ARGS / TOOL_CALL_END / TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT /
TEXT_MESSAGE_END / SUBAGENT_FINISHED / TOOL_CALL_RESULT / RUN_FINISHED,
2 STATE_SNAPSHOT, 3 STATE_DELTA, 31 TEXT_MESSAGE_CHUNK.

Notes:

- SUBAGENT_STARTED is injected immediately after TOOL_CALL_START, which on
  this bridge lands BEFORE the buffered TOOL_CALL_ARGS/END flush — the card
  therefore exists before the delegation prompt is readable.
- Child deltas: single final chunk — bridge drops tool-output upstream
  (`case "tool-output": break` in @ag-ui/mastra), so the one
  TEXT_MESSAGE_CONTENT carries the child's entire final text.

## Browser verification (pre-streaming, superseded below)

Live check 2026-09-02: real-key `deployments/ag-ui-mastra` on the topic port +
`npx nx serve cockpit-runtimes-mastra-angular`, driving "Plan a trip to Bear
Lake this weekend - what will the weather be?" in the real UI. The screenshot
referenced here was replaced by the post-streaming capture (see "Browser
verification (after streaming)").

- The card renders from the injected events with ZERO component code:
  `chat-tool-calls` groups on `parentToolCallId` and mounts
  `chat-subagent-card` — header `weather_forecaster` + the delegation
  toolCallId + a `complete` pill + "1 message(s)"; expanding shows the
  child's full 3-bullet forecast; the parent's own summary streams below.
- Honest timing note: the card does NOT visibly pass through a
  running/empty-body phase on this runtime. A timestamped SSE probe through
  the dev proxy shows the bridge withholds `TOOL_CALL_START` until the
  delegation resolves — RUN_STARTED at t=0, then a ~5s silent gap while the
  child runs, then TOOL_CALL_START → SUBAGENT_STARTED → … →
  SUBAGENT_FINISHED → TOOL_CALL_RESULT all inside ~40ms. STARTED→FINISHED
  are ~35ms apart on the wire, so the card mounts effectively already
  complete (a Playwright observer that awaited card attachment read
  `data-state="done"` on first sight). The emitter is not the limiter;
  @ag-ui/mastra's buffered tool-call flush is (same upstream drop/buffer
  behavior documented above).

## Streaming spike

Task 0 of the streaming PR (spec:
`docs/superpowers/specs/2026-09-02-mastra-subagent-streaming-design.md`).
Captured 2026-09-02 by calling the supervisor's `stream()` directly with the
delegation prompt and logging every `fullStream` chunk. Pins unchanged
(`@mastra/core@1.63.2`, `@ag-ui/mastra@1.1.2`).

### Bridge members touched (from `node_modules/@ag-ui/mastra/dist/mastra-*.mjs`)

- `'getMemory' in agent` (`isLocalMastraAgent`) — decides the local dispatch path.
- `agent.stream(messages, options)` → reads `.fullStream` (consumed by
  `processFullStream`), then `.traceId` and `.usage` for RUN_FINISHED.
- `agent.resumeStream(resume, options)` → the same `.fullStream` read.
- `agent.getMemory({requestContext})`, `agent.listTools(...)`, `agent.model`.
- `parentMessageId` on `TOOL_CALL_START` is the bridge's current message id,
  set by `onMessageId` from the last `start` / `step-start` chunk's
  `payload.messageId` (and re-randomized after `step-finish` / `finish`).
- The delegation `tool-call` chunk is buffered (`u = {toolCallId, toolName,
  args}`) and flushed as START+ARGS+END only by the next flushing chunk —
  for a delegation that is the `tool-result`, because every `tool-output`
  in between hits `case "tool-output": break`.

### Raw fullStream order (one delegation, 248 chunks)

```
 1  start              messageId=b45dfabd-…   ← parentMessageId source
 2  step-start         messageId=b45dfabd-…
 3-51  tool-call-input-streaming-start / tool-call-delta x48 / -end   (agent-weather_forecaster)
52  tool-call          toolCallId=call_s7dO… toolName=agent-weather_forecaster
                       args={prompt, threadId:null, resourceId:null, instructions:null, maxSteps:5, …}  ← complete
53  tool-output/start            output.payload={id:'weather_forecaster', messageId:467ded64-…}
54  tool-output/step-start
55-74 tool-output/tool-call-input-streaming-* + tool-call + tool-result   (inner updateWorkingMemory)
75  tool-output/step-finish
76  tool-output/step-start
77  tool-output/text-start       output.payload.id=msg_0dad…
78-185 tool-output/text-delta x108   output.payload.text="Here's", " the", " weather", …
186 tool-output/text-end
187 tool-output/step-finish
188 tool-output/finish
189 tool-result        toolCallId=call_s7dO… result keys={text, subAgentThreadId, subAgentResourceId, subAgentToolResults}
190 step-finish, 191 step-start, 192-207 parent updateWorkingMemory tool call,
208 step-finish, 209 step-start, 210 text-start, 211-245 text-delta x35, 246 text-end,
247 step-finish, 248 finish
```

Findings:

- Chunk order is `tool-call` (args complete) → `tool-output` x135 (the whole
  child stream, incrementally) → `tool-result`, exactly as the earlier tap.
- The child emits an explicit `text-start` before its deltas and `text-end`
  after them; the lazy-START path in the injector is defensive only.
- `parentMessageId` for the eager `TOOL_CALL_START` is the `messageId` of the
  last top-level `start` / `step-start` chunk (`b45dfabd-…` here), which is
  the same id the bridge would stamp when it flushes at `tool-result`.
- `tool-call-suspended` never appears in this capture (the delegation tool
  does not suspend; the demo child has no suspending tools). The injector
  still maps it defensively to `SUBAGENT_FINISHED {outcome:{type:'suspended'}}`.
- Inner sub-agent tool chunks (`updateWorkingMemory` — 16 `tool-call-delta`
  plus `tool-call` / `tool-result`) are present under `tool-output` and are
  ignored by this PR (out of scope).

### Card-mount check (`libs/angular/chat/src/lib/primitives/chat-tool-calls/chat-tool-calls.component.ts`)

`groups()` iterates the parent message's `toolCalls()` list and mounts
`chat-subagent-card` only when `subs.has(tc.id)` for an existing tool-call
entry (`Subagent.toolCallId` is the anchor). A `SUBAGENT_STARTED` with no
prior `TOOL_CALL_START` for its `parentToolCallId` therefore renders NO card:
synthesizing the eager `TOOL_CALL_START/ARGS/END` on the `tool-call` chunk
is required, not optional, for the card to appear before the child finishes.

## After streaming

Live smoke 2026-09-02 against the committed stream tee
(`deployments/ag-ui-mastra/streaming-tee.mjs`) + the chunk-aware injector
(`subagent-emitter.mjs`) wired in `server.mjs`. Pins unchanged
(`@ag-ui/mastra@1.1.2`, `@mastra/core@1.63.2`); the bridge itself is not
modified. Request: `POST /agent/mastra` with the same delegation prompt,
timestamped from the request start (scrubbed):

```
t=  169ms {"type":"RUN_STARTED","threadId":"t-live-…","runId":"r-live-…"}
t= 1578ms {"type":"TOOL_CALL_START","parentMessageId":"5764473e-…","toolCallId":"call_nXsj…","toolCallName":"agent-weather_forecaster"}   ← eager (synthesized on the tool-call chunk)
t= 1578ms {"type":"TOOL_CALL_ARGS","toolCallId":"call_nXsj…","delta":"{\"prompt\":\"What is the weather forecast for Bear Lake this w…"}
t= 1578ms {"type":"TOOL_CALL_END","toolCallId":"call_nXsj…"}
t= 1578ms {"type":"SUBAGENT_STARTED","subagentRunId":"call_nXsj…-sub","name":"weather_forecaster","parentToolCallId":"call_nXsj…"}
t= 6263ms {"type":"TEXT_MESSAGE_START","messageId":"call_nXsj…-sub-m1","role":"assistant","subagentRunId":"call_nXsj…-sub"}
t= 6266ms {"type":"TEXT_MESSAGE_CONTENT","messageId":"call_nXsj…-sub-m1","delta":"Here's","subagentRunId":"call_nXsj…-sub"}
t= 6306ms {"type":"TEXT_MESSAGE_CONTENT",…,"delta":" the",…}
t= 6314ms {"type":"TEXT_MESSAGE_CONTENT",…,"delta":" weather",…}
   … x94 attributed deltas, 399 chars, t=6266→7183ms …
t= 7183ms {"type":"TEXT_MESSAGE_END","messageId":"call_nXsj…-sub-m1","subagentRunId":"call_nXsj…-sub"}
t= 7382ms {"type":"SUBAGENT_FINISHED","subagentRunId":"call_nXsj…-sub","outcome":{"type":"success"}}
t= 7382ms {"type":"TOOL_CALL_RESULT","toolCallId":"call_nXsj…","content":"{\"text\":\"Here's the weather forecast for Bear Lake this weekend:…","messageId":"731b3738-…","role":"tool"}
t= 8138ms {"type":"STATE_SNAPSHOT","snapshot":{}}
          {"type":"TEXT_MESSAGE_CHUNK",…}   x68 — the parent's own summary
          {"type":"RUN_FINISHED",…}
```

Event-type totals: 1 each RUN_STARTED / TOOL_CALL_START / TOOL_CALL_ARGS /
TOOL_CALL_END / SUBAGENT_STARTED / TEXT_MESSAGE_START / TEXT_MESSAGE_END /
SUBAGENT_FINISHED / TOOL_CALL_RESULT / STATE_SNAPSHOT / RUN_FINISHED,
94 TEXT_MESSAGE_CONTENT (all carrying `subagentRunId`), 68 TEXT_MESSAGE_CHUNK.

Verified on the wire:

- Eager `TOOL_CALL_START` + `SUBAGENT_STARTED` land at t=1.6 s, ~4.7 s before
  the first attributed delta and ~5.8 s before `TOOL_CALL_RESULT` — the gap
  the pre-streaming capture spent silent.
- Exactly ONE `TOOL_CALL_START` for the delegation id: the bridge's buffered
  copy (flushed at `tool-result`) is dropped by the injector's dedupe.
- `SUBAGENT_FINISHED` precedes `TOOL_CALL_RESULT` (both written when the
  `tool-result` chunk is observed, before the bridge processes it).
- The ~4.7 s between STARTED and the first delta is the child's own inner
  `updateWorkingMemory` tool call plus model latency, not buffering: the raw
  tap shows the same inner call preceding the child's `text-start`.

Caveats and the fallback design:

- Suspended delegations: if a child ever emitted `tool-call-suspended`, the
  bridge would retract its buffered tool call (never emit START), but the
  eager START is already painted; the injector closes the card with
  `SUBAGENT_FINISHED {outcome:{type:'suspended'}}` and lets the bridge's
  CUSTOM on_interrupt + RUN_FINISHED interrupt outcome through. The demo's
  delegation does not suspend (no suspending tools on the child); this path
  is unit-tested only.
- Inner sub-agent tool calls stay out of scope (ignored under `tool-output`).
- Alternative considered: subclassing the bridge and overriding its chunk
  processor. Rejected because it couples to three TS-private methods, the
  bridge's `clone()` constructs the base class (dropping overrides), and the
  method signatures drift on upstream `main`. The Proxy tee touches only the
  public agent surface the bridge reads (`'getMemory' in agent`, `stream`,
  `resumeStream`, `getMemory`, `listTools`, `model`) and remains the fallback
  design should the public seam ever move.

## Browser verification (after streaming)

Live check 2026-09-02, same servers, driving the real UI with "Plan a trip to
Bear Lake this weekend - what will the weather be?". Screenshot of the
completed, expanded card: `e2e/manual/subagent-card-live.png`.

- The card mounts in the `running` state with "0 message(s)" at ~2.5–3.5 s
  after send — before any child text exists — because the eager
  `TOOL_CALL_START` gives `chat-tool-calls` the tool-call entry to anchor on.
- Headless 150 ms poll of the card's `innerText` length while
  `data-state="running"` (distinct samples): 67 → 110 → 188 → 261 → 279 →
  306 → 330 → 457 → 494 chars (t=3454 ms → 10827 ms), then `done` (the card
  collapses to its header, 68 chars) at t=10982 ms. Text visibly grows inside
  the running card; the earlier capture never left `running` visible at all.
- A second, interactive run through the dev browser pane showed the same
  shape at coarser (1 s, throttled) sampling: 67 → 131 → 474 chars while
  `running`, then `done`.
- The parent's own summary streams below the card afterwards, unchanged.
