"""
A2UI Aviation Booking Form Graph

LLM-authored A2UI surfaces:
- build_form: emits a flight-booking form via gpt-5 with structured output
- search_flights: post-submit, calls find_routes() and emits a results surface

Both surfaces are constrained by Pydantic schemas (A2uiComponent +
BookingFormSpec / FlightResultsSpec) and validated; on ValidationError,
the LLM is re-prompted with the error up to 2 retries. After 3 total
attempts, a hardcoded sentinel form is emitted so the demo doesn't 500.

This replaces the prior hardcoded contact-form implementation. The
prior file's claim that "LLMs cannot reliably emit A2UI JSONL" is
disproven by schema-constrained structured output — the LLM authors
the components list, code wraps it in the deterministic envelope keys.
"""

import json
import logging
import os
import re
from typing import Any, Literal

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command
from langgraph_sdk import get_client
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator


# Inlined flight fixtures - standalone has no aviation_data module.
_FLIGHTS = [
    {"flight_number": "UA123", "airline": "UA", "from": "LAX", "to": "JFK",
     "depart_local": "08:00", "arrive_local": "16:30", "duration_min": 330,
     "status": "on_time", "gate": "B14", "aircraft": "Boeing 787"},
    {"flight_number": "AA456", "airline": "AA", "from": "JFK", "to": "LAX",
     "depart_local": "10:00", "arrive_local": "13:30", "duration_min": 390,
     "status": "on_time", "gate": "T5-22", "aircraft": "Boeing 777"},
    {"flight_number": "DL789", "airline": "DL", "from": "ATL", "to": "ORD",
     "depart_local": "07:15", "arrive_local": "08:45", "duration_min": 150,
     "status": "delayed", "gate": "A12", "aircraft": "Airbus A320"},
    {"flight_number": "B6101", "airline": "B6", "from": "BOS", "to": "MIA",
     "depart_local": "06:30", "arrive_local": "10:15", "duration_min": 225,
     "status": "on_time", "gate": "C8", "aircraft": "Airbus A321"},
    {"flight_number": "UA204", "airline": "UA", "from": "SFO", "to": "SEA",
     "depart_local": "09:00", "arrive_local": "11:00", "duration_min": 120,
     "status": "on_time", "gate": "F11", "aircraft": "Boeing 737"},
]


class _AsyncFn:
    def __init__(self, fn):
        self._fn = fn

    async def ainvoke(self, args):
        return self._fn(**args)


def _find_routes_impl(from_code, to_code, date_offset_days=0):
    return [f for f in _FLIGHTS if f["from"] == from_code and f["to"] == to_code]


find_routes = _AsyncFn(_find_routes_impl)


def _lookup_flight_impl(flight_number: str) -> dict | None:
    """Inline mirror of aviation_tools.lookup_flight for the standalone."""
    return next((f for f in _FLIGHTS if f["flight_number"] == flight_number), None)


lookup_flight = _AsyncFn(_lookup_flight_impl)

_logger = logging.getLogger(__name__)

A2UI_PREFIX = "---a2ui_JSON---"

# 10 IATA airports from aviation_data.py
AIRPORT_CODES = ["LAX", "JFK", "SFO", "ORD", "BOS", "ATL", "DFW", "SEA", "MIA", "DEN"]
FARE_CLASSES = ["Economy", "Premium", "Business", "First"]

# Catalog component names — A2UI v0.9 basic catalog
# (https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json).
# `component` must be one of these names; an unknown name renders nothing
# visible — silent failure mode, hence the field_validator below.
ALLOWED_COMPONENTS = frozenset({
    "AudioPlayer", "Button", "Card", "CheckBox", "ChoicePicker", "Column",
    "DateTimeInput", "Divider", "Icon", "Image", "List", "Modal", "Row",
    "Slider", "Tabs", "Text", "TextField", "Video",
})


# ── Pydantic schemas ────────────────────────────────────────────────────────

# region component-schema
class A2uiComponent(BaseModel):
    """Single A2UI v0.9 updateComponents entry.

    Components are FLAT — the catalog component name is the `component`
    string field and the per-component props sit at the top level of the
    same object:
        {id: "name_field", component: "TextField",
         label: "Name", value: {path: "/name"}}

    Dynamic values are bare literals or {"path": "/json/pointer"} bindings.
    Children are plain id arrays (or {path, componentId} templates).
    Actions are {"event": {"name": "...", "context": {...}}} where context
    is a plain object.

    Key per-component notes the LLM must respect:
      Card({child: "<id>"})                        — single child only
      Button({child: "<text-id>", action: {...}})  — child is a Text id (label)
      Column/Row/List({children: ["id1", "id2"]})
      TextField({label, value: {path:"/p"}, variant: "shortText"|"number"|...})
      ChoicePicker({label, options:[{label,value}], value:{path}, variant:"mutuallyExclusive"})
      DateTimeInput({label, value:{path:"/p"}, enableDate: true})
      Text({text: "literal or {path:'/p'}", variant?: "h1"|"h2"|"body"|...})
      Divider({})
    """
    model_config = {"extra": "allow"}

    id: str
    component: str = Field(
        description=(
            "Catalog component name. Must be one of: "
            + ", ".join(sorted(ALLOWED_COMPONENTS))
        ),
    )

    @field_validator("component")
    @classmethod
    def _known_component(cls, v: str) -> str:
        if v not in ALLOWED_COMPONENTS:
            raise ValueError(
                f"component '{v}' not in catalog. Allowed: {sorted(ALLOWED_COMPONENTS)}"
            )
        return v
