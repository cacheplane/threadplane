# React AG-UI client tools preview

Five browser tools demonstrate simulated weather, a cancellable status check, and an explicit fictional booking decision. This experimental source-build preview uses private React, core, content, and framework-neutral AG-UI candidate packages. These native APIs are not published npm packages. Angular continues to use the same canonical Python backend, stock model, and prompt.

## Execute a typed browser catalog

Choose **Run**. The five presets only fill the draft; **Send** submits your question. **get_weather** returns a fixed simulated reading. **slow_status_check** waits three seconds and supports **Stop**. **weather_card** renders a local reading and follows up. **weather_snapshot** renders the same reading without an automatic follow-up. **confirm_booking** waits for an explicit **Confirm** or **Cancel booking** choice. No tool fetches real weather or makes a real reservation.

Source: `cockpit/ag-ui/client-tools/react/src/tools.ts`

Source: `cockpit/ag-ui/client-tools/react/src/app.tsx`

The native session owns the catalog and physical continuations. The app owns a local tool store, typed executors, and authored panels. Native tool observations retain literal call arguments and results; local execution records separately report browser work. A local result is not proof of server receipt: **unsent**, **sent-unconfirmed**, and **observed** describe delivery. A physical run can finish while the overall command still awaits browser execution, a continuation, or your decision.

Source: `cockpit/ag-ui/client-tools/react/src/application.ts`

Source: `cockpit/ag-ui/client-tools/react/src/projection.ts`

## Render weather and decide a fictional booking

**weather_card** uses **followUp: true**. **weather_snapshot** uses **followUp: false**: its local result ends the command without an automatic final assistant response. The next explicit human question carries the result in native history without replaying the tool. Cards require a complete validated local reading and belong to the native assistant that requested them.

Source: `cockpit/ag-ui/client-tools/react/src/weather-card.tsx`

A fictional booking resolves a browser promise through your explicit decision. This is separate from a native agent pause/resume. Once resolved, stopped, replaced, or unmounted, its controls cannot make another decision.

Source: `cockpit/ag-ui/client-tools/react/src/confirm-booking.tsx`

## Stop and start fresh

The first Send creates a UUID lazily. **New conversation** clears local state and draft; the next Send creates a fresh UUID. There is no automatic reconnect, replay, saved-history restoration, durable store, or promise of server persistence. Unknown calls, native pauses, errors, and uncertain outcomes conservatively require New. Validation failures may produce legitimate error ToolMessages and a native continuation; they are not manufactured cancellation results.

**Stop** revokes active local controls and execution. The view can retain the last captured native observations for inspection. A last record marked running is historical evidence, not authority to continue, and a local completion or cancellation does not confirm native delivery. Leaving Run or changing frontend disposes the old session; returning starts empty and lazy.

## Use the shared native runtime

**Shared runtime** uses the existing **/ag-ui/client-tools/agent** route. Runtime settings can supply a Developer runtime; its configured address stays outside the visible preview. This React frontend uses **/ag-ui/client-tools/react/** and the AG-UI adapter. It shares the canonical backend with Angular.

Source: `cockpit/ag-ui/client-tools/react/src/connection.ts`

Source: `cockpit/ag-ui/client-tools/python/src/graph.py`

Source: `cockpit/ag-ui/client-tools/python/src/server.py`

Source: `cockpit/ag-ui/client-tools/python/prompts/client-tools.md`

## Source build and offline verification

From a checkout, with Node/npm, uv, and Python 3.12 available:

~~~sh
npm ci
npx nx build cockpit-ag-ui-client-tools-react
npx nx e2e cockpit-ag-ui-client-tools-react
~~~

The e2e target depends on frozen canonical fixture preparation. For explicit preparation, run **npx nx run cockpit-ag-ui-client-tools-react:prepare-fixture**. The build installs the real private package artifacts with strict types. Deterministic offline browser checks use the actual canonical graph and locked AG-UI adapter with scripted model responses over HTTP/SSE. They verify local execution, physical continuations, and owned cleanup; they do not prove a live model-provider request. Docs, Code, and Run select this same source implementation.

Source: `cockpit/ag-ui/client-tools/react/project.json`
