from fastapi import FastAPI
from agent_framework_ag_ui import add_agent_framework_fastapi_endpoint

from .agent import agent
from .subagent_emitter import wrap_agent_run

app = FastAPI(title="cockpit-runtimes-microsoft-agent-framework")
# The wrapper is the SUBAGENT_* injection seam: the endpoint consumes
# protocol_runner.run, and wrap_agent_run merges the delegation tool's
# enqueued child events into that stream (src/subagent_emitter.py).
wrapped_agent = wrap_agent_run(agent)
add_agent_framework_fastapi_endpoint(app, wrapped_agent, path="/agent")


@app.get("/ok")
def ok() -> dict:
    return {"ok": True}
