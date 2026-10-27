"""Aviation KPI tools for the c-generative-ui standalone demo.

Standalone copy — analytics constants are inlined here because this
backend has no shared aviation_data.py module. Mirrors the umbrella
backend at cockpit/langgraph/streaming/python/src/dashboard_tools.py.
"""

import json
from typing import Annotated

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool, InjectedToolCallId


def _result(name: str, tool_call_id: str, payload: dict | list) -> ToolMessage:
    """Keep streamed and finalized results at the same causal message ID."""
    return ToolMessage(
        id=tool_call_id,
        tool_call_id=tool_call_id,
        name=name,
        content=json.dumps(payload),
    )

# ── Analytics fixtures (inlined; no aviation_data.py in standalone) ─────────

KPI_SNAPSHOT = {
    "on_time_pct": 84.2,
    "on_time_delta": "+1.4%",
    "flights_today": 312,
    "flights_today_delta": "+8",
    "avg_delay_min": 12,
    "avg_delay_delta": "-2 min",
    "load_factor_pct": 78.5,
    "load_factor_delta": "+0.6%",
}

ON_TIME_TREND = [
    {"month": "2025-05", "on_time_pct": 82.4},
    {"month": "2025-06", "on_time_pct": 81.1},
    {"month": "2025-07", "on_time_pct": 79.8},
    {"month": "2025-08", "on_time_pct": 80.5},
    {"month": "2025-09", "on_time_pct": 83.2},
    {"month": "2025-10", "on_time_pct": 84.0},
    {"month": "2025-11", "on_time_pct": 82.6},
    {"month": "2025-12", "on_time_pct": 78.9},
    {"month": "2026-01", "on_time_pct": 80.2},
    {"month": "2026-02", "on_time_pct": 81.7},
    {"month": "2026-03", "on_time_pct": 82.8},
    {"month": "2026-04", "on_time_pct": 84.2},
]

FLIGHTS_BY_AIRLINE = [
    {"airline": "American", "count": 87},
    {"airline": "United",   "count": 92},
    {"airline": "Delta",    "count": 78},
    {"airline": "JetBlue",  "count": 55},
]

RECENT_DISRUPTIONS = [
    {"flight_number": "UA123", "type": "delayed",   "minutes": 45, "route": "LAX→JFK", "date": "2026-05-14"},
    {"flight_number": "AA456", "type": "cancelled", "minutes": 0,  "route": "JFK→LAX", "date": "2026-05-14"},
    {"flight_number": "DL789", "type": "delayed",   "minutes": 22, "route": "ATL→ORD", "date": "2026-05-13"},
    {"flight_number": "B6101", "type": "delayed",   "minutes": 68, "route": "BOS→MIA", "date": "2026-05-13"},
    {"flight_number": "UA204", "type": "cancelled", "minutes": 0,  "route": "SFO→SEA", "date": "2026-05-12"},
    {"flight_number": "AA318", "type": "delayed",   "minutes": 15, "route": "DFW→DEN", "date": "2026-05-12"},
    {"flight_number": "DL552", "type": "delayed",   "minutes": 35, "route": "ATL→MIA", "date": "2026-05-11"},
    {"flight_number": "B6217", "type": "delayed",   "minutes": 80, "route": "JFK→BOS", "date": "2026-05-11"},
    {"flight_number": "UA640", "type": "cancelled", "minutes": 0,  "route": "ORD→DEN", "date": "2026-05-10"},
    {"flight_number": "AA871", "type": "delayed",   "minutes": 25, "route": "LAX→DFW", "date": "2026-05-10"},
]


# ── Tools ───────────────────────────────────────────────────────────────────

@tool
def query_airline_kpis(tool_call_id: Annotated[str, InjectedToolCallId]) -> ToolMessage:
    """Snapshot of operational KPIs across the fleet: on-time %, flights today,
    average delay (minutes), and load factor."""
    snap = KPI_SNAPSHOT
    return _result("query_airline_kpis", tool_call_id, {
        "on_time":       {"value": f"{snap['on_time_pct']}%",      "delta": snap["on_time_delta"]},
        "flights_today": {"value": snap["flights_today"],          "delta": snap["flights_today_delta"]},
        "avg_delay":     {"value": f"{snap['avg_delay_min']} min", "delta": snap["avg_delay_delta"]},
        "load_factor":   {"value": f"{snap['load_factor_pct']}%",  "delta": snap["load_factor_delta"]},
    })


@tool
def query_on_time_trend(months: int = 12, *, tool_call_id: Annotated[str, InjectedToolCallId]) -> ToolMessage:
    """On-time performance over time, as percentage by month.

    Args:
        months: Number of months to return (default 12). Valid: 3, 6, 12, 24.
    """
    months = min(months, len(ON_TIME_TREND))
    return _result("query_on_time_trend", tool_call_id, ON_TIME_TREND[-months:])


@tool
def query_flights_by_airline(airlines: list[str] | None = None, *, tool_call_id: Annotated[str, InjectedToolCallId]) -> ToolMessage:
    """Daily flight counts per airline.

    Args:
        airlines: Optional filter list, e.g. ["American", "United"]. All four
                  returned if omitted.
    """
    if airlines:
        return _result("query_flights_by_airline", tool_call_id, [a for a in FLIGHTS_BY_AIRLINE if a["airline"] in airlines])
    return _result("query_flights_by_airline", tool_call_id, FLIGHTS_BY_AIRLINE)


@tool
def query_recent_disruptions(limit: int = 5, type: str | None = None, *, tool_call_id: Annotated[str, InjectedToolCallId]) -> ToolMessage:
    """Recent flight delays or cancellations.

    Args:
        limit: Maximum entries to return (default 5).
        type: Optional filter, "delayed" or "cancelled".
    """
    filtered = RECENT_DISRUPTIONS
    if type:
        filtered = [d for d in filtered if d["type"] == type]
    return _result("query_recent_disruptions", tool_call_id, filtered[:limit])


ALL_TOOLS = [
    query_airline_kpis,
    query_on_time_trend,
    query_flights_by_airline,
    query_recent_disruptions,
]
