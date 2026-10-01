"""Tests for the `research_policy` delegation scenario — the tool is a
registered async `@tool` that hands expense-policy research to the tool-less
`policy_researcher` specialist. No live model calls: these tests only
inspect registration metadata (the module builds its OpenAI clients with a
placeholder key that would 401 at request time)."""

import inspect

from src.agent import agent, policy_researcher, research_policy


def _tool_names() -> list[str]:
    return [t.name for t in agent.agent.default_options["tools"]]


def test_research_policy_is_registered_on_the_agent():
    assert "research_policy" in _tool_names()
    # Existing tools stay registered untouched.
    assert "lookup_expense_policy" in _tool_names()
    assert "submit_expense" in _tool_names()


def test_tool_name_and_docstring():
    assert research_policy.name == "research_policy"
    assert research_policy.description.startswith(
        "Delegate policy research for this expense to a specialist."
    )
    schema = research_policy.parameters()
    assert set(schema["required"]) == {"category", "amount"}


def test_tool_is_async():
    # The seam depends on it: the tool must be able to async-iterate the
    # specialist's streamed updates and enqueue deltas as they arrive.
    assert inspect.iscoroutinefunction(research_policy.func)


def test_specialist_is_toolless_researcher():
    assert policy_researcher.name == "policy_researcher"
    assert policy_researcher.default_options.get("tools") == []
    assert "expense-policy researcher" in policy_researcher.default_options["instructions"]


def test_instructions_mention_delegation():
    instructions = agent.agent.default_options["instructions"]
    assert "research_policy" in instructions


def test_untouched_surfaces_still_configured():
    # The subagent scenario must not disturb the existing shared-state and
    # approval surfaces.
    assert agent.config.state_schema == {
        "expense": {"type": "object", "description": "The expense entry being drafted."},
    }
    assert agent.config.predict_state_config == {
        "expense": {"tool": "submit_expense", "tool_argument": "expense"},
    }
