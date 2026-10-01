# examples/ag-ui (LangGraph): subagent wire capture + emitter-seam decision

Evidence for migrating this demo's research subagent from the private
ACTIVITY convention (`ACTIVITY_SNAPSHOT`/`ACTIVITY_DELTA` with `activityType:
"subagent"`) to the protocol's standard `SUBAGENT_*` events plus
`subagentRunId`-attributed `TEXT_MESSAGE_*` / `TOOL_CALL_*` events. Captured
2026-09-02 against the live backend (`src/server.py`, `uv run uvicorn
src.server:app --port 8000`, real `OPENAI_API_KEY`, `gpt-5-mini` for the
orchestrator and the research child) with `ag-ui-langgraph 0.0.40` and
`ag-ui-protocol 0.1.22` (bumped in the same commit as this doc; the previous
transitive pin was 0.1.19).

This demo is the richer fork of `cockpit/ag-ui/subagents`: the child is a
compiled LangGraph subgraph running a reason → `lookup` tool → answer loop, so
the transcript has two assistant turns and one child tool call (the flat
cockpit variant has one turn and no tools). The cockpit capture lives at
`cockpit/ag-ui/subagents/python/docs/wire-capture-subagents.md`; this doc
records only what differs.

`ag-ui-protocol` 1.0.0 ships the `SUBAGENT_*` events and the `RUN_STARTED.protocolVersion` field. The `ag-ui-langgraph` 0.0.45 bridge opens the run without a version; `SubagentEmittingAgent` stamps `"1.0"` on its way out, so the capture below carries it.

Bridge citations are into the installed venv source:
`.venv/lib/python3.12/site-packages/ag_ui_langgraph/agent.py` and
`.venv/lib/python3.12/site-packages/ag_ui/core/events.py`.

## 1. SDK check

```
$ uv run python -c "from ag_ui.core import SubagentStartedEvent, TextMessageContentEvent, ToolCallStartEvent, ToolCallResultEvent; print(TextMessageContentEvent.model_fields['subagent_run_id']); print(list(ToolCallStartEvent.model_fields)); print(list(ToolCallResultEvent.model_fields))"
annotation=Union[str, NoneType] required=False default=None alias='subagentRunId' alias_priority=1
['metadata', 'type', 'timestamp', 'raw_event', 'tool_call_id', 'tool_call_name', 'parent_message_id', 'subagent_run_id']
['metadata', 'type', 'timestamp', 'raw_event', 'message_id', 'tool_call_id', 'content', 'role', 'subagent_run_id']
```

`ToolCallStartEvent` carries `parent_message_id` + `subagent_run_id`, and
`ToolCallResultEvent` carries `message_id`, `tool_call_id`, `content`, `role`,
`subagent_run_id` — the fields the contract's `tool_call` / `tool_result`
expansions need. `SubagentStartedEvent` exposes `parent_tool_call_id`.

## 2. Baseline (before the emitter)

`RunAgentInput` POSTed to `/agent` (`Accept: text/event-stream`):

```json
{"threadId":"capture-thread-2","runId":"capture-thread-2-run",
 "messages":[{"id":"u1","role":"user","content":"I want an in-depth research deep-dive on Angular signals: history, motivation, and how they compare to zone.js. Dispatch your research subagent (the research tool, subagent_type research) now; do not use search_documents."}],
 "tools":[],"context":[],"state":{},"forwardedProps":{}}
```

(The e2e's bare prompt *"Research Angular signals and summarize"* delegates
under aimock replay, but the live orchestrator answered it with
`search_documents` — the system prompt routes "simple lookups" there and
reserves `research` for "in-depth research". The longer prompt above
delegated on the first attempt.)

Scrubbed capture — line numbers are event indices (1-based) in the SSE
stream; `rawEvent` mirrors are dropped from every line and repetitive runs
are elided with `# [elided: ...]`. No keys or org ids appeared in the stream.

