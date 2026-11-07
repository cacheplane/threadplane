# Learning workbench recording

From the repository root, run:

```sh
NX_DAEMON=false NX_ISOLATE_PLUGINS=false npx nx run native-conversation-react:capture-workbench
```

The target runs its scoped tests, then writes
`apps/website/src/components/workbench/trip-recording.json`. It requires Node 22
and permission to listen on loopback; no provider credentials or external service
are used. The generator alone is:

```sh
TSX_TSCONFIG_PATH=tsconfig.base.json node --import tsx examples/chat/native/tooling/capture-workbench.mjs
```

This runs the existing React streaming application, Threadplane's `createSession`,
and its production LangGraph SDK HTTP/SSE transport against a deterministic local
fixture. The supplied Paris itinerary is input text; the fixture streams a recap
and a final canonical message observation. No tool changes an itinerary.

Frames are captured from application subscriptions and the fixture HTTP boundary,
not hand-authored. `capture.start` precedes state observation and has `state: null`.
Subsequent `state` objects project the application's actual `creation`, `busy`,
`canSubmit`, and `outcome` fields. They are application state, not graph or itinerary
state. `event` describes the observation boundary, not provider-internal events.
Requests include only observed application HTTP method, fixed path, and allowlisted
body fields. A request starts with `status: null`; status becomes 200 only after the
fixture sends response headers. Each frame gets a detached snapshot of requests.

Message IDs are normalized in first-observation order. `elapsedMs` is measured
monotonic time and varies between runs; it is never authored playback pacing.
Fixture output and observation ordering are deterministic, but runtime scheduling
can affect timing. The website reads only this JSON and chooses its own pacing.

Capture limits: 120 frames, 200 KB of compact JSON, two requests with at most 16 KB
each, a fixed four-chunk response, and a five-second timeout. Headers, connection
URLs, arbitrary configuration, metadata, and credentials are excluded. Subscription,
application/session, timer, and server connections are released in `finally`,
including failed capture paths. This proves fixture-backed SDK behavior, not a
live provider or live iframe observation bridge.
