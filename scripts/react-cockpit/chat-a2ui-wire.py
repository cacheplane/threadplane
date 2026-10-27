"""Private network-free fixture for the unchanged current c-a2ui graph."""
import asyncio
from contextlib import redirect_stdout
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import traceback
from unittest.mock import patch

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.utils.function_calling import convert_to_openai_tool
from langgraph.checkpoint.memory import InMemorySaver

ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "cockpit/chat/a2ui/python"
SOURCE = PROJECT / "src/graph.py"
OPTIONS = {"failTitle": False, "invalidAttempts": 0}
EVIDENCE = {"models": [], "tools": []}


def component(identity, kind, **props):
    return {"id": identity, "component": kind, **props}


def specification(schema, messages):
    """Deterministic model responses from actual production prompts, not nodes."""
    prompt = messages[0].content
    if schema == "BookingFormSpec":
        defaults = json.JSONDecoder().raw_decode(prompt.split("data_model MUST be ", 1)[1])[0]
        children = ["title", "origin", "dest", "date", "passengers", "fare", "submit"]
        components = [component("root", "Column", children=["card"]), component("card", "Card", child="card_col"), component("card_col", "Column", children=children), component("title", "Text", text="Book a flight", variant="h2")]
        for identity, key, label, values in [("origin", "origin", "Origin", module.AIRPORT_CODES), ("dest", "dest", "Destination", module.AIRPORT_CODES), ("fare", "fare_class", "Fare class", module.FARE_CLASSES)]:
            components.append(component(identity, "ChoicePicker", label=label, options=[{"label": value, "value": value} for value in values], value={"path": "/" + key}, variant="mutuallyExclusive"))
        components += [component("date", "DateTimeInput", label="Departure date (YYYY-MM-DD)", value={"path": "/date"}, enableDate=True), component("passengers", "TextField", label="Passengers", value={"path": "/passengers"}, variant="number"), component("submit", "Button", child="submit_label", variant="primary", action={"event": {"name": "bookingSubmit", "context": {"formId": "booking", **{key: {"path": "/" + key} for key in defaults}}}}), component("submit_label", "Text", text="Search flights")]
        return {"surface_id": "booking", "data_model": defaults, "components": components}
    if schema == "FlightResultsSpec":
        flights = json.JSONDecoder().raw_decode(prompt.split("following flights:\n\n", 1)[1])[0]
        components, cards = [], []
        for index, flight in enumerate(flights):
            key = str(index)
            cards.append("card_" + key)
            components += [component("card_" + key, "Card", child="col_" + key), component("col_" + key, "Column", children=["title_" + key, "route_" + key, "time_" + key, "btn_" + key]), component("title_" + key, "Text", text=f'{flight["airline"]} flight {flight["flight_number"]}', variant="h3"), component("route_" + key, "Text", text=f'{flight["from"]} → {flight["to"]}  •  {flight["duration_min"]} min  •  {flight["aircraft"]}', variant="body"), component("time_" + key, "Text", text=f'Depart {flight["depart_local"]}  •  Arrive {flight["arrive_local"]}  •  Gate {flight["gate"]}', variant="caption"), component("btn_" + key, "Button", child="btn_label_" + key, variant="primary", action={"event": {"name": "flightSelect", "context": {"flightId": flight["flight_number"]}}}), component("btn_label_" + key, "Text", text="Select")]
        if not cards:
            cards = ["empty"]
            components = [component("empty", "Text", text="No flights found"), component("modify", "Button", child="modify_label", action={"event": {"name": "modifySearch", "context": {"formId": "booking"}}}), component("modify_label", "Text", text="Modify search")]
            cards += ["modify"]
        return {"surface_id": "results", "data_model": {}, "components": [component("root", "Column", children=cards), *components]}
    flight = json.JSONDecoder().raw_decode(prompt.split("lookup_flight():\n\n", 1)[1])[0]
    party = prompt.split("original booking submission): ", 1)[1].split("\n", 1)[0]
    return {"surface_id": "confirmation", "data_model": {}, "components": [component("root", "Column", children=["card"]), component("card", "Card", child="card_col"), component("card_col", "Column", children=["title", "party_text", "modify"]), component("title", "Text", text=f'{flight["airline"]} flight {flight["flight_number"]}', variant="h2"), component("party_text", "Text", text=party, variant="body"), component("modify", "Button", child="modify_label", variant="primary", action={"event": {"name": "modifySearch", "context": {"formId": "booking"}}}), component("modify_label", "Text", text="Modify search")]}