```
1     {"type":"RUN_STARTED","threadId":"capture-thread-2","runId":"capture-thread-2-run"}
3     {"type":"STEP_STARTED","stepName":"generate"}
9     {"type":"TOOL_CALL_START","toolCallId":"call_9n4N3xc350eeejpCUahSoH4v","toolCallName":"research","parentMessageId":"lc_run--01a063d9-03e5-7521-90c4-cc6e84ddf9fa"}
      # [elided: 29 TOOL_CALL_ARGS deltas spelling {"topic":"Angular signals: history, motivation, ...","subagent_type":"research"}]
69    {"type":"TOOL_CALL_END","toolCallId":"call_9n4N3xc350eeejpCUahSoH4v"}
77    {"type":"STEP_FINISHED","stepName":"generate"}
78    {"type":"STEP_STARTED","stepName":"tools"}
80    {"type":"RAW","event":{"event":"on_tool_start","name":"research"}}
82    {"type":"ACTIVITY_SNAPSHOT","messageId":"call_9n4N3xc350eeejpCUahSoH4v","activityType":"subagent","content":{"toolCallId":"call_9n4N3xc350eeejpCUahSoH4v","name":"research","status":"running","messages":[],"toolCalls":[]},"replace":true}
86    {"type":"STEP_FINISHED","stepName":"tools"}
87    {"type":"STEP_STARTED","stepName":"agent"}                      # the CHILD subgraph's node
90    {"type":"ACTIVITY_DELTA", ... "patch":[{"op":"add","path":"/messages/-","value":{"id":"call_9n4N3xc350eeejpCUahSoH4v-0","role":"assistant","content":"","toolCallIds":[]}}]}
93    {"type":"TOOL_CALL_START","toolCallId":"call_fgoFFeLMn9eA1V2voGF8pa2Q","toolCallName":"lookup","parentMessageId":"lc_run--01a063d9-0b11-7b50-95c5-ddf0404f2be9"}   # UNATTRIBUTED — the child's own call, streamed by the bridge as if it were the parent's
      # [elided: 12 TOOL_CALL_ARGS deltas for lookup]
120   {"type":"TOOL_CALL_END","toolCallId":"call_fgoFFeLMn9eA1V2voGF8pa2Q"}
124   {"type":"ACTIVITY_DELTA", ... "patch":[{"op":"add","path":"/toolCalls/-","value":{"id":"call_fgoFFeLMn9eA1V2voGF8pa2Q","name":"lookup","args":{"query":"Angular signals history m..."},"status":"running"}},{"op":"add","path":"/messages/0/toolCallIds/-","value":"call_fgoFFeLMn9eA1V2voGF8pa2Q"}]}
130   {"type":"STEP_FINISHED","stepName":"agent"}
131   {"type":"STEP_STARTED","stepName":"tools"}
134   {"type":"RAW","event":{"event":"on_tool_start","name":"lookup"}}
135   {"type":"RAW","event":{"event":"on_tool_end","name":"lookup"}}
137   {"type":"ACTIVITY_DELTA", ... "patch":[{"op":"replace","path":"/toolCalls/0/status","value":"complete"},{"op":"replace","path":"/toolCalls/0/result","value":"Angular signals are ..."}]}
141   {"type":"STEP_FINISHED","stepName":"tools"}
142   {"type":"STEP_STARTED","stepName":"agent"}
146   {"type":"ACTIVITY_DELTA", ... "patch":[{"op":"add","path":"/messages/-","value":{"id":"call_9n4N3xc350eeejpCUahSoH4v-1","role":"assistant","content":"","toolCallIds":[]}}]}
150   {"type":"TEXT_MESSAGE_START","messageId":"lc_run--01a063d9-195b-7dc2-9a29-2e20f8b34638","role":"assistant"}   # UNATTRIBUTED — the child's answer, streamed by the bridge into the PARENT transcript
153   {"type":"ACTIVITY_DELTA", ... "patch":[{"op":"replace","path":"/messages/1/content","value":"-"}]}
      # [elided: 343 more (TEXT_MESSAGE_CONTENT + RAW + RAW on_custom_event + ACTIVITY_DELTA) quads — each ACTIVITY_DELTA carries the FULL accumulated text ("- What", "- What signals", ...): 306,482 bytes of `value` across 344 deltas for a 1,810-char answer]
1525  {"type":"ACTIVITY_DELTA", ... "patch":[{"op":"replace","path":"/messages/1/content","value":"<all 1,810 chars>"}]}
1530  {"type":"TEXT_MESSAGE_END","messageId":"lc_run--01a063d9-195b-7dc2-9a29-2e20f8b34638"}
1537  {"type":"STEP_FINISHED","stepName":"agent"}
1538  {"type":"STEP_STARTED","stepName":"tools"}
1541  {"type":"ACTIVITY_DELTA", ... "patch":[{"op":"replace","path":"/status","value":"complete"}]}
1542  {"type":"RAW","event":{"event":"on_tool_end","name":"research"}}
1543  {"type":"TOOL_CALL_RESULT","messageId":"c5fafb3e-cf02-4ee5-b247-c841b97ec603","toolCallId":"call_9n4N3xc350eeejpCUahSoH4v","content":"- What signals are: a fine-grained reactivity primitive in Angular ..."}
1550  {"type":"STEP_FINISHED","stepName":"tools"}
1551  {"type":"STEP_STARTED","stepName":"generate"}
1557  {"type":"TEXT_MESSAGE_START","messageId":"lc_run--01a063d9-565b-7eb3-a7ac-837d933d2e97","role":"assistant"}
      # [elided: 68 TEXT_MESSAGE_CONTENT deltas — the ORCHESTRATOR's own answer]
1695  {"type":"TEXT_MESSAGE_END","messageId":"lc_run--01a063d9-565b-7eb3-a7ac-837d933d2e97"}
1704  {"type":"STEP_STARTED","stepName":"attach_citations"}
1711  {"type":"STEP_STARTED","stepName":"generate_title"}
1720  {"type":"MESSAGES_SNAPSHOT", ...}   # user, assistant(research call), tool(result), assistant(answer) — the child's lc_run message is NOT in it
1721  {"type":"RUN_FINISHED","threadId":"capture-thread-2","runId":"capture-thread-2-run"}
```