# endregion


# region surface-spec
class _SurfaceSpec(BaseModel):
    """Common shape — both booking and results surfaces produce the same
    triple (surface_id, data_model, components)."""
    surface_id: str = Field(description="Surface id. Use 'booking' for the form, 'results' for flights.")
    data_model: dict[str, Any] = Field(description="Initial form/state values, e.g. prefills.")
    components: list[A2uiComponent]


class BookingFormSpec(_SurfaceSpec):
    @model_validator(mode="after")
    def _booking_picker_domains(self) -> "BookingFormSpec":
        for component_id, path, domain in (
            ("origin", "/origin", AIRPORT_CODES),
            ("dest", "/dest", AIRPORT_CODES),
            ("fare", "/fare_class", FARE_CLASSES),
        ):
            # Count both the intended id and any picker claiming its binding.
            # Inspect extras before comparing domains: malformed values may be
            # dictionaries/lists, and must raise ValidationError, not TypeError.
            matches = []
            for component in self.components:
                binding = getattr(component, "value", None)
                if component.id == component_id or (
                    component.component == "ChoicePicker"
                    and isinstance(binding, dict)
                    and binding.get("path") == path
                ):
                    matches.append(component)
            if len(matches) != 1:
                raise ValueError(
                    f"Booking picker '{component_id}' must occur exactly once "
                    f"as ChoicePicker bound to {path}"
                )
            component = matches[0]
            binding = getattr(component, "value", None)
            if (
                component.id != component_id
                or component.component != "ChoicePicker"
                or not isinstance(binding, dict)
                or binding.get("path") != path
            ):
                raise ValueError(
                    f"Booking picker '{component_id}' must be a ChoicePicker "
                    f"with value={{'path': '{path}'}}"
                )
            options = getattr(component, "options", None)
            if not isinstance(options, list) or any(
                not isinstance(option, dict)
                or not isinstance(option.get("label"), str)
                or not isinstance(option.get("value"), str)
                for option in options
            ):
                raise ValueError(
                    f"Booking picker '{component_id}' options must be a list "
                    "of objects with string labels and values"
                )
            values = [option["value"] for option in options]
            if len(values) != len(domain) or set(values) != set(domain):
                raise ValueError(
                    f"Booking picker '{component_id}' must contain each value "
                    f"exactly once from {domain}; got {values}"
                )
        return self


class FlightResultsSpec(_SurfaceSpec):
    pass


class ConfirmationSpec(_SurfaceSpec):
    """Booking confirmation surface — selected flight + prior party context."""
    pass
# endregion


# ── Envelope wrapping ───────────────────────────────────────────────────────

# region envelope-wrapping
# A2UI v0.9 wire format (a2ui.org server_to_client.json): every envelope
# carries "version": "v0.9". Order matters: createSurface first (surfaceId +
# catalogId), then updateComponents (flat components; exactly one has id
# "root", which is the root of the tree), then updateDataModel (path + value)
# as needed. There is no beginRendering envelope in v0.9.

CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"


def _wrap_envelopes(spec: _SurfaceSpec) -> str:
    """Wrap a validated SurfaceSpec into A2UI v0.9 JSONL."""
    lines = [
        json.dumps({"version": "v0.9", "createSurface": {
            "surfaceId": spec.surface_id,
            "catalogId": CATALOG_ID,
        }}),
        json.dumps({"version": "v0.9", "updateComponents": {
            "surfaceId": spec.surface_id,
            "components": [c.model_dump(exclude_none=True) for c in spec.components],
        }}),
    ]
    if spec.data_model:
        lines.append(json.dumps({"version": "v0.9", "updateDataModel": {
            "surfaceId": spec.surface_id,
            "path": "/",
            "value": spec.data_model,
        }}))
    return A2UI_PREFIX + "\n" + "\n".join(lines) + "\n"
# endregion


# ── LLM + retry ─────────────────────────────────────────────────────────────

# gpt-5 with low reasoning effort: PR #372 established gpt-5 follows
# directive precisely; "low" gives slightly more headroom than "minimal"
# for schema compliance.
_llm: ChatOpenAI | None = None


