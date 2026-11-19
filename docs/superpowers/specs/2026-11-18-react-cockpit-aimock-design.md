# React cockpit e2e on aimock

Status: pilot landed for `chat/messages`; the remaining batches are listed below.

## Problem

Angular cockpit e2e and React cockpit e2e test the same examples against
different backends.

- **Angular** (`libs/e2e-harness/src/global-setup-factory.ts`): aimock replays
  `cockpit/<example>/angular/e2e/fixtures/*.json` (matched on `userMessage`,
  with optional `chunkSize`/`latency`), a real `langgraph dev` points
  `OPENAI_BASE_URL` at aimock, and `nx serve` serves the app.
- **React** (`scripts/react-cockpit/serve.mjs <example>`): one static server
  hosts the built app and about 30 hand-written fixture servers
  (`scripts/react-cockpit/*-fixture.mjs`). The LangGraph-backed ones run the
  compiled graph in-process for each run (`*-wire.py`), with `ChatOpenAI`
  patched to a scripted model that has one hard-coded answer. They also
  assert zero socket connects and return proof data (`/__graph-proof`).

Because of this split, a React example can't pick a reply per prompt or
stream with latency, and the two frameworks can't share a regression
fixture. That's what blocked the `@cacheplane/partial-markdown` 0.6.0
browser check.

## Design

```
Playwright globalSetup ──► aimock (replay, shared Angular fixtures)
                      └──► langgraph dev  (OPENAI_BASE_URL = aimock)
                                 ▲
Playwright webServer ──► serve.mjs ── /api, /developer-api ──► langgraph-proxy.mjs
                         (static build)                        (record + inject)
```

1. **Backend: same as Angular.** `createLanggraphGlobalSetup` (new, in
   `libs/e2e-harness`) starts aimock and `langgraph dev` without a frontend.
   `createGlobalSetup` (Angular) now composes the same
   `startLanggraphBackend`. Teardown already walked a state map, so it now
   treats the Angular process as optional.
2. **Fixtures are shared, not copied.** The React example's
   `configuration.mjs` entry declares
   `backend: { kind: 'aimock-langgraph', python, fixtures, langgraphPort }`,
   with `fixtures` pointing at the Angular example's `e2e/fixtures`
   directory. React-only prompts (for example, the visual contract's
   `` Visual `contract` ``) are appended to the same file, so both
   frameworks replay one source of truth. The React `project.json` declares
   `implicitDependencies` on the Angular and Python projects, so a change to
   a fixture or to the graph selects both caps in the CI matrix.
