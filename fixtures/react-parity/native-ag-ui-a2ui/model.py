"""Deterministic model content only; graph schema, retry and envelope stay real."""
import json
from copy import deepcopy
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import Field


def component(identity, kind, **props):
    return {"id": identity, "component": kind, **props}


def specification(schema, messages, airports, fares):
    prompt = messages[0].content
    if schema == "BookingFormSpec":
        defaults = json.JSONDecoder().raw_decode(prompt.split("data_model MUST be ", 1)[1])[0]
        children = ["title", "origin", "dest", "date", "passengers", "fare", "submit"]
        rows = [component("root", "Column", children=["card"]), component("card", "Card", child="card_col"), component("card_col", "Column", children=children), component("title", "Text", text="Book a flight", variant="h2")]
        for identity, key, label, domain in [("origin", "origin", "Origin", airports), ("dest", "dest", "Destination", airports), ("fare", "fare_class", "Fare class", fares)]:
            rows.append(component(identity, "ChoicePicker", label=label, options=[{"label": value, "value": value} for value in domain], value={"path": "/" + key}, variant="mutuallyExclusive"))
        rows += [component("date", "DateTimeInput", label="Departure date (YYYY-MM-DD)", value={"path": "/date"}, enableDate=True), component("passengers", "TextField", label="Passengers", value={"path": "/passengers"}, variant="number"), component("submit", "Button", child="submit_label", variant="primary", action={"event": {"name": "bookingSubmit", "context": {"formId": "booking", **{key: {"path": "/" + key} for key in defaults}}}}), component("submit_label", "Text", text="Search flights")]
        return {"surface_id": "booking", "data_model": defaults, "components": rows}
    if schema == "FlightResultsSpec":
        flights = json.JSONDecoder().raw_decode(prompt.split("following flights:\n\n", 1)[1])[0]
        rows, cards = [], []
        for index, flight in enumerate(flights):
            suffix = str(index)
            cards.append("card_" + suffix)
            rows += [component("card_" + suffix, "Card", child="col_" + suffix), component("col_" + suffix, "Column", children=["title_" + suffix, "route_" + suffix, "time_" + suffix, "btn_" + suffix]), component("title_" + suffix, "Text", text=f'{flight["airline"]} flight {flight["flight_number"]}', variant="h3"), component("route_" + suffix, "Text", text=f'{flight["from"]} → {flight["to"]} • {flight["duration_min"]} min • {flight["aircraft"]}'), component("time_" + suffix, "Text", text=f'Depart {flight["depart_local"]} • Arrive {flight["arrive_local"]} • Gate {flight["gate"]}'), component("btn_" + suffix, "Button", child="btn_label_" + suffix, action={"event": {"name": "flightSelect", "context": {"flightId": flight["flight_number"]}}}), component("btn_label_" + suffix, "Text", text="Select")]
        if not cards:
            cards = ["empty"]
            rows = [component("empty", "Text", text="No flights found")]
        return {"surface_id": "results", "data_model": {}, "components": [component("root", "Column", children=cards), *rows]}
    if schema != "ConfirmationSpec":
        raise ValueError("Unexpected model schema")
    flight = json.JSONDecoder().raw_decode(prompt.split("lookup_flight():\n\n", 1)[1])[0]
    party = prompt.split("original booking submission): ", 1)[1].split("\n", 1)[0]
    rows = [component("root", "Column", children=["card"]), component("card", "Card", child="card_col"), component("card_col", "Column", children=["title", "route_text", "time_text", "gate_text", "party_text", "modify"]), component("title", "Text", text=f'{flight["airline"]} flight {flight["flight_number"]}', variant="h2"), component("route_text", "Text", text=f'{flight["from"]} → {flight["to"]} • {flight["aircraft"]}'), component("time_text", "Text", text=f'{flight["depart_local"]} → {flight["arrive_local"]}'), component("gate_text", "Text", text=f'Gate {flight["gate"]}'), component("party_text", "Text", text=party), component("modify", "Button", child="modify_label", action={"event": {"name": "modifySearch", "context": {"formId": "booking"}}}), component("modify_label", "Text", text="Modify search")]
    return {"surface_id": "confirmation", "data_model": {}, "components": rows}


class FixtureModel(BaseChatModel):
    title: bool = False
    airports: list[str] = Field(default_factory=list)
    fares: list[str] = Field(default_factory=list)
    traces: list = Field(default_factory=list)
    invalid_attempts: int = 0

    @property
    def _llm_type(self):
        return "offline-native-ag-ui-a2ui-content"

    def bind_tools(self, tools, **kwargs):
        schema = convert_to_openai_tool(tools[0])["function"]["name"]
        return self.bind(fixture_schema=schema)

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        schema = kwargs.get("fixture_schema")
        trace = {"schema": schema, "title": self.title, "messages": [m.model_dump(mode="json") for m in messages], "retry": any("Previous attempt failed schema validation" in str(m.content) for m in messages)}
        self.traces.append(trace)
        if self.title:
            trace["output"] = "Local booking title"
            yield ChatGenerationChunk(message=AIMessageChunk(content=trace["output"]))
            return
        value = specification(schema, messages, self.airports, self.fares)
        if self.invalid_attempts:
            self.invalid_attempts -= 1
            value["components"][0]["component"] = "UnsupportedFixtureComponent"
        trace["output"] = deepcopy(value)
        encoded = json.dumps(value)
        identity = "a2ui-model-call-" + str(len(self.traces))
        for index, fragment in enumerate([encoded[:len(encoded)//2], encoded[len(encoded)//2:]]):
            yield ChatGenerationChunk(message=AIMessageChunk(content="", tool_call_chunks=[{"name": schema if index == 0 else None, "args": fragment, "id": identity if index == 0 else None, "index": 0, "type": "tool_call_chunk"}]))

    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        for chunk in self._stream(messages, stop, run_manager, **kwargs):
            yield chunk

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        chunks = list(self._stream(messages, stop, run_manager, **kwargs))
        message = chunks[0].message
        for chunk in chunks[1:]:
            message += chunk.message
        return ChatResult(generations=[ChatGeneration(message=AIMessage(**{key: value for key, value in message.model_dump().items() if key not in ["type", "tool_call_chunks"]}))])


class Metadata:
    def __init__(self):
        self.rows, self.traces = {}, []

    async def get(self, thread_id):
        result = {"thread_id": thread_id, "metadata": deepcopy(self.rows.get(thread_id, {}))}
        self.traces.append({"op": "get", "threadId": thread_id, "result": deepcopy(result)})
        return result

    async def update(self, thread_id, metadata):
        self.rows[thread_id] = deepcopy(metadata)
        self.traces.append({"op": "update", "threadId": thread_id, "metadata": deepcopy(metadata)})
