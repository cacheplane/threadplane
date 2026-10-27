"""Private mirror of the native dashboard data/spec admission contract.

Keep aligned with react/src/dashboard-data.ts and dashboard-spec.ts.
All returned values are owned copies; invalid data raises ValueError.
"""
import json
from math import isfinite

METRICS = ("on_time", "flights_today", "avg_delay", "load_factor")
ARRAYS = ("on_time_trend", "flights_by_airline", "recent_disruptions")
DISRUPTION_KEYS = ("flight_number", "type", "minutes", "route", "date")
SLOT_TO_TOOL = {**{key: "query_airline_kpis" for key in METRICS},
                **{key: "query_" + key for key in ARRAYS}}


def require(condition, reason="Invalid dashboard contract"):
    if not condition:
        raise ValueError(reason)


def utf16(value):
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def capture(value):
    nodes = characters = 0
    parents = set()

    def copy(item, depth):
        nonlocal nodes, characters
        nodes += 1
        require(nodes <= 20000 and depth <= 32, "Data exceeds budget")
        if type(item) is str:
            size = utf16(item)
            characters += size
            require(size <= 100000 and characters <= 1000000, "Text exceeds budget")
            return item
        if item is None or type(item) is bool:
            return item
        if type(item) in (int, float):
            require(number(item), "Nonfinite number")
            return item
        require(type(item) in (dict, list) and id(item) not in parents, "Unsupported data")
        require(len(item) <= 10000, "Container exceeds budget")
        parents.add(id(item))
        result = {} if type(item) is dict else []
        for key, entry in (item.items() if type(item) is dict else enumerate(item)):
            key_text = key if type(item) is dict else str(key)
            require(type(key_text) is str)
            characters += utf16(key_text)
            require(utf16(key_text) <= 100000 and characters <= 1000000, "Keys exceed budget")
            owned = copy(entry, depth + 1)
            if type(item) is dict:
                result[key] = owned
            else:
                result.append(owned)
        parents.remove(id(item))
        return result

    return copy(value, 0)


def parse_data(text):
    require(type(text) is str and utf16(text) <= 100000, "Result exceeds budget")
    try:
        return capture(json.loads(text))
    except (TypeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError("Invalid tool JSON") from error


def number(value):
    try:
        return type(value) in (int, float) and isfinite(value)
    except OverflowError:
        return False


def text(value):
    return type(value) is str and 1 <= utf16(value) <= 512


def safe_key(value):
    return text(value) and utf16(value) <= 80 and value not in ("__proto__", "prototype", "constructor")


def metric(value):
    return (type(value) is dict and set(value) == {"value", "delta"}
            and (text(value["value"]) or number(value["value"]))
            and (value["delta"] is None or text(value["delta"])))


def rows(slot, value):
    if type(value) is not list or len(value) > 100:
        return False
    rules = {
        "on_time_trend": {"month": text, "on_time_pct": lambda n: number(n) and 0 <= n <= 100},
        "flights_by_airline": {"airline": text, "count": lambda n: number(n) and n >= 0},
        "recent_disruptions": {**{key: text for key in DISRUPTION_KEYS if key != "minutes"},
                               "minutes": lambda n: number(n) and n >= 0},
    }[slot]
    return all(type(row) is dict and set(row) == set(rules)
               and all(rule(row[key]) for key, rule in rules.items()) for row in value)


def validate_dashboard(value):
    value = capture(value)
    require(type(value) is dict and set(value) <= set(METRICS + ARRAYS))
    for key, item in value.items():
        require(item is None or (metric(item) if key in METRICS else rows(key, item)))
    return value


def data_slots(name, value, args):
    value = capture(value)
    if name == "query_airline_kpis":
        require(type(value) is dict and set(value) == set(METRICS)
                and all(metric(item) for item in value.values()))
        return value
    slots = {"query_" + key: key for key in ARRAYS}
    require(name in slots)
    slot = slots[name]
    require(rows(slot, value))
    if slot == "on_time_trend":
        require(len(value) <= args.get("months", 12), "Trend exceeds requested months")
    elif slot == "flights_by_airline":
        airlines = args.get("airlines")
        require(not airlines or all(row["airline"] in airlines for row in value), "Wrong airline")
    else:
        require(len(value) <= args.get("limit", 5), "Disruptions exceed requested limit")
        require(args.get("type") is None or all(row["type"] == args["type"] for row in value), "Wrong disruption filter")
    return {slot: value}


def is_binding(value, paths):
    return type(value) is dict and set(value) == {"$state"} and type(value["$state"]) is str and value["$state"] in paths


def scalar(value, suffix):
    return (value is None or text(value) or (suffix == "value" and number(value))
            or is_binding(value, [f"/{key}/{suffix}" for key in METRICS]))


def array_prop(value, slot):
    return value is None or is_binding(value, ["/" + slot]) or rows(slot, value)


def validate_spec(value):
    value = capture(value)
    require(type(value) is dict and set(value) == {"root", "elements"} and safe_key(value["root"]))
    elements = value["elements"]
    require(type(elements) is dict and 1 <= len(elements) <= 100 and value["root"] in elements)
    catalog = {
        "dashboard_grid": ([], {}, True),
        "container": ([], {"direction": lambda x: x in ("row", "column")}, True),
        "stat_card": (["label"], {"label": text, "value": lambda x: scalar(x, "value"), "delta": lambda x: scalar(x, "delta")}, False),
        "line_chart": (["data", "xKey", "yKey"], {"title": text, "data": lambda x: array_prop(x, "on_time_trend"), "xKey": lambda x: x == "month", "yKey": lambda x: x == "on_time_pct"}, False),
        "bar_chart": (["data", "labelKey", "valueKey"], {"title": text, "data": lambda x: array_prop(x, "flights_by_airline"), "labelKey": lambda x: x == "airline", "valueKey": lambda x: x == "count"}, False),
        "data_grid": (["rows", "columns"], {"title": text, "rows": lambda x: array_prop(x, "recent_disruptions"), "columns": lambda x: type(x) is list and 1 <= len(x) <= 5 and all(type(k) is str and k in DISRUPTION_KEYS for k in x) and len(set(x)) == len(x)}, False),
    }
    for key, element in elements.items():
        require(safe_key(key) and type(element) is dict and set(element) <= {"type", "props", "children"})
        require(type(element.get("type")) is str and element["type"] in catalog)
        required, rules, can_have_children = catalog[element["type"]]
        props = element.get("props", {})
        require(type(props) is dict and set(required) <= set(props) and set(props) <= set(rules))
        require(all(rules[name](item) for name, item in props.items()))
        children = element.get("children", [])
        require(type(children) is list and len(children) <= 100 and all(safe_key(child) for child in children)
                and len(set(children)) == len(children) and (can_have_children or not children))
    visited = set()

    def visit(key):
        require(key in elements and key not in visited, "Layout must be one complete tree")
        visited.add(key)
        for child in elements[key].get("children", []):
            visit(child)

    visit(value["root"])
    require(len(visited) == len(elements), "Unreachable component")
    return value


def bindings(spec):
    return [value["$state"] for element in spec["elements"].values()
            for value in element.get("props", {}).values() if type(value) is dict and "$state" in value]


def resolve(pointer, dashboard):
    current = dashboard
    for key in pointer.lstrip("/").split("/"):
        if type(current) is not dict or key not in current:
            return False
        current = current[key]
    return True


def bindings_resolve(spec, dashboard):
    return all(resolve(pointer, dashboard) for pointer in bindings(spec))
