"""Required decision, bounded execution, atomic dashboard publication."""
import json
import os
from copy import deepcopy
from pathlib import Path
from typing import Literal, NotRequired
from uuid import uuid4
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.constants import TAG_NOSTREAM
from langgraph.graph import END, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph_sdk import get_client
from src.dashboard_contract import bindings_resolve, capture, data_slots, parse_data, require, validate_dashboard, validate_spec
from src.dashboard_tools import ALL_TOOLS as _DATA_TOOLS
from src.operations import admit

_PROMPT = (Path(__file__).parent.parent / "prompts" / "generative-ui.md").read_text()

class DashboardState(MessagesState):
    dashboard: NotRequired[dict]
    completed_turn_id: NotRequired[str | None]
    completed_answer_id: NotRequired[str | None]
    completed_message_ids: NotRequired[list[str] | None]
    operation_receipt: NotRequired[dict | None]
    _submitted_turn_id: NotRequired[str | None]
    _submitted_human: NotRequired[dict | None]
    _decision: NotRequired[dict | None]
    _operation: NotRequired[dict | None]
    _reason: NotRequired[str | None]
    _parent_id: NotRequired[str | None]
    _result_ids: NotRequired[list[str]]
    _assessment: NotRequired[dict | None]
    _owned_layout: NotRequired[dict | None]
    _render_owner: NotRequired[dict | None]
    _prior_dashboard: NotRequired[dict]
    _prior_layout: NotRequired[dict | None]
    _prior_owner: NotRequired[dict | None]

def fresh(prefix):
    return f"{prefix}-{uuid4()}"

@tool
def plan_dashboard_operation(kind: Literal["create", "data_update", "restructure", "interpret", "unsupported"], calls: list[dict], interpretation: str) -> dict:
    """Choose one bounded operation. Calls contain only name and args. No action executes until independent admission."""
    return {"kind": kind, "calls": calls, "interpretation": interpretation}

# region render-spec-tool
@tool
async def render_spec(elements: dict, root: str) -> str:
    """Render a validated native dashboard layout. The graph owns publication."""
    return json.dumps({"elements": elements, "root": root})
# endregion

_ALL_TOOLS = [render_spec, *_DATA_TOOLS]
_llm_with_tools = ChatOpenAI(model="gpt-5", temperature=0, streaming=True, reasoning_effort="minimal", tags=[TAG_NOSTREAM]).bind_tools(
    [plan_dashboard_operation], tool_choice=plan_dashboard_operation.name, parallel_tool_calls=False, strict=False)
_respond_llm = ChatOpenAI(model="gpt-5-mini", temperature=0, streaming=True)
_TITLE_PROMPT = "In 3-5 words, summarize what the user is asking about. Output ONLY the title — no quotes, no period, no prefix."
_TITLE_MODEL = "gpt-5-mini"

async def generate_title(state: DashboardState, config) -> dict:
    """Best-effort metadata title; never a blocking or streamed action."""
    thread_id = (config.get("configurable") or {}).get("thread_id")
    if not thread_id:
        return {}
    try:
        client = get_client(url=os.environ.get("LANGGRAPH_API_URL"))
        thread = await client.threads.get(thread_id)
        if (thread.get("metadata") or {}).get("title"):
            return {}
        first_user = next((m for m in state["messages"] if isinstance(m, HumanMessage)), None)
        if not first_user or not isinstance(first_user.content, str) or first_user.content.lstrip().startswith("{"):
            return {}
        llm = ChatOpenAI(model=_TITLE_MODEL, temperature=0, tags=[TAG_NOSTREAM])
        response = await llm.ainvoke([SystemMessage(content=_TITLE_PROMPT), HumanMessage(content=first_user.content)])
        title = (response.content or "").strip().strip('"').strip("'")[:80]
        if title:
            await client.threads.update(thread_id, metadata={"title": title})
    except Exception as error:
        print(f"[generate_title] failed for thread {thread_id}: {type(error).__name__}: {error}", flush=True)
    return {}