Event tally (1,721 events): 1 RUN_STARTED, 9 STEP_STARTED, 9 STEP_FINISHED,
2 TOOL_CALL_START, 41 TOOL_CALL_ARGS, 2 TOOL_CALL_END, 1 ACTIVITY_SNAPSHOT,
349 ACTIVITY_DELTA, 1 TOOL_CALL_RESULT, 2 TEXT_MESSAGE_START,
412 TEXT_MESSAGE_CONTENT, 2 TEXT_MESSAGE_END, 10 STATE_SNAPSHOT,
2 MESSAGES_SNAPSHOT, 1 RUN_FINISHED, 877 RAW. No CUSTOM (the
`ActivityEmittingAgent` swallowed all 350 `subagent_activity` CUSTOM events
and emitted an ACTIVITY event in each one's place), no SUBAGENT_*, zero
events carrying `subagentRunId`.

RAW breakdown: 469 `on_chat_model_stream`, 350 `on_custom_event`, 16
`on_chain_stream`, 15 `on_chain_start`, 15 `on_chain_end`, 4
`on_chat_model_start`, 4 `on_chat_model_end`, 2 `on_tool_start`, 2
`on_tool_end`.

### 2a. Ordering finding (design §6)

**`TOOL_CALL_START` for `research` precedes the first ACTIVITY event:** START
at 9, ARGS through 68, END at 69, `STEP_FINISHED(generate)` /
`STEP_STARTED(tools)` at 77/78, `on_tool_start` at 80, ACTIVITY_SNAPSHOT at
82. The tool call is fully announced before the tool body runs, and the
delegation window nests between `TOOL_CALL_END` (69) and `TOOL_CALL_RESULT`
(1543) — the same nesting the cockpit lane measured. The reducer's
`parentToolCallId` lookup therefore always finds an already-announced tool
call; the card never renders nameless.

### 2b. The bridge streams the child subgraph unattributed

Unlike the cockpit lane (whose child is a bare `llm.astream` inside the tool
body), this child is a compiled subgraph and `ag-ui-langgraph` streams
subgraphs by default (`forwarded_props.stream_subgraphs`, `agent.py:257`,
`:590-595`). The bridge therefore emits the child's nodes as `STEP_*`
(`agent` / `tools`, 87-141) AND the child's own content as bridge-native,
unattributed events: the `lookup` `TOOL_CALL_START/ARGS/END` (93-120) and the
answer's `TEXT_MESSAGE_START/CONTENT/END` (150-1530, 344 deltas) land in the
PARENT transcript while the run streams. The trailing `MESSAGES_SNAPSHOT`
(1720) omits the child's `lc_run--…` message, so the parent bubble reconciles
after the run — which is why the e2e's "child text must not leak into the
parent bubble" assertion (checked post-finalization) passes today. On the
wire, however, the child's answer is shipped twice: once verbatim as
unattributed `TEXT_MESSAGE_CONTENT` and once accumulated inside
`ACTIVITY_DELTA`.

### 2c. Wire volume

The `SubagentStreamHandler` accumulated `text_so_far` and shipped it in every
`message` event; the transform turned each into a JSON-patch `replace` of the
whole message. 344 deltas carried 306,482 bytes of `value` for a 1,810-char
answer — quadratic in the answer length. The per-token contract (each event
carries only the raw token) makes this linear.

### 2d. Why the 1:1 `_dispatch_event` seam cannot carry the migration

Identical to the cockpit finding: `ActivityEmittingAgent` overrode
`LangGraphAgent._dispatch_event`, which is called inline as `yield
self._dispatch_event(...)` at every yield site — strictly one in / one out.
The standard sequence needs 1:N expansion (`tool_call` → three `TOOL_CALL_*`
events; `finished` → `TEXT_MESSAGE_END` + `SUBAGENT_FINISHED`; the CUSTOM
event itself consumed → zero out), so the seam is `LangGraphAgent.run`, the
async generator the FastAPI endpoint consumes.

## After the emitter

Captured 2026-09-02 against the shipped scenario (`SubagentEmittingAgent`
mounted in `src/server.py`, per-token `subagent_activity` deltas from
`SubagentStreamHandler`, `message_id`-carrying phases from the research
subgraph), same `RunAgentInput` as §2 (thread `capture-thread-3`). No keys or
org ids appeared in the stream; only repetitive delta runs,
`STATE_SNAPSHOT`s and the bridge's RAW mirrors are elided, marked with
`# [elided: ...]`.

```
1     {"type":"RUN_STARTED","threadId":"capture-thread-3","runId":"capture-thread-3-run","protocolVersion":"1.0"}
3     {"type":"STEP_STARTED","stepName":"generate"}
9     {"type":"TOOL_CALL_START","toolCallId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc","toolCallName":"research","parentMessageId":"lc_run--01a063e0-aa28-7850-97bc-8118cdc8749b"}
      # [elided: 48 TOOL_CALL_ARGS deltas spelling {"topic":"...","subagent_type":"research"}]
107   {"type":"TOOL_CALL_END","toolCallId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc"}
115   {"type":"STEP_FINISHED","stepName":"generate"}
116   {"type":"STEP_STARTED","stepName":"tools"}
118   {"type":"RAW","event":{"event":"on_tool_start","name":"research"}}
120   {"type":"SUBAGENT_STARTED","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub","name":"research","parentToolCallId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc"}
124   {"type":"STEP_FINISHED","stepName":"tools"}
125   {"type":"STEP_STARTED","stepName":"agent"}                      # child subgraph node (passes through, as before)
128   {"type":"TEXT_MESSAGE_START","messageId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub-m1","role":"assistant","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub"}
      # [elided: the bridge-native, UNATTRIBUTED TOOL_CALL_START/ARGS/END for lookup that §2b showed here are GONE (at this capture, filtered by the wrapper — superseded, see "Declared opt-out" below); their RAW on_chat_model_stream mirrors remain]
148   {"type":"TEXT_MESSAGE_END","messageId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub-m1","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub"}
149   {"type":"TOOL_CALL_START","toolCallId":"call_9FAovVPV9iy8ZR4l2XI6w5sE","toolCallName":"lookup","parentMessageId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub-m1","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub"}
150   {"type":"TOOL_CALL_ARGS","toolCallId":"call_9FAovVPV9iy8ZR4l2XI6w5sE","delta":"{\"query\": \"Angular Signals introduced in Angular 16 release\"}","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub"}
151   {"type":"TOOL_CALL_END","toolCallId":"call_9FAovVPV9iy8ZR4l2XI6w5sE","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub"}
157   {"type":"STEP_FINISHED","stepName":"agent"}
158   {"type":"STEP_STARTED","stepName":"tools"}
161   {"type":"RAW","event":{"event":"on_tool_start","name":"lookup"}}
162   {"type":"RAW","event":{"event":"on_tool_end","name":"lookup"}}
164   {"type":"TOOL_CALL_RESULT","messageId":"call_9FAovVPV9iy8ZR4l2XI6w5sE-result","toolCallId":"call_9FAovVPV9iy8ZR4l2XI6w5sE","content":"Angular signals are a fine-grained reactivity primitive: ...","role":"tool","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub"}
168   {"type":"STEP_FINISHED","stepName":"tools"}
169   {"type":"STEP_STARTED","stepName":"agent"}
173   {"type":"TEXT_MESSAGE_START","messageId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub-m2","role":"assistant","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub"}
178   {"type":"TEXT_MESSAGE_CONTENT","messageId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub-m2","delta":"-","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub"}
181   {"type":"TEXT_MESSAGE_CONTENT","messageId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub-m2","delta":" History","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub"}
      # [elided: 532 more attributed TEXT_MESSAGE_CONTENT deltas — the CHILD's answer, one raw token each; the bridge-native unattributed TEXT_MESSAGE_START/CONTENT/END copy from §2b is GONE]
1788  {"type":"STEP_FINISHED","stepName":"agent"}
1789  {"type":"STEP_STARTED","stepName":"tools"}
1792  {"type":"TEXT_MESSAGE_END","messageId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub-m2","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub"}
1793  {"type":"SUBAGENT_FINISHED","subagentRunId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc-sub","outcome":{"type":"success"}}
1794  {"type":"RAW","event":{"event":"on_tool_end","name":"research"}}
1795  {"type":"TOOL_CALL_RESULT","messageId":"a55caffb-242c-4b28-8d50-767f457ee8da","toolCallId":"call_Ax1IOxHNk2UEIdCaKlDvCLtc","content":"- History & motivation: introduced as the opt-in fine-grained reactivity primitive in Angular 16 ..."}
1802  {"type":"STEP_FINISHED","stepName":"tools"}
1803  {"type":"STEP_STARTED","stepName":"generate"}
1809  {"type":"TEXT_MESSAGE_START","messageId":"lc_run--01a063e1-1c52-77b3-a6eb-f1a2541df8f0","role":"assistant"}
      # [elided: 83 TEXT_MESSAGE_CONTENT deltas — the ORCHESTRATOR's own answer, no subagentRunId]
1977  {"type":"TEXT_MESSAGE_END","messageId":"lc_run--01a063e1-1c52-77b3-a6eb-f1a2541df8f0"}
1986  {"type":"STEP_STARTED","stepName":"attach_citations"}
1993  {"type":"STEP_STARTED","stepName":"generate_title"}
2002  {"type":"MESSAGES_SNAPSHOT", ...}
2003  {"type":"RUN_FINISHED","threadId":"capture-thread-3","runId":"capture-thread-3-run"}
```

Event tally (2,003 events): 1 RUN_STARTED, 9 STEP_STARTED, 9 STEP_FINISHED,
1 TOOL_CALL_START, 48 TOOL_CALL_ARGS, 1 TOOL_CALL_END, 1 SUBAGENT_STARTED,
2 TEXT_MESSAGE_START(sub), 534 TEXT_MESSAGE_CONTENT(sub), 2
TEXT_MESSAGE_END(sub), 1 TOOL_CALL_START(sub), 1 TOOL_CALL_ARGS(sub),
1 TOOL_CALL_END(sub), 1 TOOL_CALL_RESULT(sub), 1 SUBAGENT_FINISHED,
1 TOOL_CALL_RESULT, 1 TEXT_MESSAGE_START, 83 TEXT_MESSAGE_CONTENT,
1 TEXT_MESSAGE_END, 10 STATE_SNAPSHOT, 2 MESSAGES_SNAPSHOT, 1 RUN_FINISHED,
1,291 RAW. No CUSTOM, no ACTIVITY_*, no SUBAGENT_ERROR.

**Child deltas: streaming, one raw token per event.** 534 attributed content
events carried 2,810 bytes of `delta` for a 2,810-char answer — linear, versus
§2c's 306,482 bytes for a 1,810-char answer. The joined child deltas equal the
parent's `TOOL_CALL_RESULT.content` byte-for-byte. Every child event carries
`subagentRunId` derived from the wire `toolCallId` (`<toolCallId>-sub`,
messages `<toolCallId>-sub-m1` / `-m2`), `SUBAGENT_STARTED.parentToolCallId`
matches the bridge-native `TOOL_CALL_START.toolCallId` verbatim, and the
child's `lookup` call is a fully attributed `TOOL_CALL_START` (with
`parentMessageId` = the tool-calling turn `-sub-m1`) → `ARGS` → `END` →
`TOOL_CALL_RESULT` (`role: tool`, `messageId: <lookup id>-result`). The
`subagent_activity` CUSTOM events were consumed (0 on the wire); their RAW
`on_custom_event` mirrors (540) still pass through because the bridge yields
them before `_handle_single_event`, and the client ignores RAW.

