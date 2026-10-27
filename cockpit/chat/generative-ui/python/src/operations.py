"""Private, independently validated bounded operation admission."""
from src.dashboard_contract import (SLOT_TO_TOOL, bindings, capture, require,
                                    resolve, text, validate_dashboard, validate_spec)

KINDS = ("create", "data_update", "restructure", "interpret", "unsupported")
QUERY_KEYS = {"query_airline_kpis": (), "query_on_time_trend": ("months",),
              "query_flights_by_airline": ("airlines",), "query_recent_disruptions": ("limit", "type")}


def arguments(name, args):
    args = capture(args)
    require(type(args) is dict)
    if name == "render_spec":
        return validate_spec(args)
    require(name in QUERY_KEYS and set(args) <= set(QUERY_KEYS[name]), "Unknown tool or arguments")
    for key in ("months", "limit"):
        if key in args:
            require(type(args[key]) is int and 1 <= args[key] <= 100, "Invalid query bound")
    if "airlines" in args and args["airlines"] is not None:
        require(type(args["airlines"]) is list and len(args["airlines"]) <= 100 and all(text(item) for item in args["airlines"]), "Invalid airlines")
    if "type" in args:
        require(args["type"] is None or args["type"] in ("delayed", "cancelled"), "Invalid disruption type")
    return args


def admit(decision, dashboard, layout):
    decision = capture(decision)
    require(type(decision) is dict and set(decision) == {"kind", "calls", "interpretation"}, "Invalid decision")
    kind = decision["kind"]
    require(type(kind) is str and kind in KINDS)
    require(type(decision["interpretation"]) is str and (decision["interpretation"] == "" or text(decision["interpretation"])))
    require(kind != "interpret" or text(decision["interpretation"]), "Interpretation requires a question")
    calls = decision["calls"]
    require(type(calls) is list and len(calls) <= 5, "Operation exceeds batch bound")
    owned = []
    names = set()
    for call in calls:
        require(type(call) is dict and set(call) == {"name", "args"} and type(call["name"]) is str)
        require(call["name"] not in names, "Duplicate operation tool")
        names.add(call["name"])
        owned.append({"name": call["name"], "args": arguments(call["name"], call["args"])})
    if kind in ("interpret", "unsupported"):
        require(not owned, "Read-only decision cannot execute")
    elif kind == "data_update":
        require(layout is not None and len(owned) == 1 and "render_spec" not in names, "Data update requires existing layout and one query")
    else:
        require((layout is None) == (kind == "create"), "Category does not match existing layout")
        require("render_spec" in names, "Layout operation requires one render")
        spec = next(call["args"] for call in owned if call["name"] == "render_spec")
        prior = validate_dashboard(dashboard) if kind == "restructure" else {}
        necessary = {SLOT_TO_TOOL[pointer.split("/")[1]] for pointer in bindings(spec) if not resolve(pointer, prior)}
        require(names - {"render_spec"} == necessary, "Only required backing queries may execute")
    return {"kind": kind, "calls": owned, "interpretation": decision["interpretation"]}
