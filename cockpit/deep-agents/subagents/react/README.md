# Deep Agents Subagents — React preview

Aviation lookups use fixed sample data, including weather.

The first message, typed or from a welcome suggestion, lazily creates an owned native LangGraph conversation using selector `subagents`; mounting sends nothing. `Chat` renders the conversation with its defaults, observing the application as its session. Each parent task dispatch becomes a default subagent card in place of its call, in canonical call order, showing its literal result; the roster is field-researcher and weather-analyst. Other tools render as default tool rows.

Root Response saved requires successful native delivery plus matching owned raw current state, fresh history head and exact checkpoint, followed by canonical native load before another Send. A resolved root tool error can still be saved, and its card shows as failed. Incomplete authority disables Send until New.

Child observations use full namespace arrays and retain their own user/assistant/tool transcripts through parent reload. They are local to this open conversation, are not restored child history, and are not associated with individual parent task cards. Reload and New clear them. Stop ends local delivery without promising backend rollback.

Task descriptions/results and child transcripts are bounded to 65,536 UTF-16 units each. The shared display ledger caps 100 task observations, 100 child namespaces and 1,048,576 UTF-16 code units of display text; unavailable data is visibly incomplete.

Run `npx nx test cockpit-deep-agents-subagents-react`, `lint`, `build`, `fixture-test`, or `e2e` with the same project name. E2E uses the actual compiled Python graph and installed native SDK, with deterministic model construction only. No fixture controls or proof endpoints ship in the isolated production build.