def owned_layout(state):
    """Accept only a checkpoint layout with its exact graph-owned wrapped pair."""
    layout, owner = state.get("_owned_layout"), state.get("_render_owner")
    if layout is None or type(owner) is not dict:
        return None, None
    try:
        spec = validate_spec(layout)
        parent = next(m for m in state["messages"] if m.id == owner["parent_id"])
        result = next(m for m in state["messages"] if m.id == owner["result_id"])
        require(isinstance(parent, AIMessage) and isinstance(result, ToolMessage))
        require(result.name == "render_spec" and result.tool_call_id == owner["call_id"] and result.status == "success" and result.content == "rendered")
        require(parse_data(parent.content) == spec)
        require(any(c["id"] == owner["call_id"] and c["name"] == "render_spec" and c["args"] == spec for c in parent.tool_calls))
        return spec, deepcopy(owner)
    except (ValueError, KeyError, StopIteration):
        return None, None

def prepare_turn(state: DashboardState) -> dict:
    last = state["messages"][-1] if state["messages"] else None
    layout, owner = owned_layout(state)
    try:
        dashboard = validate_dashboard(state.get("dashboard") or {})
    except ValueError:
        dashboard = {}
    return {"_submitted_turn_id": last.id if isinstance(last, HumanMessage) else None,
            "_submitted_human": deepcopy(last.model_dump()) if isinstance(last, HumanMessage) else None,
            "_decision": None, "_operation": None, "_reason": None, "_parent_id": None,
            "_result_ids": [], "_assessment": None, "operation_receipt": None,
            "completed_turn_id": None, "completed_answer_id": None, "completed_message_ids": None,
            "_prior_dashboard": deepcopy(dashboard), "_prior_layout": deepcopy(layout),
            "_prior_owner": deepcopy(owner), "dashboard": dashboard, "_owned_layout": layout, "_render_owner": owner}


def submitted_human_matches(state):
    human = next((m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), None)
    return (human is not None and human.id == state.get("_submitted_turn_id")
            and human.model_dump() == state.get("_submitted_human"))

async def decide(state: DashboardState) -> dict:
    if not state.get("_submitted_turn_id") or not submitted_human_matches(state):
        return {"_reason": "Missing submitted human identity"}
    context = json.dumps({"accepted_layout": state.get("_prior_layout"), "dashboard": state["_prior_dashboard"]})
    response = await _llm_with_tools.ainvoke([SystemMessage(content=_PROMPT + "\nConfirmed checkpoint: " + context), *state["messages"]], config={"tags": [TAG_NOSTREAM]})
    try:
        require(isinstance(response, AIMessage) and not response.invalid_tool_calls, "Invalid decision tool calls")
        require(not response.additional_kwargs.get("refusal"), "Decision refused")
        require(len(response.tool_calls) == 1 and response.tool_calls[0]["name"] == plan_dashboard_operation.name, "Exactly one required decision was not returned")
        return {"_decision": capture(response.tool_calls[0]["args"])}
    except ValueError as error:
        return {"_reason": str(error)}

def admit_operation(state: DashboardState) -> dict:
    if state.get("_reason"):
        return {}
    try:
        human = state["messages"][-1] if state["messages"] else None
        require(isinstance(human, HumanMessage) and human.model_dump() == state.get("_submitted_human"), "Submitted human changed before admission")
        operation = admit(state.get("_decision"), state["_prior_dashboard"], state.get("_prior_layout"))
        operation["calls"] = [{**call, "id": fresh("call"), "type": "tool_call"} for call in operation["calls"]]
        parent_id = fresh("action") if operation["calls"] else None
        update = {"_operation": deepcopy(operation), "_parent_id": parent_id}
        if parent_id:
            update["messages"] = [AIMessage(id=parent_id, content="", tool_calls=deepcopy(operation["calls"]))]
        return update
    except ValueError as error:
        return {"_reason": str(error)}

