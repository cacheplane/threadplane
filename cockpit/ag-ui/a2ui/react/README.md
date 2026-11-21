# Native React AG-UI A2UI

This private experimental frontend shares the existing AG-UI A2UI Python graph and the closed flight presentation in `libs/cockpit-a2ui-react`. Angular remains the default on the canonical A2UI introduction guide.

Run `npx nx e2e cockpit-ag-ui-a2ui-react` for uncached frozen preparation, one isolated installed-application proof, and the browser suite. Existing Python 3.12 and uv must be available; explicit absolute executable overrides are `THREADPLANE_AGUI_A2UI_PYTHON` and `THREADPLANE_AGUI_A2UI_UV`. `THREADPLANE_AGUI_A2UI_APPLICATION_ROOT` retains all attempted proof consumers, bytes and receipts. Python, caches and HOME are owned outside that uploaded subtree.

The browser suite runs against the example's real AG-UI server (`src/server.py`), with model replies replayed by aimock from the fixtures shared with the Angular example (`cockpit/ag-ui/a2ui/angular/e2e/fixtures`). A local recording proxy (`scripts/react-cockpit/ag-ui-proxy.mjs`) records each agent POST with the real events and can hold, release or fail the next run; those controls exist only in local tests and are excluded from the application bundle and public Code assets.

The browser flow exercises Request, edited Search, Select and server-restored Modify. Native idle state and the original successful run plus matching root completion/transcript are necessary before presentation admission. Stop, error and New synchronously quarantine stale work. Historical form values remain read-only. Injected transport failures are labeled in the specs. Replayed model output does not establish live-provider behavior or full A2UI catalog support.
