"""Offline admission and native-contract boundaries (no semantic routing claims)."""
import unittest
from copy import deepcopy

from src.dashboard_tools import query_recent_disruptions

SPEC = {"root": "root", "elements": {
    "root": {"type": "dashboard_grid", "children": ["table"]},
    "table": {"type": "data_grid", "props": {
        "rows": {"$state": "/recent_disruptions"}, "columns": ["flight_number", "type"]}}}}


class OperationsTests(unittest.TestCase):
    def test_admission_rejects_invalid_decisions_and_arguments(self):
        from src.operations import admit
        for decision in [None, {}, {"kind": "unknown", "calls": [], "interpretation": "x"},
                         {"kind": "data_update", "calls": [], "interpretation": "x"}]:
            with self.subTest(decision=decision):
                with self.assertRaises(ValueError):
                    admit(decision, {}, None)
        for args in [{"limit": None}, {"limit": True}, {"limit": 0}, {"limit": 101},
                     {"limit": 1.5}, {"type": "other"}, {"extra": 1}]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                admit({"kind": "data_update", "interpretation": "filter", "calls": [
                    {"name": "query_recent_disruptions", "args": args}]}, {}, SPEC)

    def test_only_missing_exact_dependencies_are_required(self):
        from src.operations import admit
        decision = {"kind": "create", "interpretation": "create", "calls": [
            {"name": "render_spec", "args": SPEC}, {"name": "query_recent_disruptions", "args": {}}]}
        self.assertEqual(len(admit(decision, {}, None)["calls"]), 2)
        with self.assertRaises(ValueError):
            admit({**decision, "calls": decision["calls"][:1]}, {}, None)
        reuse = {**decision, "kind": "restructure", "calls": decision["calls"][:1]}
        self.assertEqual(len(admit(reuse, {"recent_disruptions": None}, SPEC)["calls"]), 1)
        with self.assertRaises(ValueError):
            admit({**decision, "kind": "restructure"}, {"recent_disruptions": []}, SPEC)
        with self.assertRaises(ValueError):
            admit(decision, {}, SPEC)

    def test_native_spec_literal_nulls_tree_and_binding_contract(self):
        from src.dashboard_contract import validate_spec, bindings_resolve
        literal = deepcopy(SPEC)
        literal["elements"]["table"]["props"]["rows"] = None
        self.assertEqual(validate_spec(literal), literal)
        self.assertTrue(bindings_resolve(SPEC, {"recent_disruptions": None}))
        metric = {"root": "m", "elements": {"m": {"type": "stat_card", "props": {
            "label": "Metric", "value": {"$state": "/on_time/value"}}}}}
        self.assertFalse(bindings_resolve(metric, {"on_time": None}))
        for change in [lambda s: s["elements"]["root"].update(type="Stack"),
                       lambda s: s["elements"]["root"].update(children=["root"]),
                       lambda s: s["elements"].update(orphan={"type": "container"}),
                       lambda s: s["elements"]["table"]["props"].update(rows={"$state": "/foreign"}),
                       lambda s: s["elements"]["table"]["props"].update(extra=1)]:
            value = deepcopy(SPEC)
            change(value)
            with self.assertRaises(ValueError):
                validate_spec(value)

    def test_result_shapes_filters_limits_and_copy(self):
        from src.dashboard_contract import data_slots
        rows = deepcopy(query_recent_disruptions.invoke({"type": "cancelled"}))
        copied = data_slots("query_recent_disruptions", rows, {"type": "cancelled"})
        self.assertEqual([r["flight_number"] for r in copied["recent_disruptions"]], ["AA456", "UA204", "UA640"])
        rows[0]["type"] = "changed"
        self.assertEqual(copied["recent_disruptions"][0]["type"], "cancelled")
        for name, data, args in [
            ("query_recent_disruptions", copied["recent_disruptions"], {"limit": 2}),
            ("query_recent_disruptions", copied["recent_disruptions"], {"type": "delayed"}),
            ("query_flights_by_airline", [{"airline": "United", "count": 2}], {"airlines": ["Delta"]}),
            ("query_airline_kpis", {"on_time": {"value": 1, "delta": None}}, {}),
            ("query_on_time_trend", [{"month": "x", "on_time_pct": 101}], {}),
            ("query_recent_disruptions", [{"flight_number": "x", "type": "delayed", "minutes": -1, "route": "x", "date": "x"}], {})]:
            with self.subTest(name=name, args=args), self.assertRaises(ValueError):
                data_slots(name, data, args)

    def test_json_budgets_use_utf16(self):
        from src.dashboard_contract import capture, parse_data
        with self.assertRaises(ValueError):
            capture("😀" * 50001)
        with self.assertRaises(ValueError):
            parse_data(" " * 100001)
        value = None
        for _ in range(34):
            value = [value]
        with self.assertRaises(ValueError):
            capture(value)

    def test_exact_argument_names_defaults_bounds_and_all_airline_selections(self):
        from src.operations import arguments
        for name, args in [("query_airline_kpis", {}), ("query_on_time_trend", {"months": 100}),
                           ("query_recent_disruptions", {"limit": 1, "type": None}),
                           ("query_flights_by_airline", {}), ("query_flights_by_airline", {"airlines": None}),
                           ("query_flights_by_airline", {"airlines": []}),
                           ("query_flights_by_airline", {"airlines": ["United"]})]:
            self.assertEqual(arguments(name, args), args)
        for name, args in [("query_airline_kpis", {"foreign": 1}),
                           ("query_on_time_trend", {"months": None}),
                           ("query_on_time_trend", {"months": False}),
                           ("query_flights_by_airline", {"airlines": "United"}),
                           ("query_flights_by_airline", {"airlines": [""]}),
                           ("query_flights_by_airline", {"airlines": ["A"] * 101}),
                           ("query_flights_by_airline", {"airlines": ["😀" * 257]}),
                           ("query_recent_disruptions", {"type": ""})]:
            with self.subTest(name=name, args=args), self.assertRaises(ValueError):
                arguments(name, args)

    def test_full_native_catalog_batch_and_duplicate_bounds(self):
        from src.operations import admit
        from src.dashboard_contract import validate_spec
        spec = {"root": "root", "elements": {
            "root": {"type": "dashboard_grid", "children": ["container", "trend", "airlines", "table"]},
            "container": {"type": "container", "props": {"direction": "row"}, "children": ["metric"]},
            "metric": {"type": "stat_card", "props": {"label": "On time", "value": {"$state": "/on_time/value"}, "delta": {"$state": "/on_time/delta"}}},
            "trend": {"type": "line_chart", "props": {"data": {"$state": "/on_time_trend"}, "xKey": "month", "yKey": "on_time_pct"}},
            "airlines": {"type": "bar_chart", "props": {"data": {"$state": "/flights_by_airline"}, "labelKey": "airline", "valueKey": "count"}},
            "table": SPEC["elements"]["table"],
        }}
        selected = {"kind": "create", "calls": [{"name": "render_spec", "args": spec},
            *[{"name": name, "args": {}} for name in ("query_airline_kpis", "query_on_time_trend", "query_flights_by_airline", "query_recent_disruptions")]], "interpretation": ""}
        self.assertEqual(len(admit(selected, {}, None)["calls"]), 5)
        for value in [{**selected, "calls": selected["calls"] * 2},
                      {**selected, "calls": selected["calls"][:2] + [selected["calls"][1]]},
                      {**selected, "foreign": True},
                      {**selected, "kind": "unsupported"},
                      {**selected, "calls": [{"name": "render_spec", "args": SPEC}, {"name": "query_airline_kpis", "args": {}}]}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                admit(value, {}, None)
        for modify in [lambda v: v["elements"].update(constructor={"type": "container"}),
                       lambda v: v["elements"]["root"].update(children=["container", "container"]),
                       lambda v: v["elements"]["metric"].update(children=["table"]),
                       lambda v: v["elements"]["trend"]["props"].update(yKey="wrong"),
                       lambda v: v["elements"]["table"]["props"].update(columns=["type", "type"]),
                       lambda v: v["elements"]["airlines"]["props"].update(data=[{"airline": "x", "count": -1}])]:
            value = deepcopy(spec)
            modify(value)
            with self.assertRaises(ValueError):
                validate_spec(value)

    def test_default_row_bounds_nonfinite_exact_metric_and_literal_data(self):
        from src.dashboard_contract import data_slots, validate_dashboard, validate_spec
        for name, value in [("query_recent_disruptions", deepcopy(query_recent_disruptions.invoke({"limit": 6}))),
                            ("query_on_time_trend", [{"month": "now", "on_time_pct": 1}] * 13),
                            ("query_flights_by_airline", [{"airline": "United", "count": float("nan")}])]:
            with self.assertRaises(ValueError):
                data_slots(name, value, {})
        metrics = {key: {"value": 1, "delta": None} for key in ("on_time", "flights_today", "avg_delay", "load_factor")}
        self.assertEqual(data_slots("query_airline_kpis", metrics, {}), metrics)
        for bad in [{"on_time": {"value": "", "delta": None}}, {"on_time": {"value": 1, "delta": ""}},
                    {"on_time": {"value": True, "delta": None}}, {"foreign": None},
                    {"on_time_trend": [{"month": "x", "on_time_pct": -1}]}]:
            with self.assertRaises(ValueError):
                validate_dashboard(bad)
        literal = deepcopy(SPEC)
        literal["elements"]["table"]["props"]["rows"] = []
        self.assertEqual(validate_spec(literal), literal)


if __name__ == "__main__":
    unittest.main()