def _get_llm() -> ChatOpenAI:
    """Lazy-initialize the LLM so imports succeed without OPENAI_API_KEY set."""
    global _llm
    if _llm is None:
        _llm = ChatOpenAI(
            model="gpt-5",
            streaming=True,
            reasoning_effort="low",
        )
    return _llm


async def _emit_with_retry(
    spec_cls: type[_SurfaceSpec],
    base_messages: list[Any],
    max_attempts: int = 3,
) -> _SurfaceSpec:
    """Call the LLM with structured output, retrying on validation failure.

    Each retry re-injects the error message so the model has a chance
    to correct its output. After max_attempts, raises RuntimeError.
    """
    # method="function_calling" is required because our schema uses
    # `dict[str, Any]` fields (value/selected/checked/checks/action) for
    # A2UI binding payloads. OpenAI's default strict structured-output mode
    # demands additionalProperties=false on every nested object and rejects
    # open dicts. Function-calling mode is more flexible and the model
    # still adheres to the rest of the schema (especially the Literal[...]
    # on component type, which is the actual safety gate we need).
    llm = _get_llm().with_structured_output(spec_cls, method="function_calling")
    messages = list(base_messages)
    last_err: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return await llm.ainvoke(messages)
        except ValidationError as err:
            last_err = err
            _logger.warning(
                "A2UI structured-output validation failed (attempt %d/%d): %s",
                attempt + 1, max_attempts, err,
            )
            messages = list(base_messages) + [
                AIMessage(content=(
                    f"Previous attempt failed schema validation: {err}. "
                    "Try again, strictly matching the schema. "
                    "Do not invent component types outside the Literal list."
                )),
            ]
    raise RuntimeError(
        f"LLM failed structured output after {max_attempts} attempts: {last_err}"
    )


# ── build_form node ─────────────────────────────────────────────────────────

_AIRPORT_OPTIONS = [{"label": c, "value": c} for c in AIRPORT_CODES]
_FARE_OPTIONS = [{"label": c, "value": c} for c in FARE_CLASSES]

# The form's data_model carries the field default values. On first turn this
# is blank; on a "Modify search" turn (after Select → confirmation surface →
# Modify search) the user expects to see their prior origin/dest/date/
# passengers/fare_class already populated. `build_form` walks message history
# via `_extract_prior_submit_context` and substitutes those values into
# {data_model_json} below.
# ChoicePicker values bind to string ARRAYS in the data model (v0.9
# DynamicStringList), so the picker-backed keys hold lists; the server
# scalarizes them back to plain strings on action receipt (_scalarize).
_BLANK_FORM_DEFAULTS: dict[str, Any] = {
    "origin": [], "dest": [], "date": "", "passengers": 1, "fare_class": ["Economy"],
}

# Keys rendered by a ChoicePicker — their data_model values are string arrays.
_CHOICE_KEYS = ("origin", "dest", "fare_class")

# `__DATA_MODEL_DEFAULTS__` is a non-brace sentinel substituted at call-time
# by `build_form()` via `str.replace()` — using `.format()` would conflict
# with the many literal-brace JSON examples below.
_BUILD_FORM_SYSTEM_TMPL = f"""You are an aviation booking-form designer. Emit an A2UI v0.9 booking form using the structured output schema.

A2UI FORMAT (CRITICAL): each component is FLAT — `{{"id": "...", "component": "<ComponentName>", <props...>}}`. The component name is a plain string and the props sit at the top level of the same object. ComponentName must be one of:
  Column, Row, Card, Text, TextField, ChoicePicker, DateTimeInput, CheckBox, Button, Divider, List, Image, Icon, Modal, Slider, Tabs

Dynamic values are bare literals ("LAX", 3, true) or data bindings `{{"path": "/json/pointer"}}`. Never wrap literals.

Per-component shapes:
  Column / Row / List: {{"children": ["id1", "id2"]}}
  Card:                {{"child": "<id>"}}            ← single child only
  Button:              {{"child": "<text-id>", "variant": "primary", "action": {{"event": {{"name": "<eventName>", "context": {{"formId": "booking"}}}}}}}}
  Text:                {{"text": "literal string", "variant": "h2"}}    (h1/h2/h3/h4/h5/caption/body)
  TextField:           {{"label": "Field", "value": {{"path": "/p"}}, "variant": "shortText"}}  (shortText/longText/number/obscured)
  DateTimeInput:       {{"label": "Date", "value": {{"path": "/p"}}, "enableDate": true}}
  ChoicePicker:        {{"label": "Origin", "options": [{{"label":"LAX","value":"LAX"}}], "value": {{"path":"/origin"}}, "variant": "mutuallyExclusive"}}
  CheckBox:            {{"label": "...", "value": {{"path":"/p"}}}}
  Divider:             {{}}

Exactly ONE component MUST have id "root" — it is the root of the tree.

Required form composition for THIS task:
  surface_id MUST be "booking"
  data_model MUST be __DATA_MODEL_DEFAULTS__  ← use these values verbatim as the field defaults

  Build this component tree:
    root (Column, children=["card"])
    card (Card, child=card_col)
    card_col (Column, children=[title, origin, dest, date, passengers, fare, submit])
    title (Text, text="Book a flight", variant="h2")
    origin (ChoicePicker, label="Origin", options={_AIRPORT_OPTIONS}, value={{"path":"/origin"}}, variant="mutuallyExclusive")
    dest (ChoicePicker, label="Destination", options={_AIRPORT_OPTIONS}, value={{"path":"/dest"}}, variant="mutuallyExclusive")
    date (DateTimeInput, label="Departure date (YYYY-MM-DD)", value={{"path":"/date"}}, enableDate=true)
    passengers (TextField, label="Passengers", value={{"path":"/passengers"}}, variant="number")
    fare (ChoicePicker, label="Fare class", options={_FARE_OPTIONS}, value={{"path":"/fare_class"}}, variant="mutuallyExclusive")
    submit (Button, child=submit_label, variant="primary", action={{"event":{{"name":"bookingSubmit","context":{{
                                                                  "formId":"booking",
                                                                  "origin":{{"path":"/origin"}},
                                                                  "dest":{{"path":"/dest"}},
                                                                  "date":{{"path":"/date"}},
                                                                  "passengers":{{"path":"/passengers"}},
                                                                  "fare_class":{{"path":"/fare_class"}}
                                                                }}}}}})
    submit_label (Text, text="Search flights")

Use these exact ids."""


