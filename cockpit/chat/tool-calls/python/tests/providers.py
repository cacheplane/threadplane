"""Deterministic streaming providers for the actual aviation graph."""

import json
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

TITLE = "Authored aviation conversation"


class AuthoredModel(BaseChatModel):
    title: bool = False

    @property
    def _llm_type(self):
        return "authored-chat-tool-calls"

    def bind_tools(self, tools, **kwargs):
        return self

    def answer(self, messages):
        if self.title:
            return AIMessage(content=TITLE, id="authored-title")
        start = max(i for i, m in enumerate(messages) if isinstance(m, HumanMessage))
        human = messages[start]
        turn = messages[start:]
        text = human.content.lower()
        results = [m for m in turn if isinstance(m, ToolMessage)]
        identity = "answer-" + human.id + "-" + str(len(results))
        if "no tools" in text:
            return AIMessage(content="An authored plain answer.", id=identity)
        if results and not ("sequential" in text and len(results) == 1):
            return AIMessage(
                content="Observed "
                + str(len(results))
                + " tool results: "
                + results[-1].content,
                id=identity,
            )
        if "malformed" in text:
            calls = [("lookup_flight", {"flight_number": 123})]
        elif "literal long" in text:
            calls = [("get_airport_info", {"airport_code": "<button>observed</button>" * 40})]
        elif "compare" in text:
            calls = [("get_airport_info", {"airport_code": c}) for c in ["LAX", "JFK"]]
        elif "routes" in text:
            calls = [
                (
                    "find_routes",
                    {"from_code": "LAX", "to_code": "JFK", "date_offset_days": 1},
                )
            ]
        elif "sequential" in text and results:
            calls = [("get_airport_info", {"airport_code": "JFK"})]
        else:
            calls = [
                (
                    "lookup_flight",
                    {"flight_number": "ZZ999" if "unknown" in text else "UA123"},
                )
            ]
        return AIMessage(
            content="",
            id=identity,
            tool_calls=[
                {
                    "id": "call-" + human.id + "-" + str(len(results)) + "-" + str(i),
                    "name": name,
                    "args": args,
                    "type": "tool_call",
                }
                for i, (name, args) in enumerate(calls)
            ],
        )

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(generations=[ChatGeneration(message=self.answer(messages))])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        m = self.answer(messages)
        if m.tool_calls:
            for i, call in enumerate(m.tool_calls):
                args = json.dumps(call["args"])
                half = len(args) // 2
                yield ChatGenerationChunk(
                    message=AIMessageChunk(
                        content="",
                        id=m.id,
                        tool_call_chunks=[
                            {
                                "name": call["name"],
                                "args": args[:half],
                                "id": call["id"],
                                "index": i,
                            }
                        ],
                    )
                )
                yield ChatGenerationChunk(
                    message=AIMessageChunk(
                        content="",
                        id=m.id,
                        tool_call_chunks=[
                            {"name": None, "args": args[half:], "id": None, "index": i}
                        ],
                    )
                )
            yield ChatGenerationChunk(
                message=AIMessageChunk(
                    content="",
                    id=m.id,
                    chunk_position="last",
                    response_metadata={
                        "finish_reason": "tool_calls",
                        "model_provider": "openai",
                    },
                )
            )
        else:
            for i in range(0, len(m.content), 11):
                yield ChatGenerationChunk(
                    message=AIMessageChunk(content=m.content[i : i + 11], id=m.id)
                )
            yield ChatGenerationChunk(
                message=AIMessageChunk(
                    content="",
                    id=m.id,
                    chunk_position="last",
                    response_metadata={
                        "finish_reason": "stop",
                        "model_provider": "openai",
                    },
                )
            )


def model_factory(**kwargs):
    return AuthoredModel(
        title=not kwargs.get("streaming", False), tags=kwargs.get("tags", [])
    )


class AuthoredThreads:
    def __init__(self, title=None, fail=False):
        self.default_title = title
        self.fail = fail
        self.titles = {}
        self.updates = []

    async def get(self, thread_id):
        if self.fail:
            raise RuntimeError("Authored metadata read failure")
        title = self.titles.get(thread_id, self.default_title)
        return {"metadata": {"title": title} if title else {}}

    async def update(self, thread_id, metadata):
        self.titles[thread_id] = metadata["title"]
        self.updates.append((thread_id, metadata))


class AuthoredClient:
    def __init__(self, **kwargs):
        self.threads = AuthoredThreads(**kwargs)