**The §2b duplicates are gone.** Exactly one `lookup` `TOOL_CALL_START` and
exactly two child `TEXT_MESSAGE_START`s are on the wire, all attributed; the
only unattributed `TEXT_MESSAGE_START` is the orchestrator's own answer
(1809). At this capture the wrapper achieved that by *inferring* the
duplicates — dropping every unattributed content event between
`SUBAGENT_STARTED` and `SUBAGENT_FINISHED`. That filter was replaced in review
by the bridge's declared opt-out (next section); the wire shape is the same,
the mechanism is not. `STEP_*` for the child nodes still pass through.

**Measured order, `TOOL_CALL_START` vs `SUBAGENT_STARTED`:** START 9 → ARGS →
END 107 → `on_tool_start` 118 → SUBAGENT_STARTED 120 → … → SUBAGENT_FINISHED
1793 → TOOL_CALL_RESULT 1795. The tool call is fully announced before the tool
body runs, so the reducer attaches the card to an already-known
`parentToolCallId`; the whole `SUBAGENT_*` block nests between
`TOOL_CALL_END` and `TOOL_CALL_RESULT`, as in the cockpit lane.

## Declared opt-out (review follow-up)

Review of the emitter asked why the wrapper *inferred* the child's duplicates
(any unattributed `TEXT_MESSAGE_*` / `TOOL_CALL_*` inside a delegation window)
when the bridge already honors a declared opt-out. It does:
`ag_ui_langgraph/agent.py:993-994` reads the LangChain run metadata keys
`emit-messages` and `emit-tool-calls` (default `True`) and skips emitting
`TEXT_MESSAGE_*` / `TOOL_CALL_*` for runs that carry them as `False` — while
callbacks (`SubagentStreamHandler`, `adispatch_custom_event`) still fire,
`STEP_*` still pass, and the parent's own `TOOL_CALL_RESULT` / answer are
untouched. Metadata set on the tool's `subgraph.ainvoke(..., config=...)`
inherits into every run of the child subgraph.

