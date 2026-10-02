# Native React AG-UI Subagents preview

The native session owns execution, conversation identity, full canonical history
and child lifecycles. React displays literal parent text and bounded, read-only
specialist observations under the exact parent assistant and task. Captured child
text remains visible after root snapshots remove it, but never enters requests.

Shared runtime connects to `/ag-ui/subagents/agent`. Developer settings can supply
an AG-UI endpoint. Send creates a conversation lazily. Confirmed root completions
permit follow-ups; child completion alone does not. New clears cards and history.
Stop and uncertain outcomes require New. Requests are never replayed.

From the repository root:

```sh
npx nx build cockpit-ag-ui-subagents-react
npx nx e2e cockpit-ag-ui-subagents-react
```

The closed build installs private local packages with locked dependencies and
strict types. Browser checks use the actual compiled graph and child bridge with
frozen providers. Local fixtures are excluded from deployments.