def route_operation(state):
    return "tools" if (state.get("_operation") or {}).get("calls") else "assess_results"

_tool_node = ToolNode(_ALL_TOOLS, handle_tool_errors="The dashboard tool failed.")

async def execute_tools(state: DashboardState, config) -> dict:
    """Real ToolNode execution with owned result IDs before transcript publication."""
    output = await _tool_node.ainvoke(state, config)
    # LangChain treats [] as an empty multimodal-content list, rather than JSON.
    # Preserve the genuine empty data result in the native text-result format.
    results = [m.model_copy(deep=True, update={"id": fresh("result"),
               "content": "[]" if m.content == [] else deepcopy(m.content)}) for m in output["messages"]]
    return {"messages": results, "_result_ids": [m.id for m in results]}

def current_results(state):
    parent_index = next((i for i, m in enumerate(state["messages"]) if m.id == state.get("_parent_id")), None)
    return [] if parent_index is None else [m for m in state["messages"][parent_index + 1:] if isinstance(m, ToolMessage)]


def result_projection(results):
    return [{"id": m.id, "tool_call_id": m.tool_call_id, "name": m.name,
             "status": m.status, "content": deepcopy(m.content)} for m in results]


def latest_data_slots(results, calls):
    """Merge validated data in transcript order, owning every selected slot.

    Admission forbids repeated tool names in executable operations. This helper
    still defines chronological replacement for historical/direct observations.
    """
    slots = {}
    by_id = {call["id"]: call for call in calls}
    for result in results:
        if result.name == "render_spec":
            continue
        call = by_id.get(result.tool_call_id)
        require(call is not None and result.name == call["name"] and result.status == "success", "Uncorrelated data result")
        slots.update(data_slots(result.name, parse_data(result.content), call["args"]))
    return deepcopy(slots)

def assess_results(state: DashboardState) -> dict:
    operation = state.get("_operation")
    if operation is None:
        return {"_assessment": {"outcome": "rejected", "slots": {}, "layout": None, "reason": state.get("_reason") or "Invalid decision"}}
    if not operation["calls"]:
        return {"_assessment": {"outcome": operation["kind"], "slots": {}, "layout": None, "reason": None}}
    try:
        require(submitted_human_matches(state), "Submitted human changed before assessment")
        calls, results = operation["calls"], current_results(state)
        require(len(results) == len(calls) and len(state["_result_ids"]) == len(calls), "Missing or extra results")
        require([m.id for m in results] == state["_result_ids"] and len(set(state["_result_ids"])) == len(results), "Unowned results")
        slots, layout, render_result, render_text = {}, None, None, None
        seen = set()
        for result in results:
            matching = [call for call in calls if call["id"] == result.tool_call_id]
            require(len(matching) == 1 and result.tool_call_id not in seen, "Uncorrelated results")
            call = matching[0]
            seen.add(result.tool_call_id)
            require(result.name == call["name"] and result.status == "success", "Failed or misnamed tool result")
            payload = result.content
            if call["name"] == "render_spec" and type(payload) is str and payload.strip().startswith("```"):
                payload = "\n".join(line for line in payload.strip().split("\n") if not line.startswith("```")).strip()
            parsed = parse_data(payload)
            if call["name"] == "render_spec":
                layout = validate_spec(parsed)
                require(layout == call["args"], "Render differs from admitted arguments")
                render_result = result.id
                render_text = payload.strip()
        slots = latest_data_slots(results, calls)
        candidate = deepcopy(state["_prior_dashboard"])
        candidate.update(deepcopy(slots))
        if layout is not None:
            require(bindings_resolve(layout, candidate), "Unresolved layout bindings")
        parent = next(m for m in state["messages"] if m.id == state["_parent_id"])
        require(isinstance(parent, AIMessage) and parent.tool_calls == calls, "Unowned action parent")
        require(parent.content == "", "Render/action parent already contains prose")
        observed = result_projection(results)
        return {"_assessment": {"outcome": "applied", "slots": deepcopy(slots), "layout": deepcopy(layout), "render_result_id": render_result, "render_text": render_text, "observed_results": observed, "reason": None}}
    except (ValueError, KeyError, StopIteration) as error:
        return {"_assessment": {"outcome": "unfulfilled", "slots": {}, "layout": None, "reason": str(error)}}

