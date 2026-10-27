# Native React chat generative UI

An experimental native React conversation with six local authored dashboard views: dashboard grid, container, statistic, line chart, bar chart, and data grid. Airline values are fixture data. Charts include accessible data tables.

Use **Show dashboard** or **Cancelled flights** to populate the composer, then Send (or Enter). Shift+Enter adds a line. Nothing submits on mount or when selecting a suggestion. Stop preserves the last confirmed dashboard and requires New conversation before another turn. New conversation is available during pending work and releases the previous owner.

Each accepted layout stays inline under its owning assistant message. Every retained layout reads the same immutable confirmed dashboard, so a data-only follow-up refreshes older layouts. Layout and data become authoritative only after the run, terminal checkpoint, transcript, tool results, and dashboard agree. Pending or rejected updates leave the prior dashboard visible. Nonempty assistant prose is retained with an explanatory notice and inspectable tool result instead of applying a layout from arguments.

From the repository root:

```sh
npx nx test cockpit-chat-generative-ui-react
npx nx lint cockpit-chat-generative-ui-react
npx nx build cockpit-chat-generative-ui-react
npx nx fixture-test cockpit-chat-generative-ui-react
npx nx e2e cockpit-chat-generative-ui-react
```

The production build uses isolated packed React packages and the private LangGraph runtime candidate. The browser fixture uses the actual compiled Python graph with deterministic model responses, socket denial, and checkpoint proof hashes. Its local server selects only `chat-generative-ui`, at `http://127.0.0.1:4627/chat/generative-ui/react/`. Fixture controls and Python helpers are never included in public assets. Browser screenshots and request/graph proofs are written to the test's output directory.