def _comp(id_: str, name: str, props: dict[str, Any]) -> A2uiComponent:
    """Tiny helper so the sentinels read naturally."""
    return A2uiComponent(id=id_, component=name, **props)


def _form_defaults_from_prior(prior: dict[str, Any]) -> dict[str, Any]:
    """Project prior bookingSubmit context onto the form's data_model schema.
    Falls back to blanks for any missing key so the returned dict always has
    the full {origin, dest, date, passengers, fare_class} shape. Prior context
    values are scalars; ChoicePicker-backed keys are re-wrapped into the
    string-array shape their data-model binding expects."""
    defaults = dict(_BLANK_FORM_DEFAULTS)
    for key in defaults:
        if key in prior and prior[key] not in (None, "", []):
            value = prior[key]
            if key in _CHOICE_KEYS and not isinstance(value, list):
                value = [value]
            defaults[key] = value
    # Normalize passengers to an int (prior context may carry it as float).
    p = defaults.get("passengers")
    if isinstance(p, (int, float)):
        defaults["passengers"] = int(p)
    return defaults


def _build_sentinel_booking_form(defaults: dict[str, Any]) -> BookingFormSpec:
    """Hardcoded fallback form when LLM emit retry exhausts. Accepts the same
    `defaults` dict that the LLM-prompt path uses, so the sentinel respects
    Modify-search prefill too."""
    return BookingFormSpec(
        surface_id="booking",
        data_model=defaults,
        components=[
            _comp("root", "Column", {"children": ["card"]}),
            _comp("card", "Card", {"child": "card_col"}),
            _comp("card_col", "Column", {"children": [
                "title", "origin", "dest", "date", "passengers", "fare", "submit",
            ]}),
            _comp("title", "Text", {"text": "Book a flight (fallback)", "variant": "h2"}),
            _comp("origin", "ChoicePicker", {"label": "Origin", "options": _AIRPORT_OPTIONS,
                                              "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}),
            _comp("dest", "ChoicePicker", {"label": "Destination", "options": _AIRPORT_OPTIONS,
                                            "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}),
            _comp("date", "DateTimeInput", {"label": "Departure date (YYYY-MM-DD)",
                                             "value": {"path": "/date"}, "enableDate": True}),
            _comp("passengers", "TextField", {"label": "Passengers",
                                               "value": {"path": "/passengers"}, "variant": "number"}),
            _comp("fare", "ChoicePicker", {"label": "Fare class", "options": _FARE_OPTIONS,
                                            "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}),
            _comp("submit", "Button", {"child": "submit_label", "variant": "primary",
                                        "action": {"event": {"name": "bookingSubmit", "context": {
                                            "formId": "booking",
                                            "origin": {"path": "/origin"},
                                            "dest": {"path": "/dest"},
                                            "date": {"path": "/date"},
                                            "passengers": {"path": "/passengers"},
                                            "fare_class": {"path": "/fare_class"},
                                        }}}}),
            _comp("submit_label", "Text", {"text": "Search flights"}),
        ],
    )


# region build-form-node
async def build_form(state: MessagesState) -> dict:
    """First-turn AND Modify-search node: LLM authors the booking form.

    On a Modify-search turn (last action.name == 'modifySearch'), walks
    message history to recover the user's prior bookingSubmit context and
    pre-fills the form's data_model with those values. On a true first turn
    (no prior submit in history), uses blank defaults.
    """
    prior = _extract_prior_submit_context(state["messages"])
    defaults = _form_defaults_from_prior(prior)
    # If there's no prior bookingSubmit (true first turn), try to seed
    # origin/dest from the most recent human prompt — e.g. the welcome chip
    # "I want to fly LAX to JFK" should land on a form where Origin=LAX and
    # Destination=JFK are already selected. Without this seed, the LLM is
    # told to use the blank `data_model` verbatim and the user lands on a
    # form whose default values find no flights (Origin=Destination=LAX is
    # a common failure we've seen). Prior-context path skips this seed
    # because it already carries the user's last-known values.
    if not prior:
        seed = _seed_airports_from_messages(state["messages"])
        defaults.update(seed)
    system_prompt = _BUILD_FORM_SYSTEM_TMPL.replace(
        "__DATA_MODEL_DEFAULTS__", json.dumps(defaults)
    )
    base_messages = [SystemMessage(content=system_prompt)] + state["messages"]
    try:
        spec = await _emit_with_retry(BookingFormSpec, base_messages)
    except RuntimeError as err:
        _logger.error("Falling back to sentinel booking form: %s", err)
        spec = _build_sentinel_booking_form(defaults)
    return {"messages": [AIMessage(content=_wrap_envelopes(spec))]}
# endregion


# ── search_flights node ─────────────────────────────────────────────────────

_SEARCH_FLIGHTS_SYSTEM = """You just received a booking submission. The find_routes() tool returned the following flights:

{flights_json}

Form data (for context): {form_json}

Emit an A2UI v0.9 results surface using the FlightResultsSpec schema.

A2UI format (CRITICAL): every component is FLAT — `{{"id": "...", "component": "<ComponentName>", <props...>}}`. The component name is a plain string; props sit at the top level of the same object. Dynamic values are bare literals or `{{"path": "/ptr"}}`.

Allowed component names: Column, Row, Card, Text, TextField, Button, Divider, List.

Per-component shapes you'll need:
  Column / List: {{"children": ["id1", "id2"]}}
  Card:          {{"child": "<single-id>"}}
  Text:          {{"text": "literal", "variant": "h2"}}  (or h1/h3/body/caption)
  Button:        {{"child": "<text-id>", "variant": "primary", "action": {{"event": {{"name": "<event>", "context": {{"flightId": "<num>"}}}}}}}}
  Divider:       {{}}

Surface constraints:
  surface_id MUST be "results"
  data_model can be {{}}
  Exactly ONE component MUST have id "root": a Column whose children lists every flight Card id (or just ["no_flights"] when empty)

Build pattern (one per flight):
  card_<n>      (Card, child=col_<n>)
  col_<n>       (Column, children = [title_<n>, route_<n>, time_<n>, btn_<n>])
  title_<n>     (Text, text="<airline> flight <flight_number>", variant="h3")
  route_<n>     (Text, text="<from> → <to>  •  <duration_min> min  •  <aircraft>", variant="body")
  time_<n>      (Text, text="Depart <depart_local>  •  Arrive <arrive_local>  •  Gate <gate>", variant="caption")
  btn_<n>       (Button, child=btn_label_<n>, variant="primary",
                 action={{"event":{{"name":"flightSelect","context":{{"flightId":"<flight_number>"}}}}}})
  btn_label_<n> (Text, text="Select")

Empty case: components = [
  {{"id":"root", "component":"Column", "children":["no_flights"]}},
  {{"id":"no_flights", "component":"Card", "child":"empty_col"}},
  {{"id":"empty_col", "component":"Column", "children":["empty_msg","modify_btn"]}},
  {{"id":"empty_msg", "component":"Text", "text":"No flights found", "variant":"h3"}},
  {{"id":"modify_btn", "component":"Button", "child":"modify_label", "action":{{"event":{{"name":"modifySearch","context":{{"formId":"booking"}}}}}}}},
  {{"id":"modify_label", "component":"Text", "text":"Modify search"}}
]

Use unique ids for every component."""


_SENTINEL_RESULTS = FlightResultsSpec(
    surface_id="results",
    data_model={},
    components=[
        _comp("root", "Column", {"children": ["msg"]}),
        _comp("msg", "Card", {"child": "msg_col"}),
        _comp("msg_col", "Column", {"children": ["msg_text", "modify"]}),
        _comp("msg_text", "Text", {"text": "Results unavailable", "variant": "h3"}),
        _comp("modify", "Button", {"child": "modify_label",
                                    "action": {"event": {"name": "modifySearch",
                                                         "context": {"formId": "booking"}}}}),
        _comp("modify_label", "Text", {"text": "Modify search"}),
    ],
)


# ── confirm_booking node ────────────────────────────────────────────────────

_CONFIRM_BOOKING_SYSTEM = """You just received a Select event from the flight results surface. The user picked a flight; here are its details from lookup_flight():

{flight_json}

The user's prior search context (party_text, derived from passengers + fare_class on the original booking submission): {party_text}

The selected flight number (from the Select button's action context, used in the fallback title if flight_json is null): {flight_id}

Emit an A2UI v0.9 confirmation surface using the ConfirmationSpec schema.

A2UI format (CRITICAL): every component is FLAT — `{{"id": "...", "component": "<ComponentName>", <props...>}}`. The component name is a plain string; props sit at the top level of the same object. Dynamic values are bare literals or `{{"path": "/ptr"}}`. Exactly ONE component MUST have id "root".

Allowed component names: Column, Card, Text, Button, Divider.

Per-component shapes you'll need:
  Column:        {{"children": ["id1","id2"]}}
  Card:          {{"child": "<single-id>"}}
  Text:          {{"text": "literal", "variant": "h2"}}  (h1/h2/h3/body/caption)
  Button:        {{"child": "<text-id>", "variant": "primary", "action": {{"event": {{"name": "<event>", "context": {{"formId": "booking"}}}}}}}}
  Divider:       {{}}

Surface constraints:
  surface_id MUST be "confirmation"
  data_model = {{}}

Build this component tree exactly (use these ids):
  root         (Column, children = [card])
  card         (Card, child = card_col)
  card_col     (Column, children = [title, route_text, time_text, gate_text, divider, party_text, modify])
  title        (Text, "<airline> flight <flight_number>", variant="h2")
  route_text   (Text, "<from> → <to>  •  <duration_min> min  •  <aircraft>", variant="body")
  time_text    (Text, "Depart <depart_local>  •  Arrive <arrive_local>", variant="caption")
  gate_text    (Text, "Gate <gate>", variant="caption")
  divider      (Divider, {{}})
  party_text   (Text, "{party_text}", variant="body")  ← use the supplied string verbatim
  modify       (Button, child=modify_label, variant="primary",
                action={{"event":{{"name":"modifySearch","context":{{"formId":"booking"}}}}}})
  modify_label (Text, "Modify search")

If flight_json is null, omit route_text, time_text, gate_text from card_col's children and set the title to "Flight {flight_id} selected" (or "Booking selected" if {flight_id} is empty). Always include party_text + modify."""


def _build_sentinel_confirmation(flight_id: str, party_text: str) -> ConfirmationSpec:
    """Hardcoded fallback used when retry exhausts."""
    title = f"Flight {flight_id} selected" if flight_id else "Booking selected"
    return ConfirmationSpec(
        surface_id="confirmation",
        data_model={},
        components=[
            _comp("root", "Column", {"children": ["card"]}),
            _comp("card", "Card", {"child": "card_col"}),
            _comp("card_col", "Column", {"children": ["title", "party", "modify"]}),
            _comp("title", "Text", {"text": title, "variant": "h2"}),
            _comp("party", "Text", {"text": party_text, "variant": "body"}),
            _comp("modify", "Button", {"child": "modify_label",
                                       "action": {"event": {"name": "modifySearch",
                                                            "context": {"formId": "booking"}}}}),
            _comp("modify_label", "Text", {"text": "Modify search"}),
        ],
    )


async def confirm_booking(state: MessagesState) -> dict:
    """Post-Select node: look up the chosen flight, recover party context from
    prior submit, emit confirmation surface."""
    last = state["messages"][-1]
    select_data = _parse_submit_payload(getattr(last, "content", "")) or {}
    flight_id_raw = select_data.get("flightId") or select_data.get("flight_id") or ""
    flight_id = flight_id_raw.upper() if isinstance(flight_id_raw, str) else ""

    flight: dict[str, Any] | None = None
    if flight_id:
        try:
            flight = await lookup_flight.ainvoke({"flight_number": flight_id})
        except Exception as err:  # noqa: BLE001 — demo robustness
            _logger.warning("lookup_flight failed for %s: %s", flight_id, err)

    prior = _extract_prior_submit_context(state["messages"])
    party_text = _format_party(prior)

    base_messages = [
        SystemMessage(content=_CONFIRM_BOOKING_SYSTEM.format(
            flight_json=json.dumps(flight, indent=2) if flight else "null",
            party_text=party_text,
            flight_id=flight_id,
        )),
        HumanMessage(content=f"Emit the confirmation surface for flight {flight_id or '(unknown)'}."),
    ]
    try:
        spec = await _emit_with_retry(ConfirmationSpec, base_messages)
    except RuntimeError as err:
        _logger.error("Falling back to sentinel confirmation surface: %s", err)
        spec = _build_sentinel_confirmation(flight_id, party_text)
    return {"messages": [AIMessage(content=_wrap_envelopes(spec))]}


def _unwrap_literal(v: Any) -> Any:
    """Unwrap a legacy literal wrapper ({literalString|literalNumber|literalBoolean: <v>}).
    v0.9 context values arrive as bare literals, which pass through unchanged."""
    if isinstance(v, dict):
        for k in ("literalString", "literalNumber", "literalBoolean"):
            if k in v:
                return v[k]
    return v


def _scalarize(v: Any) -> Any:
    """Collapse a ChoicePicker string-array value ("['LAX']") to its first
    element. v0.9 pickers bind to string arrays in the data model, so
    path-bound action context values may arrive as single-element lists."""
    if isinstance(v, list):
        return v[0] if v else ""
    return v


def _parse_submit_payload(content: str) -> dict[str, Any] | None:
    """Extract the form-data dict from an A2UI action-message content.

    Chat-lib sends:
      {"version":"v0.9","action":{"name":"...","surfaceId":"...",
        "context":{"formId":"booking","origin":["LAX"], ...}}}

    Context values are plain literals (path bindings are resolved
    client-side); picker values arrive as string arrays and are
    scalarized. Legacy literal wrappers are still unwrapped tolerantly.
    """
    try:
        payload = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    action = payload.get("action")
    if not isinstance(action, dict):
        return None
    ctx = action.get("context", {})
    if not isinstance(ctx, dict):
        return None
    return {k: _scalarize(_unwrap_literal(v)) for k, v in ctx.items()}


async def search_flights(state: MessagesState) -> dict:
    """Post-submit node: call find_routes, emit results A2UI surface."""
    last = state["messages"][-1]
    form_data = _parse_submit_payload(getattr(last, "content", "")) or {}
    origin = (form_data.get("origin") or "").upper()
    dest = (form_data.get("dest") or "").upper()
    flights: list[dict[str, Any]] = []
    if origin and dest and origin != dest:
        try:
            flights = await find_routes.ainvoke({"from_code": origin, "to_code": dest})
        except Exception as err:  # noqa: BLE001 — demo robustness
            _logger.warning("find_routes failed for %s→%s: %s", origin, dest, err)

    base_messages = [
        SystemMessage(content=_SEARCH_FLIGHTS_SYSTEM.format(
            flights_json=json.dumps(flights, indent=2),
            form_json=json.dumps(form_data, indent=2),
        )),
        HumanMessage(content=f"Emit the results surface for {origin}→{dest}."),
    ]
    try:
        spec = await _emit_with_retry(FlightResultsSpec, base_messages)
    except RuntimeError as err:
        _logger.error("Falling back to sentinel results surface: %s", err)
        spec = _SENTINEL_RESULTS
    return {"messages": [AIMessage(content=_wrap_envelopes(spec))]}


# ── Routing + compile ───────────────────────────────────────────────────────

def _is_submit_event(content: str) -> bool:
    """True iff the content is an A2UI action message named bookingSubmit."""
    try:
        payload = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return False
    if not isinstance(payload, dict):
        return False
    action = payload.get("action")
    return (
        isinstance(action, dict)
        and action.get("name") == "bookingSubmit"
    )


def _is_flight_select_event(content: str) -> bool:
    """True iff the content is an A2UI action message named flightSelect."""
    try:
        payload = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return False
    if not isinstance(payload, dict):
        return False
    action = payload.get("action")
    return (
        isinstance(action, dict)
        and action.get("name") == "flightSelect"
    )


# Match "<ORIGIN> to <DEST>" / "<ORIGIN> -> <DEST>" / "<ORIGIN> → <DEST>"
# where both are 3-letter IATA codes from AIRPORT_CODES. Anchored to word
# boundaries so we don't false-match "BOSTON" or arbitrary capitals.
_AIRPORT_CODES_RE = "|".join(re.escape(code) for code in AIRPORT_CODES)
_AIRPORT_PAIR_PATTERN = re.compile(
    rf"\b({_AIRPORT_CODES_RE})\b\s*(?:to|->|→|-)\s*\b({_AIRPORT_CODES_RE})\b",
    re.IGNORECASE,
)


def _seed_airports_from_messages(messages: list[Any]) -> dict[str, str]:
    """Extract an (origin, dest) airport pair from the most recent human
    message. Used by build_form on a fresh first turn to pre-fill the form
    when the user's prompt explicitly mentions a route (e.g. the welcome
    chip "I want to fly LAX to JFK").

    Returns {"origin": [<CODE>], "dest": [<CODE>]} on a hit (string arrays,
    matching the ChoicePicker data-model shape); {} when no recognized pair
    appears. Both codes must be in AIRPORT_CODES; we never seed an airport
    the form's dropdown can't render."""
    for msg in reversed(messages):
        # Only inspect human messages — AI surfaces and action JSON shouldn't
        # be parsed for seed values.
        if getattr(msg, "type", None) != "human":
            continue
        content = getattr(msg, "content", None)
        if not isinstance(content, str):
            continue
        # Action messages also flow through as human-role; their content
        # is JSON. Cheap filter: real prompts don't start with '{'.
        if content.lstrip().startswith("{"):
            continue
        match = _AIRPORT_PAIR_PATTERN.search(content)
        if match:
            origin = match.group(1).upper()
            dest = match.group(2).upper()
            if origin == dest:
                # Same-airport "route" can't possibly find flights; skip.
                continue
            return {"origin": [origin], "dest": [dest]}
    return {}


def _extract_prior_submit_context(messages: list[Any]) -> dict[str, Any]:
    """Walk back, find the most recent bookingSubmit A2UI action message;
    return its unwrapped context dict (origin/dest/date/passengers/fare_class).
    Returns {} if not found."""
    for msg in reversed(messages):
        content = getattr(msg, "content", None)
        if not isinstance(content, str):
            continue
        try:
            payload = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            continue
        if (
            isinstance(payload, dict)
            and isinstance(payload.get("action"), dict)
            and payload["action"].get("name") == "bookingSubmit"
        ):
            ctx = payload["action"].get("context", {})
            if not isinstance(ctx, dict):
                return {}
            return {k: _scalarize(_unwrap_literal(v)) for k, v in ctx.items()}
    return {}


def _format_party(prior: dict[str, Any]) -> str:
    """Pretty-print passenger count + fare class for the confirmation text.
    Tolerant of missing fields."""
    parts: list[str] = []
    n = prior.get("passengers")
    if isinstance(n, (int, float)) and n > 0:
        parts.append(f"{int(n)} passenger" + ("" if int(n) == 1 else "s"))
    fare = prior.get("fare_class")
    if isinstance(fare, str) and fare:
        parts.append(fare)
    return "  •  ".join(parts) if parts else "(party details unavailable)"


# region route
def route(state: MessagesState) -> Command[Literal["build_form", "search_flights", "confirm_booking"]]:
    """Inspect the last message — submit event → search_flights, flight-select
    event → confirm_booking, else build_form."""
    last_content = getattr(state["messages"][-1], "content", "") if state["messages"] else ""
    if _is_submit_event(last_content):
        return Command(goto="search_flights")
    if _is_flight_select_event(last_content):
        return Command(goto="confirm_booking")
    return Command(goto="build_form")
# endregion


# ── generate_title node (inline; matches Pattern D from spec
#     2026-05-19-llm-generated-labels-design.md) ──────────────────────────────

_TITLE_PROMPT = (
    "In 3-5 words, summarize what the user is asking about. "
    "Output ONLY the title — no quotes, no period, no prefix."
)
_TITLE_MODEL = "gpt-5-mini"


async def generate_title(state: MessagesState, config) -> dict:
    """Background title generation: on the first turn, summarize the user's
    intent into 3-5 words and persist to LangGraph thread metadata so the
    sidenav shows something meaningful instead of a UUID slice.

    Idempotent — skips when metadata.title already exists. Errors are
    swallowed (title is a UX nicety, never a blocker). Runs after the
    user-visible terminal node so it never blocks the response. See spec
    2026-05-19-llm-generated-labels-design.md (originally `thread_title`,
    converged to `title` for parity with the canonical demo + adapter).
    """
    thread_id = (config.get("configurable") or {}).get("thread_id")
    if not thread_id:
        return {}
    # url=None lets the SDK use its in-process ASGI transport when the
    # call originates from inside a LangGraph server graph (always the
    # case here). The old fallback to localhost:2024 forced an HTTP
    # round-trip that fails on the prod runtime container. See PR #493.
    sdk_url = os.environ.get("LANGGRAPH_API_URL")
    try:
        client = get_client(url=sdk_url)
        thread = await client.threads.get(thread_id)
        if (thread.get("metadata") or {}).get("title"):
            return {}
        first_user = next(
            (m for m in state["messages"] if getattr(m, "type", None) == "human"),
            None,
        )
        if not first_user or not isinstance(first_user.content, str):
            return {}
        # Skip action-message JSON (those flow as human-role too)
        if first_user.content.lstrip().startswith("{"):
            return {}
        llm = ChatOpenAI(model=_TITLE_MODEL, temperature=0)
        response = await llm.ainvoke([
            SystemMessage(content=_TITLE_PROMPT),
            HumanMessage(content=first_user.content),
        ])
        title = (response.content or "").strip().strip('"').strip("'")[:80]
        if title:
            await client.threads.update(thread_id, metadata={"title": title})
    except Exception as err:  # noqa: BLE001 — title is a UX nicety; never block
        _logger.warning("Thread title generation failed: %s", err)
    return {}


# region graph-wiring
_builder = StateGraph(MessagesState)
_builder.add_node("route", route)
_builder.add_node("build_form", build_form)
_builder.add_node("search_flights", search_flights)
_builder.add_node("confirm_booking", confirm_booking)
_builder.add_node("generate_title", generate_title)
_builder.set_entry_point("route")
_builder.add_edge("build_form", "generate_title")
_builder.add_edge("search_flights", "generate_title")
_builder.add_edge("confirm_booking", "generate_title")
_builder.add_edge("generate_title", END)

graph = _builder.compile(checkpointer=MemorySaver())
# endregion
