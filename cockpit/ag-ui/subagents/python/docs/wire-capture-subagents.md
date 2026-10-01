# AG-UI subagents (LangGraph): wire capture + emitter-seam decision

Evidence for migrating this demo from the private ACTIVITY convention
(`ACTIVITY_SNAPSHOT`/`ACTIVITY_DELTA` with `activityType: "subagent"`) to the
protocol's standard `SUBAGENT_*` events plus `subagentRunId`-attributed
`TEXT_MESSAGE_*` events. Captured 2026-09-02 against the live backend
(`src/server.py`, `uv run uvicorn src.server:app --port 5326`, real
`OPENAI_API_KEY`, `gpt-5-mini` for orchestrator and subagents) with
`ag-ui-langgraph 0.0.37` and `ag-ui-protocol 0.1.22` (bumped in the same
commit as this doc; the previous transitive pin was 0.1.19).

All bridge citations are into the installed venv source:
`.venv/lib/python3.14/site-packages/ag_ui_langgraph/agent.py` and
`.venv/lib/python3.14/site-packages/ag_ui/core/events.py`.

## 1. SDK check

```
$ uv run python -c "from ag_ui.core import SubagentStartedEvent, TextMessageContentEvent; print(TextMessageContentEvent.model_fields['subagent_run_id'])"
annotation=Union[str, NoneType] required=False default=None alias='subagentRunId' alias_priority=1
```

`ag-ui-protocol` 1.0.0 ships the `SUBAGENT_*` events and the `RUN_STARTED.protocolVersion` field. The `ag-ui-langgraph` 0.0.45 bridge opens the run without a version; `SubagentEmittingAgent` stamps `"1.0"` on its way out, so the capture below carries it. The protocol defines `SubagentStartedEvent` (`subagent_run_id`,
`name`, `description`, `parent_subagent_run_id`, `parent_tool_call_id`,
`parent_message_id`), `SubagentFinishedEvent` (`subagent_run_id`, `result`,
`outcome` = `SubagentFinishedSuccessOutcome | SubagentFinishedSuspendedOutcome`)
and `SubagentErrorEvent` (`subagent_run_id`, `message`, `code`)
(`events.py:455-512`), and every `TextMessage*` / `ToolCall*` / `Custom` event
carries an optional `subagent_run_id` (`events.py:127-314`). The endpoint
serializes with `EventEncoder` → `model_dump_json(by_alias=True)`, so the
snake_case fields reach the wire camelCased (confirmed in §3).

## 2. Baseline (before the emitter)

`RunAgentInput` POSTed to `/agent` (`Accept: text/event-stream`):

```json
{"threadId":"capture-thread-2","runId":"capture-run-2",
 "messages":[{"id":"u1","role":"user","content":"Plan a trip from LAX to JFK. One adult, economy, round trip, departing next Tuesday morning and returning Friday evening. Delegate to your subagents now; no clarifying questions."}],
 "tools":[],"context":[],"state":{},"forwardedProps":{}}
```

