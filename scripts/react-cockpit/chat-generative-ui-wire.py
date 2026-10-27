"""Persistent network-free worker executing the actual compiled Generative UI graph."""
import asyncio
from contextlib import redirect_stdout
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import traceback
from unittest.mock import patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"
ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "cockpit/chat/generative-ui/python"
sys.path.insert(0, str(PROJECT))
sys.path.insert(0, str(PROJECT / "tests"))
from test_streaming import LocalModel, call
from langchain_core.messages import AIMessage
from copy import deepcopy
from langchain_core.runnables import RunnableLambda
from langchain_core.tools import StructuredTool
from langgraph.prebuilt import ToolNode
from src.dashboard_contract import SLOT_TO_TOOL, bindings, resolve

PRODUCTION_SOURCES = ("src/graph.py", "src/dashboard_tools.py", "src/operations.py", "src/dashboard_contract.py", "prompts/generative-ui.md")

class Metadata:
    def __init__(self):
        self.titles = {}
        self.fail_read = False
        self.fail_write = False

    async def get(self, thread_id):
        if self.fail_read:
            raise RuntimeError("Metadata unavailable")
        return {"thread_id": thread_id, "metadata": self.titles.get(thread_id, {})}

    async def update(self, thread_id, metadata):
        if self.fail_write:
            raise RuntimeError("Metadata unavailable")
        self.titles[thread_id] = dict(metadata)

class AuthoredClient:
    def __init__(self):
        self.threads = Metadata()

from langgraph.checkpoint.memory import InMemorySaver