So the `research` tool now invokes the subgraph with
`config={"callbacks": [...], "metadata": {"emit-messages": False,
"emit-tool-calls": False}}` (`src/graph.py`), and `SubagentEmittingAgent` is
back to a pure 1:N expander: no window flag, no remembered ids, every
non-`subagent_activity` event passes through untouched
(`tests/test_subagent_emitting_agent.py`
`test_bridge_native_events_pass_through_untouched_even_inside_a_delegation`;
`tests/test_subagent_emission.py`
`test_research_tool_declares_the_child_silent_via_bridge_metadata` asserts the
metadata is on the invocation).

Re-captured 2026-09-02 with the opt-out and no wrapper-side filtering, same
`RunAgentInput` as §2 (thread `capture-optout-1788383126`, real
`OPENAI_API_KEY`, `gpt-5-mini`):

```
1     {"type":"RUN_STARTED", ...}
9     {"type":"TOOL_CALL_START","toolCallId":"call_zDfLSjalNBgmmB45oNQ7ERvm","toolCallName":"research", ...}
69    {"type":"TOOL_CALL_END","toolCallId":"call_zDfLSjalNBgmmB45oNQ7ERvm"}
78    {"type":"STEP_STARTED","stepName":"tools"}
80    {"type":"RAW","event":{"event":"on_tool_start","name":"research"}}
82    {"type":"SUBAGENT_STARTED","subagentRunId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub","name":"research","parentToolCallId":"call_zDfLSjalNBgmmB45oNQ7ERvm"}
87    {"type":"STEP_STARTED","stepName":"agent"}                      # child node — still on the wire
90    {"type":"TEXT_MESSAGE_START","messageId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub-m1","role":"assistant","subagentRunId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub"}
      # [no bridge-native TOOL_CALL_START for lookup here — the bridge skipped it (emit-tool-calls=False); its RAW on_chat_model_stream mirrors remain]
122   {"type":"TEXT_MESSAGE_END","messageId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub-m1","subagentRunId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub"}
123   {"type":"TOOL_CALL_START","toolCallId":"call_1E9G6oUvZ43IDK58Hc0TSnVC","toolCallName":"lookup","parentMessageId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub-m1","subagentRunId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub"}
124   {"type":"TOOL_CALL_ARGS", ... "subagentRunId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub"}
125   {"type":"TOOL_CALL_END","toolCallId":"call_1E9G6oUvZ43IDK58Hc0TSnVC","subagentRunId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub"}
132   {"type":"STEP_STARTED","stepName":"tools"}                      # child node
138   {"type":"TOOL_CALL_RESULT","messageId":"call_1E9G6oUvZ43IDK58Hc0TSnVC-result","toolCallId":"call_1E9G6oUvZ43IDK58Hc0TSnVC","role":"tool","subagentRunId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub", ...}
143   {"type":"STEP_STARTED","stepName":"agent"}
      # [259 attributed TEXT_MESSAGE_CONTENT deltas on -sub-m2 — the child's answer; no bridge-native TEXT_MESSAGE_START/CONTENT/END copy (emit-messages=False)]
941   {"type":"TEXT_MESSAGE_END","messageId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub-m2","subagentRunId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub"}
942   {"type":"SUBAGENT_FINISHED","subagentRunId":"call_zDfLSjalNBgmmB45oNQ7ERvm-sub","outcome":{"type":"success"}}
944   {"type":"TOOL_CALL_RESULT","toolCallId":"call_zDfLSjalNBgmmB45oNQ7ERvm","content":"- What they are: Angular Signals are a fine-grained reactivity primitive ..."}   # the PARENT's result, untouched
952   {"type":"STEP_STARTED","stepName":"generate"}
958   {"type":"TEXT_MESSAGE_START","messageId":"lc_run--01a063f1-275c-79f0-8b5d-f6175c48fc09","role":"assistant"}   # the ORCHESTRATOR's own answer — the only unattributed TEXT_MESSAGE_START
      # [elided: 49 TEXT_MESSAGE_CONTENT deltas, no subagentRunId]
1084  {"type":"RUN_FINISHED", ...}
```