class FixtureModel(BaseChatModel):
    title: bool = False

    @property
    def _llm_type(self):
        return "local-c-a2ui-fixture"

    def bind_tools(self, tools, **kwargs):
        schema = convert_to_openai_tool(tools[0])["function"]["name"]
        return self.bind(fixture_schema=schema)

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        schema = kwargs.get("fixture_schema")
        EVIDENCE["models"].append({"schema": schema, "title": self.title, "retry": len(messages) > 1 and "Previous attempt failed" in messages[-1].content})
        if self.title:
            if OPTIONS["failTitle"]:
                raise RuntimeError("Fixture title failure")
            yield ChatGenerationChunk(message=AIMessageChunk(content="Local booking title"))
            return
        value = specification(schema, messages)
        if OPTIONS["invalidAttempts"]:
            OPTIONS["invalidAttempts"] -= 1
            value["components"][0]["component"] = "UnsupportedFixtureComponent"
        text = json.dumps(value)
        for index, fragment in enumerate([text[:len(text)//2], text[len(text)//2:]]):
            yield ChatGenerationChunk(message=AIMessageChunk(content="", tool_call_chunks=[{"name": schema if index == 0 else None, "args": fragment, "id": "fixture-call-" + str(len(EVIDENCE["models"])) if index == 0 else None, "index": 0, "type": "tool_call_chunk"}]))

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        chunks = list(self._stream(messages, stop, run_manager, **kwargs))
        message = chunks[0].message
        for chunk in chunks[1:]:
            message += chunk.message
        return ChatResult(generations=[ChatGeneration(message=AIMessage(**{key: value for key, value in message.model_dump().items() if key not in ["type", "tool_call_chunks"]}))])


class Metadata:
    def __init__(self):
        self.rows = {}

    async def get(self, thread_id):
        return {"thread_id": thread_id, "metadata": self.rows.get(thread_id, {})}

    async def update(self, thread_id, metadata):
        self.rows[thread_id] = dict(metadata)


class FixtureChatOpenAI(FixtureModel):
    def __init__(self, **kwargs):
        super().__init__(title=kwargs.get("model") == "gpt-5-mini")


def encode(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    raise TypeError("Unsupported wire value")


def checkpoint(state):
    return {"values": state.values, "next": list(state.next), "checkpoint": {key: value for key, value in state.config["configurable"].items() if key in ["thread_id", "checkpoint_id", "checkpoint_ns", "checkpoint_map"]}, "parent_checkpoint": state.parent_config["configurable"] if state.parent_config else None, "created_at": state.created_at, "metadata": state.metadata, "tasks": [{"id": task.id, "name": task.name, **({"error": task.error} if task.error is not None else {}), "interrupts": [{"id": item.id, "value": item.value} for item in task.interrupts], **({"state": task.state} if task.state is not None else {})} for task in state.tasks]}


def profile(frame, event, arg):
    if event == "return" and frame.f_code.co_filename == str(SOURCE) and frame.f_code.co_name in ["_find_routes_impl", "_lookup_flight_impl"]:
        EVIDENCE["tools"].append({"name": frame.f_code.co_name, "args": deepcopy({key: frame.f_locals[key] for key in frame.f_code.co_varnames[:frame.f_code.co_argcount]}), "output": deepcopy(arg)})


async def main():
    global module
    client = type("LocalClient", (), {"threads": Metadata()})()
    with patch.object(socket.socket, "connect", side_effect=AssertionError("Socket connect forbidden")) as connect, patch.object(socket.socket, "connect_ex", side_effect=AssertionError("Socket connect forbidden")) as connect_ex, patch("langchain_openai.ChatOpenAI", FixtureChatOpenAI), patch("langgraph_sdk.get_client", return_value=client):
        with redirect_stdout(sys.stderr):
            spec = importlib.util.spec_from_file_location("actual_c_a2ui_graph", SOURCE)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            graph = module.graph.builder.compile(checkpointer=InMemorySaver())
        for line in sys.stdin:
            request = {}
            try:
                if len(line.encode()) > 1024 * 1024:
                    raise ValueError("Request bound")
                request = json.loads(line)
                config = {"configurable": {"thread_id": request.get("threadId", ""), **request.get("checkpoint", {})}}
                EVIDENCE["tools"].clear()
                EVIDENCE["models"].clear()
                with redirect_stdout(sys.stderr):
                    if request["op"] == "configure":
                        OPTIONS.update(request["options"])
                        result = {}
                    elif request["op"] == "state":
                        result = {"state": checkpoint(graph.get_state(config))}
                    elif request["op"] == "history":
                        result = {"history": [checkpoint(state) for state in graph.get_state_history(config)]}
                    elif request["op"] == "submit":
                        events, failed = [], False
                        sys.setprofile(profile)
                        try:
                            async for kind, value in graph.astream({"messages": request["messages"]}, config, stream_mode=["messages", "values", "updates", "checkpoints"]):
                                events.append([kind, deepcopy(value)])
                        except Exception as error:
                            failed = True
                            events.append(["error", {"error": type(error).__name__, "message": str(error)}])
                        finally:
                            sys.setprofile(None)
                        result = {"events": events, "graphFailure": failed, "state": checkpoint(graph.get_state(config))}
                    else:
                        raise ValueError("Unsupported operation")
                result["proof"] = {"actualCompiledGraph": True, "pythonPid": os.getpid(), "pythonExecutable": str(Path(sys.executable).resolve()), "pythonVersion": sys.version.split()[0], "nodes": sorted(graph.nodes), "op": request["op"], "threadId": request.get("threadId"), "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(), "lockSha256": hashlib.sha256((PROJECT / "uv.lock").read_bytes()).hexdigest(), "networkConnectAttempts": connect.call_count + connect_ex.call_count, **deepcopy(EVIDENCE)}
                if connect.call_count or connect_ex.call_count:
                    raise AssertionError("Network attempted")
                result["requestId"] = request["requestId"]
                encoded = json.dumps(result, default=encode)
                if len(encoded.encode()) > 16 * 1024 * 1024:
                    raise ValueError("Response bound")
                print(encoded, flush=True)
            except Exception:
                traceback.print_exc(file=sys.stderr)
                print(json.dumps({"requestId": request.get("requestId"), "error": "Graph fixture operation failed"}), flush=True)


asyncio.run(main())