def encode(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    raise TypeError("Unsupported graph wire value")


def checkpoint(state, mapped=False):
    result = {
        "values": state.values, "next": list(state.next),
        "checkpoint": {k: v for k, v in state.config["configurable"].items() if k in ["thread_id", "checkpoint_ns", "checkpoint_id", "checkpoint_map"]},
        "parent_checkpoint": dict(state.parent_config["configurable"]) if state.parent_config else None,
        "created_at": state.created_at, "metadata": state.metadata,
        "tasks": [{"id": task.id, "name": task.name,
                   **({"error": task.error} if task.error is not None else {}),
                   "interrupts": [{"id": item.id, "value": item.value} for item in task.interrupts]}
                  for task in state.tasks],
    }
    if mapped:
        result["checkpoint"]["checkpoint_map"] = {"": result["checkpoint"]["checkpoint_id"]}
        if result["parent_checkpoint"]:
            result["parent_checkpoint"]["checkpoint_map"] = {"": result["parent_checkpoint"]["checkpoint_id"]}
    return result


async def main():
    client = AuthoredClient()
    options = {"fail_title": False, "mapped": False, "decisionFault": None,
               "partialDashboard": False, "failKpis": False, "malformedTrend": False,
               "prose_parent": False}
    callbacks = {"titleMessageCallbacks": 0, "decisionMessageCallbacks": 0, "interpretationMessageCallbacks": 0}
    agent_model, respond_model = LocalModel(), LocalModel()
    layout = json.loads((PROJECT / "prompts/generative-ui.md").read_text().split('For "show me the dashboard":')[1].strip())
    def model_factory(**kwargs):
        if kwargs.get("streaming"):
            model = agent_model if kwargs["model"] == "gpt-5" else respond_model
            model.tags = kwargs.get("tags", [])
            return model
        return LocalModel(responses=[AIMessage(id="title", content="Local dashboard title")], tags=kwargs.get("tags", []), fail=options["fail_title"])
    source = PROJECT / "src/graph.py"
    with patch.object(socket.socket, "connect", side_effect=AssertionError("Remote socket forbidden")) as connect, patch(
        "langchain_openai.ChatOpenAI", model_factory,
    ), patch("langgraph_sdk.get_client", return_value=client):
        with redirect_stdout(sys.stderr):
            spec = importlib.util.spec_from_file_location("authored_generative_ui_wire", source)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            # Explicit test-only node intervention proves the production wrapper's
            # nonempty-parent fallback. Normal decisions never supply parent prose.
            def fixture_admit(state):
                output = module.admit_operation(state)
                if options["prose_parent"] and output.get("messages"):
                    output["messages"][0] = output["messages"][0].model_copy(update={"content": "Here is the layout."})
                return output
            module.graph.builder.nodes["admit"].runnable = RunnableLambda(fixture_admit)
            graph = module.graph.builder.compile(checkpointer=InMemorySaver())
        for line in sys.stdin:
            request = json.loads(line)
            try:
                with redirect_stdout(sys.stderr):
                    config = {"configurable": {"thread_id": request.get("threadId", "")}}
                    if request.get("checkpoint"):
                        config["configurable"].update(request["checkpoint"])
                    if request["op"] == "state":
                        result = {"state": checkpoint(graph.get_state(config), options["mapped"])}
                    elif request["op"] == "history":
                        result = {"history": [checkpoint(state, options["mapped"]) for state in graph.get_state_history(config)]}
                    elif request["op"] == "configure":
                        agent_model.fail = request.get("failAgent", agent_model.fail)
                        client.threads.fail_read = request.get("failMetadata", False)
                        client.threads.fail_write = request.get("failWrite", False)
                        options["fail_title"] = request.get("failTitle", False)
                        options["mapped"] = request.get("mapped", options["mapped"])
                        for key in ("decisionFault", "partialDashboard", "failKpis", "malformedTrend"):
                            options[key] = request.get(key, options[key])
                        respond_model.fail = request.get("failInterpretation", respond_model.fail)
                        result = {}
                    elif request["op"] == "submit":
                        identity = request["messages"][0]["id"]
                        text = request["messages"][0]["content"].lower()
                        prior = graph.get_state(config).values
                        accepted = prior.get("_owned_layout")
                        spec_layout = deepcopy(layout)
                        options["prose_parent"] = "prose render" in text
                        if options["prose_parent"] and not accepted:
                            for element in spec_layout["elements"].values():
                                for key, value in element.get("props", {}).items():
                                    if isinstance(value, dict) and "$state" in value:
                                        element["props"][key] = None
                        elif options["partialDashboard"] and not accepted:
                            for element in spec_layout["elements"].values():
                                for key, value in element.get("props", {}).items():
                                    if isinstance(value, dict) and value.get("$state", "").split("/")[1] in ("on_time", "flights_today", "avg_delay", "load_factor", "on_time_trend"):
                                        element["props"][key] = None
                        if "cancelled" in text:
                            kind, batch = "data_update", [call("query_recent_disruptions", {"type": "cancelled"})]
                        elif "remove" in text or "structure" in text:
                            spec_layout = deepcopy(accepted or spec_layout)
                            if "table_section" in spec_layout["elements"]:
                                spec_layout["elements"]["root"]["children"].remove("table_section")
                                del spec_layout["elements"]["table_section"]
                            kind, batch = "restructure" if accepted else "create", [call("render_spec", spec_layout)]
                        elif "why" in text or "interpret" in text:
                            kind, batch = "interpret", []
                        else:
                            kind, batch = "restructure" if accepted else "create", [call("render_spec", spec_layout)]
                        if batch and batch[0]["name"] == "render_spec":
                            prior_data = prior.get("dashboard", {}) if accepted else {}
                            necessary = {SLOT_TO_TOOL[pointer.split("/")[1]] for pointer in bindings(spec_layout) if not resolve(pointer, prior_data)}
                            batch += [call(tool.name) for tool in module._DATA_TOOLS if tool.name in necessary]
                        selected = call("plan_dashboard_operation", {"kind": kind, "calls": [{"name": c["name"], "args": c["args"]} for c in batch], "interpretation": text if kind == "interpret" else ""})
                        if options["decisionFault"] == "invalid":
                            selected["args"]["calls"] = [{"name": "query_recent_disruptions", "args": {"type": "invented"}}]
                        agent_model.responses = [AIMessage(id=identity + "-decision", content="", tool_calls=[] if options["decisionFault"] == "missing" else [selected])]
                        agent_model.cursor = 0
                        respond_model.responses = [AIMessage(id=identity + "-interpretation", content="On-time performance needs operational context to explain.")]
                        respond_model.cursor = 0
                        def failed_kpis():
                            raise RuntimeError("Explicit local KPI tool failure")
                        def malformed_trend(months=12):
                            return [{"month": "Invalid", "on_time_pct": 101}]
                        tools = [module.render_spec, *module._DATA_TOOLS]
                        if options["failKpis"]:
                            tools = [StructuredTool.from_function(failed_kpis, name="query_airline_kpis", description="Test-only throwing KPI tool") if tool.name == "query_airline_kpis" else tool for tool in tools]
                        if options["malformedTrend"]:
                            tools = [StructuredTool.from_function(malformed_trend, name="query_on_time_trend", description="Test-only malformed trend tool") if tool.name == "query_on_time_trend" else tool for tool in tools]
                        module._tool_node = ToolNode(tools, handle_tool_errors="The dashboard tool failed.")
                        events = []
                        terminal_config = config
                        failure = False
                        try:
                            async for kind, event in graph.astream({"messages": request["messages"]}, config, stream_mode=["messages", "values", "updates", "custom", "checkpoints"]):
                                if kind == "messages":
                                    node, message = event[1].get("langgraph_node"), event[0]
                                    key = ("titleMessageCallbacks" if node == "generate_title" else
                                           "decisionMessageCallbacks" if node == "decide" else
                                           "interpretationMessageCallbacks" if message.id == identity + "-interpretation" else None)
                                    if key:
                                        callbacks[key] += 1
                                        raise AssertionError("Private model callbacks leaked into answer stream")
                                if kind == "checkpoints":
                                    if options["mapped"]:
                                        position = event["config"]["configurable"]
                                        position["checkpoint_map"] = {"": position["checkpoint_id"]}
                                    terminal_config = event["config"]
                                events.append([kind, deepcopy(event)])
                        except RuntimeError:
                            failure = True
                            events.append(["error", {"error": "GraphExecutionError", "message": "The conversation request failed."}])
                        result = {"events": events, "state": checkpoint(graph.get_state(terminal_config), options["mapped"]), "graphFailure": failure}
                    else:
                        raise ValueError("Unsupported graph operation")
                    connect.assert_not_called()
                result["proof"] = {
                    "actualCompiledGraph": True,
                    "op": request["op"], "threadId": request.get("threadId"),
                    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                    "lockSha256": hashlib.sha256((PROJECT / "uv.lock").read_bytes()).hexdigest(),
                    "productionSourceSha256": {path: hashlib.sha256((PROJECT / path).read_bytes()).hexdigest() for path in PRODUCTION_SOURCES},
                    "networkConnectAttempts": connect.call_count, **callbacks,
                    "fixtureControls": {key: options[key] for key in ("decisionFault", "partialDashboard", "failKpis", "malformedTrend", "prose_parent")},
                    "httpCheckpointRepresentation": "root-map" if options["mapped"] else "native",
                }
                result["requestId"] = request["requestId"]
                print(json.dumps(result, default=encode), flush=True)
            except Exception:
                traceback.print_exc(file=sys.stderr)
                print(json.dumps({"requestId": request["requestId"], "error": "Graph operation failed"}), flush=True)


asyncio.run(main())
