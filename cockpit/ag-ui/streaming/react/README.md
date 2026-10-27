# Native React AG-UI Streaming preview

This experimental source-build frontend uses the existing AG-UI Streaming backend,
the private native AG-UI session and native React text/chat-input components.
The session owns execution, state and outgoing history. The application owns its
lifetime and accepts only confirmed ordinary text completion for another Send.

Shared runtime connects to `/ag-ui/streaming/agent` on the examples origin.
The workspace's existing developer runtime settings can supply an AG-UI endpoint.
This preview does not claim saved server history, tools, resume or reconnect.
Stop and unconfirmed outcomes require a new conversation; no requests are replayed.

From the repository root with dependencies installed:

```sh
npx nx build cockpit-ag-ui-streaming-react
npx nx e2e cockpit-ag-ui-streaming-react
```

The strict build installs local private candidate artifacts with locked vendors.
Browser verification uses an isolated local HTTP/SSE fixture, excluded from public
assembly. This frontend does not deploy another backend or publish packages.
