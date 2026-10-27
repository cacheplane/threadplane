"""Internal title work must not become conversation messages."""

from types import SimpleNamespace

import pytest
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import HumanMessage
from langgraph.graph import END, START, MessagesState, StateGraph

from src import graph as graph_module


pytestmark = pytest.mark.smoke

PROMPT = "Remember a quiet morning walk."
ANSWER = "Write the small observations in a notebook."
TITLE = "Remembering A Morning Walk"


class ModelEvents(BaseCallbackHandler):
    def __init__(self):
        self.nodes = {}
        self.events = []

    def on_chat_model_start(self, serialized, messages, *, run_id, metadata, **kwargs):
        node = metadata["langgraph_node"]
        self.nodes[run_id] = node
        self.events.append(("start", node))

    def on_llm_end(self, response, *, run_id, **kwargs):
        self.events.append(("end", self.nodes[run_id]))

    def on_llm_error(self, error, *, run_id, **kwargs):
        self.events.append(("error", self.nodes[run_id]))


async def title_stream(monkeypatch, *, disable_streaming=False, fail=False):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setenv("LANGCHAIN_TRACING_V2", "false")
    writes = []

    class Threads:
        async def get(self, thread_id):
            assert thread_id == "owned-title-thread"
            return {"metadata": {}}

        async def update(self, thread_id, metadata):
            writes.append((thread_id, metadata))

    def title_model(**kwargs):
        # Replace only transport. Keep LangChain's actual callback/tag handling.
        return FakeListChatModel(
            responses=[TITLE],
            tags=kwargs.get("tags"),
            disable_streaming=disable_streaming,
            error_on_chunk_number=2 if fail else None,
        )

    monkeypatch.setattr(
        graph_module, "get_client", lambda url=None: SimpleNamespace(threads=Threads())
    )
    monkeypatch.setattr(graph_module, "ChatOpenAI", title_model)
    answer_model = FakeListChatModel(responses=[ANSWER])

    async def generate(state):
        return {"messages": [await answer_model.ainvoke(state["messages"])]}

    builder = StateGraph(MessagesState)
    builder.add_node("generate", generate)
    builder.add_node("generate_title", graph_module.generate_title)
    builder.add_edge(START, "generate")
    builder.add_edge("generate", "generate_title")
    builder.add_edge("generate_title", END)
    events = ModelEvents()
    stream = [
        item
        async for item in builder.compile().astream(
            {"messages": [HumanMessage(id="human-1", content=PROMPT)]},
            {
                "configurable": {"thread_id": "owned-title-thread"},
                "callbacks": [events],
            },
            stream_mode=["messages", "values"],
        )
    ]
    return stream, writes, events.events


def assert_conversation_stream(stream):
    messages = [payload for mode, payload in stream if mode == "messages"]
    ordinary = [
        message.content for message, metadata in messages
        if metadata["langgraph_node"] == "generate"
    ]
    assert "".join(ordinary) == ANSWER
    values = [payload for mode, payload in stream if mode == "values"]
    assert [
        [(message.type, message.content) for message in value["messages"]]
        for value in values
    ] == [
        [("human", PROMPT)],
        [("human", PROMPT), ("ai", ANSWER)],
    ]
    # Inspect every event, including empty chunks and the non-streaming LLM end.
    assert [
        payload for payload in messages
        if payload[1]["langgraph_node"] == "generate_title"
    ] == []


@pytest.mark.parametrize("disable_streaming", [False, True], ids=["tokens", "llm-end"])
async def test_title_persists_without_conversation_message(monkeypatch, disable_streaming):
    stream, writes, events = await title_stream(
        monkeypatch, disable_streaming=disable_streaming
    )
    assert writes == [("owned-title-thread", {"title": TITLE})]
    assert events == [
        ("start", "generate"), ("end", "generate"),
        ("start", "generate_title"), ("end", "generate_title"),
    ]
    assert_conversation_stream(stream)


async def test_title_failure_does_not_fail_or_pollute_answer(monkeypatch):
    stream, writes, events = await title_stream(monkeypatch, fail=True)
    assert writes == []
    assert events == [
        ("start", "generate"), ("end", "generate"),
        ("start", "generate_title"), ("error", "generate_title"),
    ]
    assert_conversation_stream(stream)
