"""Offline booking-domain regressions for both canonical aviation graphs."""

import asyncio
from contextlib import ExitStack
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field, ValidationError


REPO_ROOT = Path(__file__).resolve().parents[5]
GRAPH_PATHS = (
    "cockpit/chat/a2ui/python/src/graph.py",
    "cockpit/ag-ui/a2ui/python/src/graph.py",
)


def load_graphs():
    modules = []
    for index, path in enumerate(GRAPH_PATHS):
        spec = importlib.util.spec_from_file_location(f"booking_graph_{index}", REPO_ROOT / path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    return modules


def form_payload(graph):
    # Sentinel options share canonical lists. Copy each component separately so
    # mutating origin cannot mutate dest or the graph's constants.
    form = graph._build_sentinel_booking_form(deepcopy(graph._BLANK_FORM_DEFAULTS))
    return {
        "surface_id": form.surface_id,
        "data_model": deepcopy(form.data_model),
        "components": [deepcopy(c.model_dump()) for c in form.components],
    }


def picker(payload, component_id):
    return next(c for c in payload["components"] if c["id"] == component_id)


def malformed_payload(graph):
    payload = form_payload(graph)
    picker(payload, "fare")["options"][0]["value"] = "Economomy"
    return payload


class RawToolCallModel(BaseChatModel):
    """Replace only provider generation; retain inherited structured parsing."""

    responses: list[dict]
    calls: list[list] = Field(default_factory=list)

    @property
    def _llm_type(self):
        return "offline-raw-booking-tool-calls"

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):
        return self.bind(tools=tools, tool_choice=tool_choice, **kwargs)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.calls.append(deepcopy(messages))
        schema = kwargs["tools"][0]
        response = self.responses[min(len(self.calls) - 1, len(self.responses) - 1)]
        message = AIMessage(content="", additional_kwargs={"tool_calls": [{
            "id": f"booking-{len(self.calls)}", "type": "function",
            "function": {"name": schema.__name__, "arguments": json.dumps(response)},
        }]})
        return ChatResult(generations=[ChatGeneration(message=message)])


class BookingFormTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.graphs = load_graphs()

    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name in ("socket.socket.connect", "socket.socket.connect_ex", "socket.create_connection", "socket.getaddrinfo"):
            self.stack.enter_context(patch(name, side_effect=AssertionError("Network forbidden in booking tests")))

    def test_valid_sentinel_and_flexible_option_order_and_labels(self):
        for graph in self.graphs:
            with self.subTest(graph=graph.__name__):
                payload = form_payload(graph)
                self.assertEqual(graph.BookingFormSpec.model_validate(payload).model_dump(), payload)
                for component_id in ("origin", "dest", "fare"):
                    options = picker(payload, component_id)["options"]
                    options.reverse()
                    for option in options:
                        option["label"] = f"Display {option['value']}"
                self.assertEqual(graph.BookingFormSpec.model_validate(payload).model_dump(), payload)

    def test_observed_economomy_typo_is_validation_error(self):
        for graph in self.graphs:
            with self.subTest(graph=graph.__name__):
                with self.assertRaisesRegex(ValidationError, "fare"):
                    graph.BookingFormSpec.model_validate(malformed_payload(graph))

    def test_invalid_option_domains_and_shapes_are_validation_errors(self):
        cases = {
            "missing-value": lambda options: options.pop(),
            "duplicate-value": lambda options: options.append(deepcopy(options[0])),
            "duplicate-replaces-value": lambda options: options[-1].update(value=options[0]["value"]),
            "foreign-value": lambda options: options[0].update(value="FOREIGN"),
            "integer-value": lambda options: options[0].update(value=1),
            "null-value": lambda options: options[0].update(value=None),
            "dict-value": lambda options: options[0].update(value={"invalid": "value"}),
            "list-value": lambda options: options[0].update(value=["invalid"]),
            "absent-value": lambda options: options[0].pop("value"),
            "integer-label": lambda options: options[0].update(label=1),
            "dict-label": lambda options: options[0].update(label={"path": "/label"}),
            "list-label": lambda options: options[0].update(label=[]),
            "absent-label": lambda options: options[0].pop("label"),
            "null-option": lambda options: options.__setitem__(0, None),
            "list-option": lambda options: options.__setitem__(0, []),
        }
        for graph in self.graphs:
            for component_id in ("origin", "dest", "fare"):
                for name, mutate in cases.items():
                    with self.subTest(graph=graph.__name__, picker=component_id, case=name):
                        payload = form_payload(graph)
                        mutate(picker(payload, component_id)["options"])
                        with self.assertRaises(ValidationError):
                            graph.BookingFormSpec.model_validate(payload)
                for options in (None, {}, "options", [], ["option"]):
                    with self.subTest(graph=graph.__name__, picker=component_id, options=options):
                        payload = form_payload(graph)
                        picker(payload, component_id)["options"] = options
                        with self.assertRaises(ValidationError):
                            graph.BookingFormSpec.model_validate(payload)

    def test_picker_identity_binding_and_cardinality_are_validated(self):
        for graph in self.graphs:
            for component_id in ("origin", "dest", "fare"):
                for binding in (None, "/origin", {}, {"path": "/foreign"}, {"path": []}, {"path": {}}, {"path": 1}):
                    with self.subTest(graph=graph.__name__, picker=component_id, binding=binding):
                        payload = form_payload(graph)
                        picker(payload, component_id)["value"] = binding
                        with self.assertRaises(ValidationError):
                            graph.BookingFormSpec.model_validate(payload)
                for change in ("missing", "duplicate", "renamed", "wrong-type", "absent-binding"):
                    with self.subTest(graph=graph.__name__, picker=component_id, change=change):
                        payload = form_payload(graph)
                        component = picker(payload, component_id)
                        if change == "missing":
                            payload["components"].remove(component)
                        elif change == "duplicate":
                            payload["components"].append(deepcopy(component))
                        elif change == "renamed":
                            component["id"] = "other"
                        elif change == "wrong-type":
                            component["component"] = "TextField"
                        else:
                            component.pop("value")
                        with self.assertRaises(ValidationError):
                            graph.BookingFormSpec.model_validate(payload)
            with self.subTest(graph=graph.__name__, change="extra-binding"):
                payload = form_payload(graph)
                extra = deepcopy(picker(payload, "origin"))
                extra["id"] = "other"
                payload["components"].append(extra)
                with self.assertRaises(ValidationError):
                    graph.BookingFormSpec.model_validate(payload)
            with self.subTest(graph=graph.__name__, change="swapped-bindings"):
                payload = form_payload(graph)
                picker(payload, "origin")["value"], picker(payload, "dest")["value"] = {"path": "/dest"}, {"path": "/origin"}
                with self.assertRaises(ValidationError):
                    graph.BookingFormSpec.model_validate(payload)

    def test_raw_tool_parsing_retries_once_with_validation_feedback(self):
        self.assertIs(RawToolCallModel.with_structured_output, BaseChatModel.with_structured_output)
        for graph in self.graphs:
            with self.subTest(graph=graph.__name__):
                valid = form_payload(graph)
                model = RawToolCallModel(responses=[malformed_payload(graph), valid])
                with patch.object(graph, "_llm", model), self.assertLogs(graph._logger, level="WARNING"):
                    result = asyncio.run(graph._emit_with_retry(graph.BookingFormSpec, [HumanMessage(content="Book a flight")]))
                self.assertIsInstance(result, graph.BookingFormSpec)
                self.assertEqual(result.model_dump(), valid)
                self.assertEqual(len(model.calls), 2)
                self.assertEqual(len(model.calls[0]), 1)
                self.assertEqual(len(model.calls[1]), 2)
                self.assertIn("Previous attempt failed schema validation", model.calls[1][-1].content)
                self.assertIn("fare", model.calls[1][-1].content)

    def test_build_form_exhausts_three_raw_calls_and_preserves_fallback_defaults(self):
        prior = {"origin": ["SFO"], "dest": ["SEA"], "date": "2026-11-20", "passengers": 3, "fare_class": ["Business"]}
        histories = (
            ("blank", [HumanMessage(content="Book a flight")], {"origin": [], "dest": [], "date": "", "passengers": 1, "fare_class": ["Economy"]}),
            ("seeded", [HumanMessage(content="I want to fly LAX to JFK")], {"origin": ["LAX"], "dest": ["JFK"], "date": "", "passengers": 1, "fare_class": ["Economy"]}),
            ("prior", [HumanMessage(content=json.dumps({"action": {"name": "bookingSubmit", "context": prior}})), HumanMessage(content=json.dumps({"action": {"name": "modifySearch", "context": {"formId": "booking"}}}))], prior),
        )
        for graph in self.graphs:
            constants_before = deepcopy((graph._AIRPORT_OPTIONS, graph._FARE_OPTIONS, graph._BLANK_FORM_DEFAULTS))
            for name, messages, expected in histories:
                with self.subTest(graph=graph.__name__, history=name):
                    model = RawToolCallModel(responses=[malformed_payload(graph)])
                    with patch.object(graph, "_llm", model), self.assertLogs(graph._logger, level="WARNING") as logged:
                        result = asyncio.run(graph.build_form({"messages": messages}))
                    self.assertEqual(len(model.calls), 3)
                    self.assertEqual(len(logged.records), 4)
                    self.assertIn("Falling back to sentinel booking form", logged.records[-1].getMessage())
                    for call in model.calls[1:]:
                        self.assertIn("Previous attempt failed schema validation", call[-1].content)
                    expected_spec = graph._build_sentinel_booking_form(deepcopy(expected))
                    self.assertEqual(result["messages"][0].content, graph._wrap_envelopes(expected_spec))
                    envelopes = [json.loads(line) for line in result["messages"][0].content.splitlines()[1:]]
                    self.assertEqual(envelopes[-1]["updateDataModel"]["value"], expected)
                    self.assertIn(json.dumps(expected), model.calls[0][0].content)
            self.assertEqual((graph._AIRPORT_OPTIONS, graph._FARE_OPTIONS, graph._BLANK_FORM_DEFAULTS), constants_before)


if __name__ == "__main__":
    unittest.main()