# region wrap-spec-into-ai
async def wrap_spec_into_ai(state: DashboardState) -> dict:
    assessment = state.get("_assessment") or {}
    if assessment.get("outcome") != "applied" or assessment.get("layout") is None:
        return {}
    parent = next((m for m in state["messages"] if m.id == state["_parent_id"]), None)
    result = next((m for m in current_results(state) if m.id == assessment["render_result_id"]), None)
    if (not submitted_human_matches(state)
            or not isinstance(parent, AIMessage) or parent.content != "" or result is None
            or parent.tool_calls != state["_operation"]["calls"]
            or result_projection(current_results(state)) != assessment["observed_results"]
            or [m.id for m in current_results(state)] != state["_result_ids"]):
        return {"_assessment": {"outcome": "unfulfilled", "slots": {}, "layout": None, "reason": "Render parent could not be applied"}}
    return {"messages": [result.model_copy(deep=True, update={"content": "rendered"}), parent.model_copy(deep=True, update={"content": assessment["render_text"]})]}
# endregion

def make_receipt(state, assessment, owner):
    operation = state.get("_operation")
    results = current_results(state) if operation and operation["calls"] else []
    return {"submitted_human_id": state.get("_submitted_turn_id"), "submitted_human": deepcopy(state.get("_submitted_human")), "kind": operation["kind"] if operation else None,
            "admitted_calls": deepcopy(operation["calls"]) if operation else [],
            "results": result_projection(results),
            "validated_slots": deepcopy(assessment.get("slots") or {}), "render_owner": deepcopy(owner),
            "outcome": assessment["outcome"], "reason": assessment.get("reason")}

# region emit-state
async def emit_state(state: DashboardState) -> dict:
    from langgraph.config import get_stream_writer
    assessment = deepcopy(state["_assessment"])
    layout, owner = deepcopy(state["_prior_layout"]), deepcopy(state["_prior_owner"])
    slots = {}
    if assessment["outcome"] == "applied":
        try:
            require(submitted_human_matches(state), "Submitted human changed before publication")
            operation = state["_operation"]
            parent = next(m for m in state["messages"] if m.id == state["_parent_id"])
            require(isinstance(parent, AIMessage) and parent.tool_calls == operation["calls"], "Changed action ownership")
            observed = deepcopy(assessment["observed_results"])
            if assessment["layout"] is not None:
                next(item for item in observed if item["id"] == assessment["render_result_id"])["content"] = "rendered"
            current = result_projection(current_results(state))
            require(current == observed and [item["id"] for item in current] == state["_result_ids"], "Results changed after assessment")
            if assessment["layout"] is not None:
                result = next(m for m in current_results(state) if m.id == assessment["render_result_id"])
                render = next(c for c in operation["calls"] if c["name"] == "render_spec")
                require(result.content == "rendered" and result.status == "success" and result.name == "render_spec" and result.tool_call_id == render["id"] and parent.content == assessment["render_text"] and parse_data(parent.content) == assessment["layout"], "Render wrapper was not applied")
                layout = deepcopy(assessment["layout"])
                owner = {"parent_id": parent.id, "call_id": render["id"], "result_id": result.id}
            else:
                require(parent.content == "", "Unexpected data action content")
            slots = deepcopy(assessment["slots"])
        except (ValueError, StopIteration, KeyError) as error:
            assessment = {"outcome": "unfulfilled", "slots": {}, "layout": None, "reason": str(error)}
            layout, owner = deepcopy(state["_prior_layout"]), deepcopy(state["_prior_owner"])
    dashboard = deepcopy(state["_prior_dashboard"])
    dashboard.update(deepcopy(slots))
    receipt = make_receipt(state, assessment, owner if assessment["outcome"] == "applied" and assessment.get("layout") is not None else None)
    if slots:
        patches = {}
        for key, value in slots.items():
            if type(value) is dict:
                patches.update({f"/{key}/{field}": deepcopy(item) for field, item in value.items()})
            else:
                patches[f"/{key}"] = deepcopy(value)
        get_stream_writer()({"name": "state_update", "data": deepcopy(patches)})
    return {"dashboard": dashboard, "_owned_layout": layout, "_render_owner": owner, "operation_receipt": deepcopy(receipt), "_assessment": assessment}
