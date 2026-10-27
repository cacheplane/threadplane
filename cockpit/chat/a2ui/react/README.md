# Native React Chat A2UI preview

Experimental native React flight form at `/docs/chat/a2ui/overview?frontend=react`, using the existing shared `c-a2ui` Python graph. Angular remains the default frontend. React, core, content, A2UI and neutral LangGraph candidates are private, unpublished source builds.

Request a form → edit origin, destination, departure date, passenger count and fare → Search → Select a demonstration flight → Modify. There is no real booking or payment. Modify restores the search values supplied by the server, including the last submitted route and party. The supported airports are LAX, JFK, SFO, ORD, BOS, ATL, DFW, SEA, MIA and DEN; fares are Economy, Premium, Business and First.

The closed profile supports Column, Row, List, Card, Text, Divider, ChoicePicker, DateTimeInput, TextField and Button. Generic support for all 18 A2UI views, full catalog parity, SSR and public native package publication remain pending.

Only a successful owned submission confirmed against its exact saved root checkpoint and raw transcript activates the newest settled surface. Raw A2UI stays separate from editable form values. Historical cards retain their last lexical edits with disabled controls. Invalid visible drafts cannot silently fall back to old valid values; replaced callbacks are inert. Transient responses, titles and completion flags never authorize controls. Stop, run/connection errors and unconfirmed outcomes require New conversation; ordinary form-validation errors remain correctable. The app never automatically resubmits actions or resumes uncertain turns. The graph may internally retry structured model output.

From the repository with dependencies installed:

```sh
npx nx test cockpit-chat-a2ui-react
npx nx build cockpit-chat-a2ui-react
npx nx e2e cockpit-chat-a2ui-react
WEBSITE_E2E_REACT_TOPIC=chat-a2ui npx nx e2e website --grep 'native Chat A2UI' --skip-nx-cache
```

The app e2e target builds the actual private packages and runs its installed terminal admission suite first. Website e2e retains its full registered React build prerequisites even when the topic selector narrows the running servers. Local serving uses `node scripts/react-cockpit/serve.mjs chat-a2ui --no-parent` on port 4646 after preparation.

Local verification runs the actual compiled canonical graph with deterministic providers, the real SDK and saved checkpoints. These fixture results establish local interoperability, not live-provider timing or durable deployment behavior. Production sources and public Code exclude fixture controls, testing helpers and the private probe. Runtime settings choose one configured shared backend; this example adds no service or public API.
