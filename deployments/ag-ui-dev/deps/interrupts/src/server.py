from fastapi import FastAPI
from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint
from .graph import graph
from .native_agent import NativeRefundAgent

agent = LangGraphAgent(name="interrupts", graph=graph)
app = FastAPI(title="cockpit-ag-ui-interrupts")
add_langgraph_fastapi_endpoint(app, agent, path="/agent")
native_agent = NativeRefundAgent(name="interrupts", graph=graph)
add_langgraph_fastapi_endpoint(app, native_agent, path="/agent/native")


@app.get("/ok")
def ok() -> dict:
    return {"ok": True}
