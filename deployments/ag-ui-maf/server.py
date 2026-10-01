# GENERATED — do not edit. Source: scripts/generate-ag-ui-deployment-config.ts
# Multi-topic AG-UI FastAPI server. Aggregates each AG-UI-served python topic
# (cockpit/ag-ui/*/python and cockpit/runtimes/*/python) at /agent/<topic>.
# Health route /ok is unauthenticated; /agent/* requires X-Internal-Token
# matching the AG_UI_INTERNAL_TOKEN env var.
import os
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from agent_framework_ag_ui import add_agent_framework_fastapi_endpoint

from deps.microsoft_agent_framework.src.agent import agent as microsoft_agent_framework_agent

AG_UI_INTERNAL_TOKEN = os.environ["AG_UI_INTERNAL_TOKEN"]

app = FastAPI(title="ag-ui-dev")


@app.middleware("http")
async def require_internal_token(request: Request, call_next):
    # NOTE: HTTPException raised inside a Starlette BaseHTTPMiddleware bubbles
    # past FastAPI's handler and surfaces as 500. Return a JSONResponse
    # directly instead — that's the only way to emit a proper 4xx from here.
    if request.url.path == "/ok":
        return await call_next(request)
    if request.headers.get("x-internal-token") != AG_UI_INTERNAL_TOKEN:
        return JSONResponse(status_code=401, content={"detail": "unauthorized"})
    return await call_next(request)


@app.get("/ok")
def ok() -> dict:
    return {"ok": True}


add_agent_framework_fastapi_endpoint(
    app,
    microsoft_agent_framework_agent,
    path="/agent/microsoft-agent-framework",
)