Event tally (1,084 events): 1 RUN_STARTED, 9 STEP_STARTED, 9 STEP_FINISHED,
1 TOOL_CALL_START, 29 TOOL_CALL_ARGS, 1 TOOL_CALL_END, 1 SUBAGENT_STARTED,
2 TEXT_MESSAGE_START(sub), 259 TEXT_MESSAGE_CONTENT(sub),
2 TEXT_MESSAGE_END(sub), 1 TOOL_CALL_START(sub), 1 TOOL_CALL_ARGS(sub),
1 TOOL_CALL_END(sub), 1 TOOL_CALL_RESULT(sub), 1 SUBAGENT_FINISHED,
1 TOOL_CALL_RESULT, 1 TEXT_MESSAGE_START, 49 TEXT_MESSAGE_CONTENT,
1 TEXT_MESSAGE_END, 10 STATE_SNAPSHOT, 2 MESSAGES_SNAPSHOT, 1 RUN_FINISHED,
700 RAW (377 `on_chat_model_stream`, 265 `on_custom_event`, 16
`on_chain_stream`, 15/15 `on_chain_start`/`_end`, 4/4
`on_chat_model_start`/`_end`, 2/2 `on_tool_start`/`_end`). No CUSTOM, no
ACTIVITY_*, no SUBAGENT_ERROR.