(The e2e's bare prompt *"Plan a trip from LAX to JFK"* is enough under aimock
replay, but the live orchestrator answered it with five clarifying questions
and never called `task` — the system prompt tells it to ask when dates are
missing. The longer prompt above delegated on the first attempt: research →
booking → itinerary, exactly the prompt's prescribed order.)

Scrubbed capture — line numbers are event indices (1-based) in the SSE
stream; `rawEvent` mirrors are dropped from every line and repetitive runs
are elided with `# [elided: ...]`. No keys or org ids appeared in the stream.

The `protocolVersion` field was added to this capture by hand when the runtimes moved to 1.0; re-run the capture command to refresh the frame.

```
1    {"type":"RUN_STARTED","threadId":"capture-thread-2","runId":"capture-run-2","protocolVersion":"1.0"}
3    {"type":"STEP_STARTED","stepName":"orchestrator"}
7    {"type":"TOOL_CALL_START","toolCallId":"call_KUdUz8CR6t3X2NEb1ucXbntO","toolCallName":"task","parentMessageId":"lc_run--01a06367-6022-77a3-938b-65acb68640d4"}
9    {"type":"TOOL_CALL_ARGS","toolCallId":"call_KUdUz8CR6t3X2NEb1ucXbntO","delta":"{\""}
     # [elided: 195 more TOOL_CALL_ARGS deltas spelling {"role":"research","task_description":"Gather current intel for a trip from LAX ... to JFK ..."}, each followed by its RAW on_chat_model_stream mirror]
400  {"type":"TOOL_CALL_END","toolCallId":"call_KUdUz8CR6t3X2NEb1ucXbntO"}
406  {"type":"STATE_SNAPSHOT", ...}
409  {"type":"STEP_FINISHED","stepName":"orchestrator"}
410  {"type":"STEP_STARTED","stepName":"tools"}
411  {"type":"RAW","event":{"event":"on_chain_start","name":"tools"}}
412  {"type":"RAW","event":{"event":"on_tool_start","name":"task"}}
413  {"type":"RAW","event":{"event":"on_custom_event","name":"subagent_activity"}}   # phase=started
414  {"type":"ACTIVITY_SNAPSHOT","messageId":"call_KUdUz8CR6t3X2NEb1ucXbntO","activityType":"subagent","content":{"toolCallId":"call_KUdUz8CR6t3X2NEb1ucXbntO","name":"research","status":"running","text":""},"replace":true}
415  {"type":"RAW","event":{"event":"on_custom_event","name":"subagent_activity"}}   # phase=message
416  {"type":"ACTIVITY_DELTA","messageId":"call_KUdUz8CR6t3X2NEb1ucXbntO","activityType":"subagent","patch":[{"op":"replace","path":"/text","value":"L"}]}
     # [elided: 470 more RAW+ACTIVITY_DELTA pairs, each DELTA carrying the FULL accumulated text ("LAX", "LAX (", ... ) — quadratic bytes on the wire]
1357 {"type":"RAW","event":{"event":"on_custom_event","name":"subagent_activity"}}   # phase=finished
1358 {"type":"ACTIVITY_DELTA","messageId":"call_KUdUz8CR6t3X2NEb1ucXbntO","activityType":"subagent","patch":[{"op":"replace","path":"/status","value":"complete"}]}
1359 {"type":"RAW","event":{"event":"on_tool_end","name":"task"}}
1360 {"type":"TOOL_CALL_RESULT","messageId":"d2c0584d-0046-49aa-8fe6-0859492dc35f","toolCallId":"call_KUdUz8CR6t3X2NEb1ucXbntO","content":"LAX/JFK basics: At LAX the major domestic carriers typically operate from these terminals ..."}
1362 {"type":"STATE_SNAPSHOT", ...}
1365 {"type":"STEP_FINISHED","stepName":"tools"}
1366 {"type":"STEP_STARTED","stepName":"orchestrator"}
1370 {"type":"TOOL_CALL_START","toolCallId":"call_Oh1rxCKsmmkoFHf9E5wQGEWx","toolCallName":"task", ...}
     # [elided: booking round — shape-identical: ARGS×167 → TOOL_CALL_END (1707) → STEP_FINISHED/STARTED → ACTIVITY_SNAPSHOT name=booking (1721) → 1104 ACTIVITY_DELTA → status=complete (3931) → TOOL_CALL_RESULT (3933)]
3943 {"type":"TOOL_CALL_START","toolCallId":"call_4WqxTvu8atX6yZzxXsmiSTSz","toolCallName":"task", ...}
     # [elided: itinerary round — ARGS×145 → TOOL_CALL_END (4236) → ACTIVITY_SNAPSHOT name=itinerary (4250) → 499 ACTIVITY_DELTA → status=complete (5250) → TOOL_CALL_RESULT (5252)]
5263 {"type":"TEXT_MESSAGE_START","messageId":"lc_run--01a06369-b8aa-7601-84c2-b7a96b9399cb","role":"assistant"}
     # [elided: 144 TEXT_MESSAGE_CONTENT deltas — the ORCHESTRATOR's own final summary]
5555 {"type":"TEXT_MESSAGE_END","messageId":"lc_run--01a06369-b8aa-7601-84c2-b7a96b9399cb"}
5563 {"type":"STEP_STARTED","stepName":"generate_title"}
5570 {"type":"STEP_FINISHED","stepName":"generate_title"}
5572 {"type":"MESSAGES_SNAPSHOT", ...}
5573 {"type":"RUN_FINISHED","threadId":"capture-thread-2","runId":"01a06367-6020-7a61-bdc8-ffcea4df5a2b"}
```

Event tally (5,573 events): 1 RUN_STARTED, 8 STEP_STARTED, 8 STEP_FINISHED,
3 TOOL_CALL_START, 507 TOOL_CALL_ARGS, 3 TOOL_CALL_END, 3 ACTIVITY_SNAPSHOT,
2,077 ACTIVITY_DELTA, 3 TOOL_CALL_RESULT, 1 TEXT_MESSAGE_START,
144 TEXT_MESSAGE_CONTENT, 1 TEXT_MESSAGE_END, 9 STATE_SNAPSHOT,
1 MESSAGES_SNAPSHOT, 1 RUN_FINISHED, 2,803 RAW. No CUSTOM (the
`ActivityEmittingAgent` swallowed all 2,080 `subagent_activity` CUSTOM events
and emitted an ACTIVITY event in each one's place), no SUBAGENT_*.

RAW breakdown: 2,080 `on_custom_event` (one mirror per `subagent_activity`
dispatch — the bridge yields `RawEvent(event=...)` for EVERY astream_events
item at `agent.py:404-406` before `_handle_single_event` translates it),
667 `on_chat_model_stream`, 16 `on_chain_stream`, 13 `on_chain_start`,
13 `on_chain_end`, 4 `on_chat_model_start`, 4 `on_chat_model_end`,
3 `on_tool_start`, 3 `on_tool_end`.

### 2a. Ordering finding (design §6)

**`TOOL_CALL_START` for `task` precedes the first ACTIVITY event by a wide
margin in every delegation round:** START at 7 / 1370 / 3943, the matching
ACTIVITY_SNAPSHOT at 414 / 1721 / 4250. Between them the bridge streams every
`TOOL_CALL_ARGS` delta, `TOOL_CALL_END`, a `STATE_SNAPSHOT`, and the
`STEP_FINISHED(orchestrator)` / `STEP_STARTED(tools)` pair — the tool body
only runs once LangGraph enters the `tools` node, and `on_tool_start` (412) is
the immediately preceding RAW mirror. `TOOL_CALL_END` therefore arrives BEFORE
the subagent runs (it marks the end of the args stream, not tool execution),
and the delegation window nests between `TOOL_CALL_END` and
`TOOL_CALL_RESULT` — same nesting as the Strands lane, opposite of the MAF
lane where END lands after the tool returns. The reducer's `parentToolCallId`
lookup will always find an already-announced tool call, so the card never
renders nameless.

### 2b. Why the 1:1 `_dispatch_event` seam cannot carry the migration

`ActivityEmittingAgent` overrode `LangGraphAgent._dispatch_event`
(`agent.py:159-165`), which is strictly one-event-in / one-event-out: it is
called inline as `yield self._dispatch_event(...)` at every yield site. The
standard sequence needs 1:N expansion — a `message_start` phase must open a
`TEXT_MESSAGE_START`, a `finished` phase must close the open message
(`TEXT_MESSAGE_END`) AND emit `SUBAGENT_FINISHED`, and the CUSTOM event itself
must be consumed (0 out). `LangGraphAgent.run(self, input: RunAgentInput) ->
AsyncGenerator[ProcessedEvents, None]` (`agent.py:167-178`) is the method
the FastAPI endpoint consumes (`endpoint.py:26`, `async for event in
request_agent.run(input_data)`), so wrapping `run` is the seam: iterate
`super().run(input)` and expand each event. No queue merge is needed — unlike
MAF, the graph's CUSTOM events already flow through this generator live
(they are `astream_events` items), so a straight `for out in expand(ev):
yield out` keeps the interleaving.

## 3. Serializer probe

From an UNCOMMITTED scratch `_dispatch_event` override that replaced the
`started` ACTIVITY_SNAPSHOT with a `SubagentStartedEvent(subagent_run_id=
f"{tid}-sub", name=..., parent_tool_call_id=tid)`, same prompt (the run
delegated three times again):

```
260  {"type":"SUBAGENT_STARTED","subagentRunId":"call_Tiif951yDSxR3bBrG1Tkuwnj-sub","name":"research","parentToolCallId":"call_Tiif951yDSxR3bBrG1Tkuwnj"}
     # (TOOL_CALL_START for call_Tiif951yDSxR3bBrG1Tkuwnj at 7, TOOL_CALL_END at 246, STEP_STARTED(tools) at 256)
2617 {"type":"SUBAGENT_STARTED","subagentRunId":"call_KZQWQKoEDNcn3LpcTwjtmU4F-sub","name":"booking","parentToolCallId":"call_KZQWQKoEDNcn3LpcTwjtmU4F"}
5407 {"type":"SUBAGENT_STARTED","subagentRunId":"call_UJ5vqgEMAq6715iAuvCtLlUZ-sub","name":"itinerary","parentToolCallId":"call_UJ5vqgEMAq6715iAuvCtLlUZ"}
```

The stock `EventEncoder` camelCases the pydantic fields (`subagentRunId`,
`parentToolCallId`) with no extra configuration, and the ordering from §2a
held (START 7 → END 246 → SUBAGENT_STARTED 260). The scratch edit was reverted;
only this doc and the SDK bump land from Task 0.

## After the emitter

Captured 2026-09-02 against the shipped scenario (`SubagentEmittingAgent`
mounted in `src/server.py`, per-token `subagent_activity` deltas from
`SubagentStreamHandler`), same `RunAgentInput` as §2. No keys or org ids
appeared in the stream; only repetitive delta runs, `STATE_SNAPSHOT`s and the
bridge's RAW mirrors are elided, marked with `# [elided: ...]`. The model
delegated three times again (research → booking → itinerary); the first round
is shown, the other two are shape-identical.

```
1    {"type":"RUN_STARTED","threadId":"capture-thread-2","runId":"capture-run-2","protocolVersion":"1.0"}
3    {"type":"STEP_STARTED","stepName":"orchestrator"}
7    {"type":"TOOL_CALL_START","toolCallId":"call_CN5GEDy9byHqg18I9dAhnUDB","toolCallName":"task","parentMessageId":"lc_run--01a06373-7a61-7cb2-a616-3b1e3ee01e57"}
9    {"type":"TOOL_CALL_ARGS","toolCallId":"call_CN5GEDy9byHqg18I9dAhnUDB","delta":"{\""}
     # [elided: 141 more TOOL_CALL_ARGS deltas spelling {"role":"research","task_description":"..."}]
292  {"type":"TOOL_CALL_END","toolCallId":"call_CN5GEDy9byHqg18I9dAhnUDB"}
301  {"type":"STEP_FINISHED","stepName":"orchestrator"}
302  {"type":"STEP_STARTED","stepName":"tools"}
304  {"type":"RAW","event":{"event":"on_tool_start","name":"task"}}
306  {"type":"SUBAGENT_STARTED","subagentRunId":"call_CN5GEDy9byHqg18I9dAhnUDB-sub","name":"research","parentToolCallId":"call_CN5GEDy9byHqg18I9dAhnUDB"}
308  {"type":"TEXT_MESSAGE_START","messageId":"call_CN5GEDy9byHqg18I9dAhnUDB-sub-m1","role":"assistant","subagentRunId":"call_CN5GEDy9byHqg18I9dAhnUDB-sub"}
310  {"type":"TEXT_MESSAGE_CONTENT","messageId":"call_CN5GEDy9byHqg18I9dAhnUDB-sub-m1","delta":"L","subagentRunId":"call_CN5GEDy9byHqg18I9dAhnUDB-sub"}
312  {"type":"TEXT_MESSAGE_CONTENT","messageId":"call_CN5GEDy9byHqg18I9dAhnUDB-sub-m1","delta":"AX","subagentRunId":"call_CN5GEDy9byHqg18I9dAhnUDB-sub"}
     # [elided: 490 more TEXT_MESSAGE_CONTENT deltas — the CHILD's text, one raw token each, every one carrying subagentRunId]
1294 {"type":"TEXT_MESSAGE_END","messageId":"call_CN5GEDy9byHqg18I9dAhnUDB-sub-m1","subagentRunId":"call_CN5GEDy9byHqg18I9dAhnUDB-sub"}
1295 {"type":"SUBAGENT_FINISHED","subagentRunId":"call_CN5GEDy9byHqg18I9dAhnUDB-sub","outcome":{"type":"success"}}
1296 {"type":"RAW","event":{"event":"on_tool_end","name":"task"}}
1297 {"type":"TOOL_CALL_RESULT","messageId":"605c4334-e164-4569-86a4-f12476801d87","toolCallId":"call_CN5GEDy9byHqg18I9dAhnUDB","content":"LAX: Central Terminal Area with Terminals 1–8 plus the Tom Bradley International ..."}
1302 {"type":"STEP_FINISHED","stepName":"tools"}
     # [elided: booking round — TOOL_CALL_START call_bCmw9AhTCKRuYWOLAb7hzTQF (1307) → ARGS → END (1586) → SUBAGENT_STARTED name=booking (1600) → TEXT_MESSAGE_START -sub-m1 (1602) → 710 deltas → TEXT_MESSAGE_END (3024) → SUBAGENT_FINISHED success (3025) → TOOL_CALL_RESULT (3027)]
     # [elided: itinerary round — TOOL_CALL_START call_E725YycIoO2TUaKOug1lcdR7 (3037) → END (3312) → SUBAGENT_STARTED name=itinerary (3326) → 276 deltas → TEXT_MESSAGE_END (3882) → SUBAGENT_FINISHED success (3883) → TOOL_CALL_RESULT (3885)]
3896 {"type":"TEXT_MESSAGE_START","messageId":"lc_run--01a06375-457d-7611-adea-cd992b954a70","role":"assistant"}
     # [elided: 243 TEXT_MESSAGE_CONTENT deltas — the ORCHESTRATOR's own summary, no subagentRunId]
4386 {"type":"TEXT_MESSAGE_END","messageId":"lc_run--01a06375-457d-7611-adea-cd992b954a70"}
4403 {"type":"MESSAGES_SNAPSHOT", ...}
4404 {"type":"RUN_FINISHED","threadId":"capture-thread-2","runId":"01a06373-7a57-7222-b98e-9e82a76738a9"}
```

Event tally (4,404 events): 1 RUN_STARTED, 8 STEP_STARTED, 8 STEP_FINISHED,
3 TOOL_CALL_START, 415 TOOL_CALL_ARGS, 3 TOOL_CALL_END, 3 SUBAGENT_STARTED,
3 TEXT_MESSAGE_START(sub), 1,478 TEXT_MESSAGE_CONTENT(sub),
3 TEXT_MESSAGE_END(sub), 3 SUBAGENT_FINISHED, 3 TOOL_CALL_RESULT,
1 TEXT_MESSAGE_START, 243 TEXT_MESSAGE_CONTENT, 1 TEXT_MESSAGE_END,
9 STATE_SNAPSHOT, 1 MESSAGES_SNAPSHOT, 1 RUN_FINISHED, 2,217 RAW. No CUSTOM,
no ACTIVITY_*, no SUBAGENT_ERROR.

**Child deltas: streaming, one raw token per event** (1,478 attributed content
events across three rounds: 492 + 710 + 276) — the §2 accumulator is gone and
each delta is a few bytes instead of the full text-so-far. Every child event
carries `subagentRunId` derived from the wire `toolCallId` (`<toolCallId>-sub`
/ `<toolCallId>-sub-m1`), `SUBAGENT_STARTED.parentToolCallId` matches the
bridge-native `TOOL_CALL_START.toolCallId` verbatim, and the `TOOL_CALL_RESULT`
content equals the joined child deltas. The `subagent_activity` CUSTOM events
were consumed (0 on the wire); their RAW `on_custom_event` mirrors (1,487)
still pass through because the bridge yields them before
`_handle_single_event` — the same mirror the ACTIVITY pipeline shipped, and
the client ignores RAW.

**Measured order, `TOOL_CALL_START` vs `SUBAGENT_STARTED`:** START 7 → END
292 → SUBAGENT_STARTED 306 (and 1307 → 1586 → 1600; 3037 → 3312 → 3326). The
tool call is fully announced (start, args, end) before the tool body runs,
so the reducer attaches the card to an already-known `parentToolCallId`; the
`SUBAGENT_*` block nests between `TOOL_CALL_END` and `TOOL_CALL_RESULT`.

## Browser verification

2026-09-02, live backend (real `OPENAI_API_KEY`, uvicorn on :5326) + `npx nx
serve cockpit-ag-ui-subagents-angular --port 4326`, driven headlessly with
Playwright (the §2 prompt typed into the composer). Screenshot, taken while
the research card was still `running`:
`cockpit/ag-ui/subagents/angular/e2e/manual/subagent-card-live.png`.

What rendered: the `task` dispatch produced an inline `<chat-subagent-card>`
anchored to its tool call — header `research` + wire `toolCallId` +
`running` badge + "1 message(s)" — with the specialist's transcript streaming
inside it, then booking and itinerary cards in turn, then the orchestrator's
own summary bubble. The child text never leaked into the parent bubble, and
each card persists (collapsed, `complete`) after its subagent finishes.

Did the card text stream mid-run: **yes**. Polling `agent.subagents()` and
the card's `innerText` every 150ms showed the research card mount at t≈8.9s
(empty, `running` — `SUBAGENT_STARTED` lands before the child's first token;
gpt-5-mini's reasoning latency kept it empty until t≈47.7s) and then grow
monotonically while `running`: message lengths 22 → 56 → 113 → 147 → 223 →
262 → 299 → 330 → 367 → 401 → 431 → 506 → 540 chars across consecutive
150ms samples (t≈47.7s → 49.6s), reaching 5,336 chars before flipping to
`complete` and collapsing (card `innerText` 592 → 58 chars). Booking
(2,890 chars) and itinerary (1,206 chars) behaved identically. This confirms
the attributed `TEXT_MESSAGE_CONTENT` deltas render progressively in the
card, not as one post-hoc paste.
