# Deep Agents Subagents — React preview

Aviation lookups use fixed sample data, including weather.

Explicit Send lazily creates an owned native LangGraph conversation using selector `subagents`. Suggestions fill the draft. Parent task cards preserve canonical call order and literal tool arguments/results; the roster is field-researcher and weather-analyst. Other tools and observed general-purpose dispatches remain literal observations.

Root Response saved requires successful native delivery plus matching owned raw current state, fresh history head and exact checkpoint, followed by canonical native load before another Send. A resolved root tool error can still be saved, and its raw error label remains visible. Incomplete authority disables Send until New.

Child observations use full namespace arrays and retain their own user/assistant/tool transcripts through parent reload. They are local to this open conversation, are not restored child history, and are not associated with individual parent task cards. Reload and New clear them. Stop ends local delivery without promising backend rollback.

Task descriptions/results and child transcripts are bounded to 65,536 UTF-16 units each. The shared display ledger caps 100 task observations, 100 child namespaces and 1,048,576 UTF-16 code units of display text; unavailable data is visibly incomplete.

Run `npx nx test cockpit-deep-agents-subagents-react`, `lint`, `build`, `fixture-test`, or `e2e` with the same project name. E2E uses the actual compiled Python graph and installed native SDK, with deterministic model construction only. No fixture controls or proof endpoints ship in the isolated production build.