- (a) **Zero** unattributed `TEXT_MESSAGE_*` / `TOOL_CALL_*` events between
  `SUBAGENT_STARTED` (82) and `SUBAGENT_FINISHED` (942), with nothing
  filtering them: the `lookup` call appears exactly once (123, attributed) and
  the child's answer only as the 259 attributed deltas on `-sub-m2`. The only
  unattributed `TEXT_MESSAGE_START` in the whole run is the orchestrator's
  (958). The joined child deltas (1,386 chars) equal the parent's
  `TOOL_CALL_RESULT.content` byte-for-byte.
- (b) The parent's `TOOL_CALL_RESULT` for the delegation (944) and its own
  answer (958 → 1 START / 49 CONTENT / 1 END) are present and unattributed.
- (c) `STEP_*` still passes: 9 `STEP_STARTED` / 9 `STEP_FINISHED`
  (`generate` ×2, `tools` ×3, `agent` ×2, `attach_citations`,
  `generate_title`) — the child's `agent` / `tools` nodes included.

The e2e suite (`examples/ag-ui/angular/e2e`, aimock replay) passed unchanged
after the swap.

## Browser verification

2026-09-02, live backend (real `OPENAI_API_KEY`, uvicorn on :8000) + `npx nx
serve examples-ag-ui-angular --port 4201`, driven headlessly with Playwright
(the §2 prompt typed into the composer). Screenshot, taken while the research
card was still `running` with the answer turn mid-stream:
`examples/ag-ui/angular/e2e/manual/subagent-card-live.png`.

