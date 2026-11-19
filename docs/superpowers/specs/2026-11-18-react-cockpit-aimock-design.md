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

   Holds are now explicit controls, not magic prompt text, so every test
   prompt can be a shared fixture prompt.

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
| 1 | chat/input, chat/theming | `/__captures` (theming) | generic set otherwise |
| 2 | chat/tool-calls, chat/subagents, chat/interrupts, chat/generative-ui | hold on a predicate (tool call, child or subgraph event, resume), `/__fail-resume`, `/__worker-failure`, `/__metadata-failure`, `/__configure` | add `afterEvent` predicates to `/__hold/stream`, plus route-matched failure injection |
| 3 | chat/threads, chat/timeline, chat/debug | title modes and holds, state and checkpoint holds, mapped checkpoints | history and state rewriting, holds per endpoint |
| 4 | langgraph/{streaming, persistence, memory, interrupts, subgraphs, client-tools, deployment-runtime, time-travel, durable-execution} | `/__hold-draft`, `/__hold-extraction`, `/__hold-plan`, `/__publish-*`, `/__bad-history`, `/__unsafe-source` | `durable-execution` `/__publish-*` injects authored events that a real graph can't emit, so it keeps a small authored layer on top of the proxy |
| 5 | deep-agents/{planning, filesystem, memory, skills, subagents} | `/__configure`, `/__raw-events`, proof-heavy `*-fixture.spec.mjs` | Angular `da-*.json` fixtures exist |
| 6 | ag-ui/{streaming, interrupts, tool-views, json-render, subagents, client-tools, a2ui}, chat/a2ui | AG-UI wire (`createAgUiGlobalSetup`, uvicorn), `/__mode/*`, `/__fail-transport`, A2UI lifetime receipts | needs an AG-UI flavor of the proxy; the A2UI fixtures also feed dedicated CI proof steps (`chat-a2ui-*.spec.mjs`, `verify-ag-ui-a2ui.mjs`) and move last |
| 7 | runtimes/{aws-strands, mastra, microsoft-agent-framework} | `/__finish`, `/__stats` | native non-LangGraph backends. Angular already replays `aws-strands.json`, `mastra.json` and `microsoft-agent-framework.json` through their own servers |
| n/a | render/* (6) | none | `adapter: 'none'`, no model backend |

Each batch deletes the fixture servers (`*-fixture.mjs`, `*-wire.py`,
`*-fixture.spec.mjs`) it replaces, and before deleting, moves any check
that is about the graph rather than the browser contract into that
example's Python tests.
