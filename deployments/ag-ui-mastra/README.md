# ag-ui-mastra

Hand-written Node hosting service for the **Mastra** AG-UI runtime — Lane B of
the runtime-portability matrix (`docs/superpowers/plans/2026-08-31-runtime-portability-matrix.md`).

Upstream `@ag-ui/mastra` ships **no** plain AG-UI HTTP endpoint (only the
in-process `MastraAgent` bridge and a mount for its own chat frontend
runtime). This service is that missing endpoint: `POST /agent/<topic>` →
`MastraAgent.run(input)` → one SSE `data:` frame per AG-UI event. It is
deliberately hand-written, not generated: the Python generator
(`scripts/generate-ag-ui-deployment-config.ts`)
targets one aggregated FastAPI process, and Mastra is a different language and
hosting lane.

Unlike the Python lane (where each topic's backend lives in
`cockpit/<product>/<topic>/python` and is staged into `deployments/ag-ui-dev`),
the `mastra` topic's backend lives HERE (`agents.mjs`) — the registry entry
`rt-mastra` has no `pythonDir` on purpose.

## Contract (mirrors deployments/ag-ui-dev/server.py)

- `GET /ok` — unauthenticated health check.
- Every other route requires `X-Internal-Token: $AG_UI_INTERNAL_TOKEN`,
  else `401 {"detail":"unauthorized"}`. The service refuses to boot without
  the env var.
- `POST /agent/mastra` — AG-UI run endpoint (RunAgentInput JSON in, SSE out).
- An Observable error is mapped to a `RUN_ERROR` frame, never a dropped socket.

## Storage (required for suspend/resume)

Mastra persists memory and **suspended-run snapshots** to LibSQL file storage
(`AG_UI_MASTRA_DB_PATH`, default `./data/mastra.db`). Resume loads the
suspended snapshot back, so this path must be persistent:

- **Railway: mount a volume** (e.g. at `/data`) and set
  `AG_UI_MASTRA_DB_PATH=/data/mastra.db`. Without the volume, every redeploy
  or restart orphans pending interrupts.

## Local development (serves cockpit/runtimes/mastra)

```bash
cd deployments/ag-ui-mastra
npm ci
AG_UI_INTERNAL_TOKEN=dev-local-token \
  OPENAI_API_KEY=sk-... \
  PORT=5332 node server.mjs
```

Then in another terminal: `npx nx run cockpit-runtimes-mastra-angular:serve:cockpit --port 4332`
(or `npx tsx scripts/examples/serve-example.ts --capability=rt-mastra`,
which starts the Angular side; this Node service must be started manually as
above — the serve script only auto-starts Python backends). The example's
`proxy.conf.mjs` forwards `/agent` → `http://localhost:5332/agent/mastra` and
injects `X-Internal-Token: dev-local-token` (override via the
`AG_UI_INTERNAL_TOKEN` env var when serving with a different token).

Do NOT `source` the repo root `.env` — export only what you need. (A stray
`AG_UI_INTERNAL_TOKEN` mismatch between service and proxy manifests as bogus
401s that look like an OpenAI auth problem.)

## Tests

`npm test` runs transcript-shape tests: every surface's SSE event grammar is
asserted against the measured 2026-08-31 spike captures, and the
interrupt→resume round trip is driven through the real `@ag-ui/client` 0.0.59
(`devDependencies`) — the same client the Angular adapter wraps. The model is
a scripted OpenAI responses-API mock over owned loopback HTTP; no hosted model
or real key is used.

The shared test-only setup is `test/scripted-service.mjs`. It starts the local
model, chooses a temporary LibSQL path and dummy credentials, then dynamically
imports the unchanged service. Run one real service setup per standalone process:
the production module captures configuration at import. Cleanup closes owned
servers, removes the temporary database and restores the selected environment.
Startup and HTTP waits are bounded. The helper cannot cancel arbitrary module
evaluation or resources a custom loader creates outside its returned factory;
its cleanup contract covers the resources it allocates.

From the repository root, the separate native-owner proof is:

```sh
npm ci --prefix deployments/ag-ui-mastra --no-audit --no-fund
npm test --prefix deployments/ag-ui-mastra
node node_modules/typescript/bin/tsc -p scripts/react-parity/tsconfig.native-mastra.json
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.base.json scripts/react-parity/verify-native-mastra.ts
```

It uses the actual private Threadplane owner and this service's pinned bridge;
there is no client provider profile or interrupt-ID parser. The eight provider
POSTs prove resolved approval, `{ approved: false }` rejection, native cancellation,
and an accepted resume whose terminal is deliberately lost downstream. Tool
results establish execution; the scripted model's fixed “Booked” prose does not.
Physical response closure is required before cleanup. Fresh-thread memory warnings
from the pinned bridge can appear on stderr; the final JSON records proof results.

The bridge handles only the first resolved/cancelled entry. Resolved null/undefined
does not enter its resume branch. Literal false/native cancellation differs from
`{ approved: false }`; cancellation success does not prove durable snapshot
deletion. This is local Mastra/LibSQL interoperability, not a live model, remote
deployment, multi-interrupt, arbitrary-payload or safe-recovery guarantee.

## Deployment

`.github/workflows/deploy-ag-ui-mastra.yml` deploys to the Railway service
`ag-ui-mastra` on pushes to main that touch this directory. It mirrors the
ag-ui-dev boot gate: `npm ci` + `node --check` + a real boot (dummy token,
`curl /ok`) + `npm test` BEFORE `railway up --detach`, because `--detach`
reports success at upload time and would otherwise hide build/boot failures.

Railway service requirements (one-time setup):
- service name `ag-ui-mastra` in the same project as `ag-ui-dev`
- env vars: `AG_UI_INTERNAL_TOKEN` (same value the Vercel examples project
  uses), `OPENAI_API_KEY`, `AG_UI_MASTRA_DB_PATH=/data/mastra.db`
- a volume mounted at `/data`
- a public domain (its URL becomes `AG_UI_MASTRA_URL` on the Vercel examples
  project, read by `scripts/ag-ui-proxy.ts`)