# endregion

def action_answer(receipt):
    if receipt["outcome"] == "applied":
        facts = []
        for call in receipt["admitted_calls"]:
            name, args = call["name"], call["args"]
            if name == "render_spec":
                facts.append("Dashboard layout applied.")
            elif name == "query_recent_disruptions":
                facts.append(f"Stored {len(receipt['validated_slots']['recent_disruptions'])} {args.get('type') or 'all'} disruption rows (limit {args.get('limit', 5)}).")
            elif name == "query_on_time_trend":
                facts.append(f"Stored {len(receipt['validated_slots']['on_time_trend'])} months of on-time data (requested {args.get('months', 12)}).")
            elif name == "query_flights_by_airline":
                selection = ", ".join(args.get("airlines") or []) or "all airlines"
                facts.append(f"Stored {len(receipt['validated_slots']['flights_by_airline'])} airline rows for {selection}.")
            else:
                facts.append("Operational KPI data applied.")
        return " ".join(facts)
    if receipt["outcome"] == "unsupported":
        return "This request is unsupported. No dashboard changes were made."
    if receipt["outcome"] == "unfulfilled":
        return "The dashboard operation could not be applied. No dashboard changes were made."
    return "No valid dashboard operation was selected. No dashboard changes were made."

async def respond(state: DashboardState) -> dict:
    receipt = state["operation_receipt"]
    if receipt["outcome"] == "interpret":
        result = await _respond_llm.ainvoke([SystemMessage(content="Answer the user's interpretive question using confirmed data. This is read-only: do not claim actions or changes. Do not output tools or JSON."), *state["messages"], SystemMessage(content="Confirmed dashboard: " + json.dumps(state["dashboard"]))], config={"tags": [TAG_NOSTREAM]})
        prose = result.content if isinstance(result.content, str) else ""
        content = prose + "\n\nNo dashboard changes were made."
    else:
        content = action_answer(receipt)
    response = AIMessage(id=fresh("answer"), content=content)
    ids = [m.id for m in [*state["messages"], response]]
    completion = {}
    if submitted_human_matches(state) and all(type(identity) is str and identity for identity in ids) and len(ids) == len(set(ids)):
        completion = {"completed_turn_id": state["_submitted_turn_id"], "completed_answer_id": response.id, "completed_message_ids": ids}
    return {"messages": [response], **completion}

# region graph-wiring
_builder = StateGraph(DashboardState, input_schema=MessagesState)
for name, node in (("prepare_turn", prepare_turn), ("decide", decide), ("admit", admit_operation), ("tools", execute_tools), ("assess_results", assess_results), ("wrap_spec_into_ai", wrap_spec_into_ai), ("emit_state", emit_state), ("respond", respond), ("generate_title", generate_title)):
    _builder.add_node(name, node)
_builder.set_entry_point("prepare_turn")
_builder.add_edge("prepare_turn", "decide")
_builder.add_edge("decide", "admit")
_builder.add_conditional_edges("admit", route_operation)
_builder.add_edge("tools", "assess_results")
_builder.add_edge("assess_results", "wrap_spec_into_ai")
_builder.add_edge("wrap_spec_into_ai", "emit_state")
_builder.add_edge("emit_state", "respond")
_builder.add_edge("respond", "generate_title")
_builder.add_edge("generate_title", END)
graph = _builder.compile()
# endregion
