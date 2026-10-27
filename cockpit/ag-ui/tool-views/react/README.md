# Native React AG-UI Tool Views preview

This experimental source-build frontend uses the existing server weather tool.
The native AG-UI session owns requests and complete protocol history. React
observes tool arguments and results and presents the server's plain weather data
through an authored card. The browser does not execute a client tool.

Shared runtime connects to `/ag-ui/tool-views/agent`. Developer settings can
supply an AG-UI endpoint. New creates its next conversation lazily. Stop and
uncertain outcomes require a new conversation; requests are never replayed.

From the repository root:

```sh
npx nx build cockpit-ag-ui-tool-views-react
npx nx e2e cockpit-ag-ui-tool-views-react
```

The strict build installs private local artifacts with locked dependencies.
Browser verification uses an isolated HTTP/SSE fixture excluded from deployment.
