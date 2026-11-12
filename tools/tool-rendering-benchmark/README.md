# Matched tool conversation benchmark

This developer-only benchmark measures tool presentation, not model intelligence or latency. A **scripted local agent** streams real native AG-UI and AI SDK SSE events and executes allowlisted local functions against authored, fixed reference records. The source URLs identify the subjects of the records; this server does not perform live web search. Each participant receives the exact scenario prompt, arguments and results.

The server records native run/thread/tool IDs beside canonical invocation IDs, prompt/argument/result SHA-256 hashes, execution counts and lifecycle timestamps. Repeated same-name calls remain distinct. A finalized argument boundary precedes tool execution; it must not be treated as execution success. Successful falsy/empty values, a real thrown tool error, Stop/disconnect fencing and a local approval gate have independent tests. The approval endpoint is a **backend contract check**; it does not prove any participant has native approval UI wired.

## Reproduce

Use the repository's Node 22, npm and Nx setup. Build the SDKs, then prepare consumers outside the checkout:

```sh
npx nx run-many -t build -p chat,ag-ui,react
npx nx test tool-rendering-benchmark
node tools/tool-rendering-benchmark/prepare.mjs /private/tmp/tool-ui-consumers
node tools/tool-rendering-benchmark/native-contract.mjs /private/tmp/tool-ui-consumers/vendor
```

Preparation packs Angular APF libraries and the private React/native AG-UI candidate through the repository's installed-consumer helper. It installs pinned competitor dependencies in a separate consumer, with no root lockfile changes. Keep the generated lockfiles, tarballs and `sources.json` with the evidence. For before/after work, prepare two separate destinations; never reinstall the frozen before consumer from changed sources.

Run these in separate terminals, using each directory as the working directory:

```sh
# Repository root
node tools/tool-rendering-benchmark/server.mjs
# <destination>/vendor
node node_modules/vite/bin/vite.js --host 127.0.0.1
# <destination>/react/consumer
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4811 --strictPort
# <destination>/angular
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4812 --strictPort
```

Then run from the repository root:

```sh
node tools/tool-rendering-benchmark/run-live.mjs /private/tmp/tool-ui-evidence
```

The runner uses installed Chrome, actual composer/Send/Stop/New controls, native client transports and real disclosure controls. It checks canonical ledger equality across all five consumers, saves DOM transition timelines and receipts, and captures matched 1440×1000 light/dark and 1024×900 light views at DPR 1. Reports and screenshots belong outside git. The server binds only loopback and accepts browser origins only on its API port or consumer ports 4810–4812.

## Participants and interpretation

| Participant         | Runtime and rendering                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Threadplane Angular | Installed public Angular APF `provideAgent` + `ChatComponent`; app-authored reference labels and opt-in related grouping                                           |
| Threadplane React   | Installed private native AG-UI session + public source-build display primitives; app-authored native transcript projection                                         |
| assistant-ui        | Published `useAgUiRuntime`, native thread/message/composer primitives, official MIT ToolFallback source pinned by commit; host-authored button/textarea skin       |
| CopilotKit          | Published v2 self-managed HttpAgent, CopilotChat and documented `useDefaultRenderTool()`; its registered default renderer, not a custom copy                       |
| shadcn/ui           | Published AI SDK `useChat`/DefaultChatTransport with official MIT Trace/Collapsible registry source pinned by commit; app-authored tool-part mapping and host skin |

`participants.json` pins direct packages and registry commits. `sources.json` records downloaded source URLs, hashes and the import/icon adaptations. Full generated lockfiles record native SDK/transitive versions, which can differ across participants. The shared frame controls viewport and host dimensions; it does not recreate a competitor's entire product design. These are concrete integration observations, not universal scores for every possible configuration.

The vendor consumer uses AG-UI 1.0.4 for assistant-ui's native adapter and CopilotKit's own exported `HttpAgent` for its exact 1.0.2 dependency. This preserves each published constructor's type identity; do not force either adapter onto the other's SDK class. Angular/React benchmark consumers and the vendor entrypoint are checked against their installed package declarations.

## Native approval, recovery and long sequences

With the same local servers running, execute `node tools/tool-rendering-benchmark/run-native.mjs /private/tmp/tool-native-evidence`. This additional Angular/React tier exercises protocol-native paused `RUN_FINISHED` outcomes and subsequent SDK-owned resume requests, explicit approve/deny, duplicate and reset revocation, a same-thread read-only retry with a retained successful prefix, and a long sequence with an app-authored recoverable error schema. Vendor approval UI remains N/A; the older streaming `/approve` endpoint is a separate backend contract.

The application interprets only the benchmark's known result schemas. Reference previews validate fixed official URLs. Each consumer builds its `toolOutcome` from per-tool decoders with the library's `toolOutcomes` registry. A declared recoverable read error is a failed outcome that declares a retry named for its reference, so the default rows count it while the successful read keeps its summary and source; the library offers the control only while idle and until a later read of that reference exists, and the consumer's handler submits the retry. A decoded `saved: true` result is a receipt outcome. A declined save shows authored text and no receipt. A complete tool result does not itself establish business success. Native pause IDs/generations come from the SDK; no display component executes or approves a call. Observed local write counts are not a universal exactly-once guarantee. Uncertain side effects are never blindly replayed.