What rendered: the `research` dispatch produced an inline
`<chat-subagent-card>` anchored to its tool call — header `research` + wire
`toolCallId` + `running` badge + "2 message(s)" — with the child's transcript
inside it: the tool-calling turn as the first `.sac__msg` (empty text), then
the answer turn streaming below it as a second `.sac__msg`. Once the child
finished, the card flipped to `complete` and collapsed, and the
orchestrator's own summary streamed in the parent bubble. The child text
never appeared in the parent bubble (`chat-streaming-md` of the final
assistant message does not contain the child's "History & motivation"
sentence), and no stray `lookup` tool-call card appeared in the parent
transcript.

The `lookup` call reached the projection — `agent.subagents()` reports
`toolCalls: [{name: "lookup", result: ...}]` (what the e2e asserts) — but the
card does not yet draw a `<chat-tool-call-card>` for it: the card looks tool
calls up through `message.toolCallIds`, and the reducer's attributed
`TOOL_CALL_START` route (`libs/ag-ui/src/lib/reducer.ts`
`routeSubagentContentEvent`) pushes onto the entry's `toolCalls` without
linking the id into the open message (the legacy ACTIVITY transform used to
patch `/messages/<n>/toolCallIds/-` explicitly). The wire carries
`parentMessageId` on the attributed `TOOL_CALL_START`, so this is a reducer
follow-up, not a demo defect.

Did the card stream mid-run: **yes**. Polling `agent.subagents()`, the
card's `innerText` and the `.sac__msg` count every 150ms:

- t≈2.5s — card mounts on `SUBAGENT_STARTED`: `running`, 1 message (the
  tool-calling turn, empty content), 0 tool calls, 1 `.sac__msg`.
- t≈18.9s — after gpt-5-mini's reasoning latency: `lookup` tool call present
  with its result (`hasResult: true`), 2 messages, 2 `.sac__msg`, answer
  turn at 46 chars.
- t≈18.9s → 22.5s — the answer turn grows monotonically while `running`:
  46 → 72 → 174 → 235 → 340 → 422 → 503 → 603 → 682 → 759 → 847 → 929 →
  1004 → … → 1862 chars across consecutive 150ms samples (card `innerText`
  103 → 1907 chars in step).
- t≈22.6s — `complete` at 1,878 chars; the card collapses (`innerText`
  1907 → 58 chars, 0 expanded `.sac__msg`).

This confirms the attributed `TEXT_MESSAGE_CONTENT` deltas render
progressively in the card's second message while the attributed `lookup`
`TOOL_CALL_*` / `TOOL_CALL_RESULT` events render as the first message's tool
call — not as one post-hoc paste, and not as a stray tool call or bubble in
the parent transcript.
