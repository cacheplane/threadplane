# GENERATED — do not edit. Source: scripts/generate-ag-ui-deployment-config.ts
# Multi-topic AG-UI FastAPI server. Aggregates each AG-UI-served python topic
# (cockpit/ag-ui/*/python and cockpit/runtimes/*/python) at /agent/<topic>.
# Health route /ok is unauthenticated; /agent/* requires X-Internal-Token
# matching the AG_UI_INTERNAL_TOKEN env var.
import os
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from ag_ui_langgraph import add_langgraph_fastapi_endpoint, LangGraphAgent
from ag_ui_strands import add_strands_fastapi_endpoint

from deps.a2ui.src.graph import graph as a2ui_graph
from deps.aws_strands.src.agent import agent as aws_strands_agent
from deps.client_tools.src.graph import graph as client_tools_graph
from deps.interrupts.src.graph import graph as interrupts_graph
from deps.interrupts.src.native_agent import NativeRefundAgent
from deps.json_render.src.graph import graph as json_render_graph
from deps.streaming.src.graph import graph as streaming_graph
from deps.subagents.src.graph import graph as subagents_graph
from deps.subagents.src.streaming.subagent_emitting_agent import SubagentEmittingAgent
from deps.tool_views.src.graph import graph as tool_views_graph

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


add_langgraph_fastapi_endpoint(
    app,
    LangGraphAgent(name="a2ui", graph=a2ui_graph),
    path="/agent/a2ui",
)
add_strands_fastapi_endpoint(
    app,
    aws_strands_agent,
    "/agent/aws-strands",
)
add_langgraph_fastapi_endpoint(
    app,
    LangGraphAgent(name="client-tools", graph=client_tools_graph),
    path="/agent/client-tools",
)
add_langgraph_fastapi_endpoint(
    app,
    LangGraphAgent(name="interrupts", graph=interrupts_graph),
    path="/agent/interrupts",
)

add_langgraph_fastapi_endpoint(
    app,
    NativeRefundAgent(name="interrupts", graph=interrupts_graph),
    path="/agent/interrupts/native",
)
add_langgraph_fastapi_endpoint(
    app,
    LangGraphAgent(name="json-render", graph=json_render_graph),
    path="/agent/json-render",
)
add_langgraph_fastapi_endpoint(
    app,
    LangGraphAgent(name="streaming", graph=streaming_graph),
    path="/agent/streaming",
)
add_langgraph_fastapi_endpoint(
    app,
    SubagentEmittingAgent(name="subagents", graph=subagents_graph),
    path="/agent/subagents",
)
add_langgraph_fastapi_endpoint(
    app,
    LangGraphAgent(name="tool-views", graph=tool_views_graph),
    path="/agent/tool-views",
)