The native driver uses actual composer, disclosure, approval and retry controls and saves receipts, geometry and desktop/dark/compact screenshots. It checks keyboard focus, source visibility outside Details, reading position during longer sequences, reduced-motion and forced-colors focus styling. These automated checks do not establish actual screen-reader speech; manual assistive-technology testing is separate. Both hosts use explicit app-owned Copy actions and a shared host skin; unsupported commands are not fabricated.

AG-UI expresses the error scenario as `RUN_ERROR`, whereas AI SDK supports a per-tool output error. Record that distinction. Native approval/resume is **N/A for these integrations**, not a failure of the underlying products. Never infer approval, persistence or business success from a pretty status label or from the existence of a rendered artifact.

Live ChatGPT/Claude product observations use the same user goal but are a separate qualitative tier: model, backend search selection and returned data are uncontrolled. Record access limits, account state and unknown versions. Do not compare their timing or result hashes against this controlled workload.

## Reference layout comparison

Both target consumers show confirmed references in the message's Sources panel by default, with nothing repeated per tool call. `?layout=summary|compact|cards` selects the earlier arrangements for comparison: `summary` repeats each reference's summary above the answer, `compact` shows one "Sources checked." line, and `cards` shows one card per distinct reference in the per-call result slot. The switch only changes this application's decoding of its own schema in `consumers/tool-outcome.ts`.

Both consumers declare each reference as a tool-outcome source with its summary as the snippet. The Angular `chat` composition lists those in the Sources panel itself. The React consumer composes its own message markup around the primitives, so it passes `sources="panel"` to the activity group and renders `Citations` with `citationsWithToolSources`.

With the same local servers running, execute `node tools/tool-rendering-benchmark/run-layouts.mjs /private/tmp/tool-layout-evidence`. It sends the real reference prompt in each layout on both hosts at 1440×1000 and 480×900 in light and dark, then records visible words, turn height and how many visible sentences state each fixture fact (1 means no repetition). It asserts that every layout keeps the activity collapsed, both source links visible or at most one disclosure away (recorded as `sourcesBehindDisclosure`), each call's literal result reachable through Details, no horizontal overflow, and a failed read counted with its named retry and retained successful reference. The numbers describe repetition only; which layout reads better is a human judgement, so the runner does not rank them.

## Deep workflow and restored history

`?scenario=deep-workflow` is one controlled turn that plans, delegates, reads, and then asks before its only write:

1. `plan_workflow` returns three numbered steps.
2. `delegate_research` runs two `read_reference` calls as a subagent. The server sends `SUBAGENT_STARTED`, the child message and child tool events with the subagent's run ID, then `SUBAGENT_FINISHED`, and only then the delegating call's own result.
3. A parent `read_reference` call checks one reference.
4. `save_note` pauses the run with a native interrupt. Approving resumes with only that call and saves one note; denying resumes with a cancellation result and saves nothing.

The ledger records each child call with its `parent` call and `subagentRunId`, so "the delegated reads ran once each, the write ran once or not at all" is checked from the server, never from what a host shows.

For this scenario each target consumer keeps its thread ID in `sessionStorage` and restores the thread on reload. The server keeps every delivered AG-UI event per thread, with the user turn recorded in the stored `RUN_STARTED.input` because a live stream never sends it:

- `GET /threads/<participant>/<threadId>/events` returns `{ events }`. The Angular consumer passes it to `provideAgent` through `httpReplay`.
- `GET /threads/<participant>/<threadId>/messages` returns `{ messages, subagents }`. `messages` is the transcript folded into native AG-UI messages; a child's messages keep its `subagentRunId`. `subagents` is each child's start and terminal evidence. The React consumer passes both to its session, which publishes the restored children as `earlierSubagents`.

The React consumer renders each child with `subagentsFromEvidence` and `SubagentCard`. The card stands in for the delegating call's row, as it does in the Angular `chat` composition, and it is still there after a reload.

Reading history is not a run. `GET /restores` lists the history requests and `GET /notes` returns the saved-note count, so a driver can show that a reload ran no tool and wrote nothing. "New conversation" forgets the kept thread, and a participant reset deletes its history.

With the same local servers running, execute `node tools/tool-rendering-benchmark/run-deep.mjs /private/tmp/tool-deep-evidence`. On both hosts, once approving and once denying, it sends the real prompt, checks the ledger at the pause, decides with the keyboard on the real control, checks the write count, reloads, and checks that the reload produced a history request, no run and no write, offers no decision again, and leaves the composer usable. It asserts that the prompt, the decision's outcome and the final answer are readable both live and restored, and that nothing overflows at 1440px or 480px.

Everything else is recorded, not asserted: for each fact (plan label and steps, delegation label and outcome, subagent name and summary, read rows, source links) whether it is visible with everything closed, visible only after opening disclosures, or absent, while waiting, after the decision, and after the reload, plus the list of facts that read differently after restore. Those differences are observations about each integration and the two different restore inputs, not a ranking.
