# ag-ui-maf

FastAPI app hosting the Microsoft Agent Framework runtime on Railway, separately
from `ag-ui-dev`.

Why separate: `agent-framework-ag-ui` 1.4.0 declares `ag-ui-protocol>=0.1.19,<0.2`,
while every LangGraph and Strands runtime is on `ag-ui-protocol` 1.0.0. One Python
process cannot import both, so the generator (`scripts/generate-ag-ui-deployment-config.ts`)
writes this directory from the `microsoft-agent-framework` topic alone. When
Microsoft publishes an integration that accepts 1.0, delete this directory, drop
its entry from `DEPLOYMENTS` in the generator, and remove the `AG_UI_MAF_URL` route
in `scripts/ag-ui-proxy.ts`.

| File / dir | Source | Edit? |
| --- | --- | --- |
| `Dockerfile`, `entrypoint.sh`, `railway.json`, `README.md` | hand-written | yes |
| `server.py`, `requirements.txt`, `deps/` | generated | no |

Regenerate with `npx tsx scripts/generate-ag-ui-deployment-config.ts` (writes both deployments).
Railway service name: `ag-ui-maf`. The Vercel proxy reads its URL from `AG_UI_MAF_URL`.
