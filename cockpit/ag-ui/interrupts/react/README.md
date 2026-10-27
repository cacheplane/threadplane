# Native React AG-UI Interrupts preview

This experimental source-build frontend uses the existing fictional refund graph
and a native AG-UI pause/resume endpoint. The native session owns execution,
transcript and decisions; the app presents the current refund approval.

Shared runtime connects to `/ag-ui/interrupts/agent/native`. The existing Angular
endpoint retains its legacy wire contract. Developer settings can supply an
AG-UI endpoint. Stop and unconfirmed outcomes require a new conversation;
requests are never replayed.

From the repository root:

```sh
npx nx build cockpit-ag-ui-interrupts-react
npx nx e2e cockpit-ag-ui-interrupts-react
```

The strict build installs private local artifacts with locked dependencies.
Browser verification uses an isolated HTTP/SSE fixture excluded from deployment.
