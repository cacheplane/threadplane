# Cockpit Module Contract

The `cockpit/` tree is product-first by design.

- product-first roots:
  - `cockpit/deep-agents/<capability>/<language>`
  - `cockpit/langgraph/<capability>/<language>`
- canonical identity stays aligned with the registry:
  - `product / section / topic / page / language`
- capability modules own runtime adapters and metadata
- docs-only entries stay in the shared manifest and website docs system

Every capability module should make the mapping between its product-first directory and the canonical registry identity explicit.

## E2E Coverage

Runnable cockpit Playwright specs live under `cockpit/<product>/<capability>/<angular|react>/e2e/` when the corresponding frontend project has an Nx `e2e` target with its own Playwright config and any required setup and fixtures. Consult that project's target and config for its harness and build prerequisites. Historical exploratory checks that are not wired into Nx live under `e2e/manual/` with a `.manual.ts` suffix until they are promoted to a configured target-backed suite.