3. **A thin recording and fault-injection proxy keeps the browser contract
   tests.** `scripts/react-cockpit/langgraph-proxy.mjs` forwards `/api/*` and
   `/developer-api/*` to `langgraph dev` and adds only what a live server
   can't produce on demand:

   | Control | Old authored fixture | Proxy |
   | --- | --- | --- |
   | `GET /__requests` | records requests | records path, method, body and `x-api-key` before forwarding |
   | `POST /__reset` | reset in-memory graph | resets proxy state; threads in `langgraph dev` are uuid-scoped and don't need clearing |
   | `POST /__fail-create` | 500 on create | next `POST /threads` gets a 500 and isn't forwarded |
   | `POST /__history/<mode>` | authored history | real history, rewritten on the way back (`changed`/`missing`/`pending`), held (`hold`), or a 500 (`failed`) |
   | `POST /__release-history` | release | same |
   | magic prompts `Hold` / `Hold fence` | stop emitting authored events | `POST /__hold/stream {afterText?}` forwards whole SSE events until the first AI delta (or until the accumulated AI text contains `afterText`), then buffers |
   | `POST /__release` | emit the rest | flushes the buffer and resumes piping |
   | `GET /__lifetime` | held stream or history | same (`activeStream`, `activeHistory`) |
   | `GET /__graph-proof` | in-process proof | removed; see "Guarantees" |
   | `GET /__captures` (batch 1) | authored SSE, saved messages, title updates | per finished run: forwarded SSE text, saved `messages`/`next` from the real `/state`, and thread title before and after the run, all captured before the browser sees the stream end |
   | `GET /__lifetime` child reaping (batch 1) | owned wire child processes | no per-run graph processes exist any more, so `openResponses` (proxied browser connections still open) replaces the child-reaping check |
   | `/__hold-tool`, `/__hold-child`, `/__hold-resume`, `/__hold-stream` (batch 2) | authored stop points | `POST /__hold/stream` with `{ beforeToolResult }`, `{ afterChildMessage }`, or nothing (the next stream: a resume is just the next run) |
   | `/__worker-failure`, `/__fail-resume` (batch 2) | graph worker closed / resume 500 | `POST /__fail-stream`: the next run stream answers 500 without reaching the graph |
   | `/__metadata-failure` (batch 2) | `threads.get` raises | a per-prompt aimock error fixture for the title model (`… (title fails)`). `generate_title` swallows it on the same path as a metadata read failure |
   | `/__child/<mode>` (batch 2) | malformed child `values` / child `error` event | same control on the proxy: injected data, as before |
   | `/__history/<tool or approval mode>` (batch 2) | corrupted tool or approval evidence | the same rewrites, applied to the real history |
   | `/__ready` (batch 2) | Python worker loaded | `langgraph dev` answers `/ok` |
   | `/__title/<mode>`, `/__hold-title` (batch 3) | authored thread metadata | `GET /threads/<id>` rewrites (`missing`, `wrong-thread`, `invalid`, `titlefailure`, `literal`, `long`), with the mode captured when the read arrives; `/__hold/title` |
   | `/__state/<mode>`, `/__hold-state`, `/__mapped-checkpoints` (batch 3) | authored checkpoint reads | the same rewrites on the real `POST /threads/<id>/state/checkpoint`; mapped mode adds the root `checkpoint_map` to history, state and `checkpoints` events |
   | `/__metadata-failure` + `/__title-model-failure` (timeline) | two title faults | one test: a per-prompt title-model error. Both faults end on the same swallowed exception in `generate_title`; the metadata read itself runs inside `langgraph dev` and can't be failed from outside |
   | `/__hold-draft`, `/__hold-extraction`, `/__hold-start`, `/__hold-resume`, `/__hold-history` (4a) | authored stop points | `/__hold/stream` with `{ afterText }` or `{ immediate }` (the next stream: a resume, or a run held before its router), and `/__hold/history` |
   | interrupts `Unknown` / `Multiple` (4a) | authored interrupt batches | `/__interrupt/<unknown or multiple>` rewrites the root interrupts the browser receives (injected data). `Malformed` is real: the extractor fixture returns amount -1 |
   | memory `Replace` / `Malformed` / `Absent` / `Pause` (4a) | authored memory state | `/__values` sets or omits keys in the next run's `values`, `updates` and `checkpoints` state. `persist` writes the cleared memory to the real thread, so the next turn agrees (the real graph only merges facts) |
   | persistence `/__replace-first`, `/__empty-first`, `/__pause-history` (4a) | authored server history | `/__history-values` (one-shot latest-values rewrite) and a `paused` history mode (pending + unknown interrupt task) |
   | subgraphs route faults (4a) | ten authored stream variants | `/__stream/edit`: drop, patch, omit or insert-after on matching events. Ops on `checkpoints` events address their `values`, because the session reads root state from both |
   | client-tools `/__hold-state`, `/__fail-state`, `/__threads` (4b) | authored client result writes | `/__hold/state-write` and `/__fail/state-write` act on the client's real `POST /threads/<id>/state`; `/__thread/<id>` reads the real state without recording it |
   | deployment-runtime's nine finalization faults (4b) | authored final values | `/__stream/edit` on the final state (`values` and `checkpoints` carrying `completed_turn_id`), plus `/__history-values` for "No final values", because the session then reads history |
   | time-travel `/__advance-tip`, `/__bad-history`, `/__unsafe-source`, `/__states`, result faults (4c) | authored checkpoint store | a real competing write (`/__thread/<id>/state`), `/__history-copies`, `/__state/unsafe`, history reads, and `/__stream/edit { state: true }` (the fork's confirmation read gets the same edits) |
   | durable `Uncertain` / `Known uncertain`, `/__publish-*`, `/__finish-run` (4c) | authored half-finished runs | `/__hold/stream { end }` ends the browser's stream after the first draft. `anonymous` withholds the run identity, or `/__run-status/running` keeps a known run in flight. `/__history/pending` stays inconclusive until a one-shot `/__history-values` publishes the outcome (wrong marker or unrelated turn as the fault) |
   | `POST /__inject/reasoning` (batch 1) | authored `reasoning_content` | **injected data, opt-in per test**: nothing is injected unless a spec calls it, and only the theming test that styles the Reasoning region does. langchain_openai's `ChatOpenAI` does not extract `reasoning_content` from Chat Completions responses (even though aimock can send it), so the real graph never surfaces reasoning. Until reset, the control adds `additional_kwargs.reasoning_content` to every AI message the browser receives (the first stream chunk, `values`/`updates`/`checkpoints` events, history and `/state`). Possible follow-up: switch the theming graph to the Responses API with reasoning summaries, so reasoning flows for real in both frameworks. That is a product change, so it is out of scope here |

   Holds are now explicit controls, not magic prompt text, so every test
   prompt can be a shared fixture prompt.

   Prompts that only exercise the client (raw whitespace, multiline drafts,
   IME guards) are answered by a **catch-all fixture**,
   `{ "match": { "userMessage": "" } }`. It goes last in the file, because
   aimock matches `userMessage` by substring and the first match wins.
   Prompts whose reply matters keep their own fixture.

   Each migrated example has the same one-line `e2e/global-setup-impl.ts`
   (`reactAimockGlobalSetup('<topic>')` from
   `cockpit/shared/react-aimock-setup.ts`), and its `configuration.mjs`
   entry gets `backend: aimockLanggraph('<example>', <port>)`, where the
   langgraph port is the app port + 1000.

## Website previews

Website e2e (`apps/website/playwright.config.ts`) reuses the React examples as
live previews and drives several of them through the same controls. Each
batch that deletes an authored fixture server moves the website previews and
specs that used it onto aimock in the same PR, so every PR is green by itself.
There is no second, authored backend.

- `serve.mjs <example> --backend` starts that example's aimock + `langgraph
  dev` itself (`scripts/react-cockpit/aimock-backend.mjs`), lazily on the
  first request for the app or its API. Website suites already start only the
  preview servers they own, so a suite pays only for the previews it drives.
  The backend stays in the server's process group and stops with it.
- Preview specs call `POST /__ready` before driving a preview; it waits out the
  lazy start.
- One `langgraph dev` per example, not a shared `langgraph.json`: each example
  is its own Python project with its own locked dependencies and graph module,
  so a shared server would need one merged environment.

## Guarantees: kept, moved, or replaced

| Old guarantee | Where it lives now |
| --- | --- |
| The actual compiled graph produced the events | Stronger: `langgraph dev` serves the checked-out `src/graph.py` over the real LangGraph HTTP/SSE wire, the same path Angular uses. Before, the React fixture re-encoded `astream` output by hand. |
| Zero network connects from the graph (`networkConnectAttempts: 0`) | Moved down a level. `cockpit/<example>/python/tests/test_*.py` still patches `socket.connect` to fail and runs the compiled graph with `tests/providers.py`, and `nx e2e` depends on that test target. In e2e, the process boundary takes over: `OPENAI_BASE_URL` points at aimock in replay mode (an unmatched prompt gets a 404 and never reaches a provider), and `OPENAI_API_KEY` is a dummy value. |
| Title callbacks never leak into the answer stream (`titleMessageCallbacks: 0`) | The e2e test checks it directly: the title model call matches its own fixture (`systemMessage: "In 3-5 words, summarize"`, which returns `Aviation snippet title`), and the test asserts that text never appears in the transcript. The Python unit test still checks callback isolation. |
| `sourceSha256` / `lockSha256` pins | Dropped for `chat/messages`. They only proved that the in-process wire script loaded the right files, and with `langgraph dev` running the project itself, there's no second copy to drift. Other examples' `*-fixture.spec.mjs` files pin hashes too. Each batch deletes those specs along with their fixture servers and moves any graph-level check into the example's Python tests. |
| Exact request traffic | Kept through `/__requests`. The counts the specs assert (1 create, N streams, N history reads, N run GETs) are client behavior and hold against the real server. |
| Hold, cancel, pagehide lifetime, history-mismatch and creation-failure contracts | Kept through the proxy controls above. Cancel now reaches the real server's `/runs/<id>/cancel`. |

The `scripts/react-parity/` suites (inventory, baseline, package and boundary
verification) don't read the cockpit fixture servers, so they aren't
affected. The only `chat-messages` checks in `scripts/` were the closed
configuration identities (`cockpit-frontend-matrix.spec.mjs`, which now
includes the `backend` block) and the port checks, which are unchanged.

## CI cost

React cockpit caps already run in the `cockpit-e2e` matrix, with the per-cap
`uv sync` and venv cache that the in-process wire scripts needed. So the
migration adds no job and no install step.

- Before: one cold `uv run --frozen python …-wire.py` process per model run,
  2–4 s each (about 15 runs for `chat/messages`).
- After: one `langgraph dev` startup per spec run, about 10–20 s, then
  millisecond replays.

The net change is roughly neutral per cap, and it gets faster as specs add
turns.

## Drift

`.github/workflows/aimock-drift.yml` currently records only
`examples/chat/angular`. No cockpit fixture, Angular or React, is
re-recorded today. Because React now replays the Angular fixture files
directly, a future cockpit drift job that records the Angular cockpit specs
will cover both frameworks without extra work. Nothing React-specific needs
to be added to the workflow.

## Inventory and batches

The "Controls beyond the generic proxy" column lists what each remaining
example needs that the pilot proxy doesn't yet provide.

| Batch | Examples | Controls beyond the generic proxy | Notes |
| --- | --- | --- | --- |
| 0 (done) | chat/messages | none | pilot |
| 1 (done) | chat/input, chat/theming | `/__captures`, `/__inject/reasoning` (theming) | |
| 2 (done) | chat/tool-calls, chat/subagents, chat/interrupts | `/__hold/stream` `beforeToolResult` / `afterChildMessage`, `/__fail-stream`, `/__child/<mode>`, tool and approval `/__history` modes, `/__ready` | tool rounds key on aimock `toolCallId`; a mid-stream child model failure is aimock `truncateAfterChunks`; a title (metadata) failure is a per-prompt aimock error fixture (`… (title fails)`) |
| 2b | chat/generative-ui | `/__configure` faults that swap graph internals: a throwing KPI tool, malformed trend data, prose injected into the `admit` node's output, partial layouts | aimock can't produce tool-code failures or node-output rewrites, so this needs a decision: move the graph-level faults to Python tests, or keep a small authored layer |
| 3 (done) | chat/threads, chat/timeline | `/__title/<mode>`, `/__hold/title`, `/__state/<mode>`, `/__hold/state`, `/__hold/history`, `/__mapped-checkpoints`, `foreign`/`failure` history modes | a mid-stream model failure is aimock `truncateAfterChunks`; stream bodies come from `/__captures[].sse`, because DevTools can't return a streamed body the client closes |
| 3b | chat/debug | `/__hold/current`, `/__hold/checkpoint`, selected-read variants, `captures[].proof.providerVariant` | its fixture also backs the packed-consumer native-session proof (`chat-debug-native-session-probe.mjs`, its own CI step), so it migrates together with that proof |
| 4a (done) | langgraph/{streaming, interrupts, memory, persistence, subgraphs} | `/__hold/stream { immediate }`, `/__interrupt/<unknown or multiple>`, `/__values`, `/__history-values`, `paused` history mode, `/__stream/edit` | These fixtures were pure authored JS with no graph, so their specs asserted text the real graph never writes. Assertions now follow the real graph (for example "Refund of $47.50 issued"). The real stream also surfaced a client bug, fixed here: subgraphs rejected the child's `__start__` checkpoint (`values: {}`) as malformed |
| 4b (done) | langgraph/{client-tools, deployment-runtime} | `/__hold/state-write`, `/__fail/state-write`, `/__thread/<id>`, `/__stream/edit` list ops (`append`, `truncate`, `duplicateLast`, `copy`) | client tool rounds key on prompt + `hasToolResult`; a second same-thread turn uses its own prompt (`Weather again`), because aimock fixtures are stateless. "No final values" also strips the markers from the history read the session falls back to |
| 4c (done) | langgraph/{time-travel, durable-execution} | `/__history-copies`, `/__state/unsafe`, `/__thread/<id>/state` writes, `/__stream/edit { state, anonymous, unlessKey }`, `/__hold/stream { afterPattern, end }`, `/__run-status/<s>`, `/__history-values { entry }` | time-travel reads checkpoint ids from real history and thread reads, not authored ids (each turn saves input, start and done checkpoints). The competing tip is a real state write. durable-execution's uncertain outcomes end the browser's stream early, keep history inconclusive, and "publish" the saved outcome through a one-shot history rewrite |
| 5 | deep-agents/{planning, filesystem, memory, skills, subagents} | `/__configure`, `/__raw-events`, proof-heavy `*-fixture.spec.mjs` | Angular `da-*.json` fixtures exist |
| 6 | ag-ui/{streaming, interrupts, tool-views, json-render, subagents, client-tools, a2ui}, chat/a2ui | AG-UI wire (`createAgUiGlobalSetup`, uvicorn), `/__mode/*`, `/__fail-transport`, A2UI lifetime receipts | needs an AG-UI flavor of the proxy; the A2UI fixtures also feed dedicated CI proof steps (`chat-a2ui-*.spec.mjs`, `verify-ag-ui-a2ui.mjs`) and move last |
| 7 | runtimes/{aws-strands, mastra, microsoft-agent-framework} | `/__finish`, `/__stats` | native non-LangGraph backends. Angular already replays `aws-strands.json`, `mastra.json` and `microsoft-agent-framework.json` through their own servers |
| n/a | render/* (6) | none | `adapter: 'none'`, no model backend |

Each batch deletes the fixture servers (`*-fixture.mjs`, `*-wire.py`,
`*-fixture.spec.mjs`) it replaces, and before deleting, moves any check
that is about the graph rather than the browser contract into that
example's Python tests.
