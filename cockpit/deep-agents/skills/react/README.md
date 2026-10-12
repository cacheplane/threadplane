# Native React Skills

The Skills cockpit uses the native React presentation and neutral LangGraph session runtime. Build the installed consumer with `npx nx build cockpit-deep-agents-skills-react`. Run unit tests with `npx nx test cockpit-deep-agents-skills-react`, lint with `npx nx lint cockpit-deep-agents-skills-react`, and check the closed frontend selection with `npx nx run cockpit-deep-agents-skills-react:configuration-test`.

The local selection is `deep-agents-skills`, with base path `/deep-agents/skills/react/` and reserved port 4631. It addresses the `da-skills` graph. Try drafting “Can a mid-size jet operate out of KASE?” and explicitly send it to create a conversation.

The index shows observed root metadata: each skill's name, description, virtual instruction path, and optional support annotations. Instruction bodies and references appear as on-demand tool read observations. An inspected read is evidence of the returned lines, not a claim that the whole file was read. Tool errors remain visible even when the parent response is confirmed.

New clears the draft and view while retaining a bounded catalog of locally confirmed conversations. Selecting one reads fresh current state, history, the exact checkpoint, and the native session; it never sends a prompt. Reload clears the catalog. Stop or uncertain parent state requires New. No retry, replay, or resume controls are provided.

Run `npx nx fixture-test cockpit-deep-agents-skills-react` for the source-bound compiled Python graph and installed SDK transport contracts, and `npx nx e2e cockpit-deep-agents-skills-react` for the installed native browser app. The loopback fixture uses deterministic model construction with remote sockets blocked, and preserves actual root values, checkpoints and tool results. Its controls and proof endpoints are excluded from the production frontend. These local checks do not establish live-service behavior.
