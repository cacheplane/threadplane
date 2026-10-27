# Native React AG-UI JSON Render preview

The native AG-UI session owns execution, conversation identity, complete history
and shared state. React presents the existing airline dashboard through native
RenderSpec and six authored read-only views. Server tools supply fixed demo data.
Retained layouts read the latest validated shared state; new layouts stay with
the assistant that requested them.

Shared runtime connects to `/ag-ui/json-render/agent`. Developer settings can
supply an AG-UI endpoint. The first Send creates the conversation lazily. New
clears the conversation; Stop and unconfirmed outcomes require New. Requests
are never replayed.

From the repository root:

```sh
npx nx build cockpit-ag-ui-json-render-react
npx nx e2e cockpit-ag-ui-json-render-react
```

The strict source build installs private local packages with locked dependencies.
Browser verification uses the actual compiled Python graph with frozen providers
and the actual AG-UI bridge. Its local proof server is excluded from deployments.
