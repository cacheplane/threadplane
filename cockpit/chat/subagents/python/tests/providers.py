"""Deterministic streaming providers for the actual specialist graph."""

import json
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

TITLE = "Authored trip conversation"


class AuthoredModel(BaseChatModel):
    title: bool = False

    @property
    def _llm_type(self):
        return "authored-chat-subagents"

    def bind_tools(self, tools, **kwargs):
        return self

    def answer(self, messages):
        if self.title:
            return AIMessage(content=TITLE, id="authored-title")
        human = next(m for m in reversed(messages) if isinstance(m, HumanMessage))
        import hashlib
        token = hashlib.sha256((human.id or human.content).encode()).hexdigest()[:16]
        system = messages[0].content
        if "Agent for trip planning." in system:
            role = next(r for r in ["Research", "Booking", "Itinerary"] if r + " Agent" in system)
            content = role + " authored suggestion for " + human.content
            if role == "Booking" and "empty-child" in human.content:
                content = ""
            return AIMessage(content=content, id="child-" + token)
        start = max(i for i, m in enumerate(messages) if isinstance(m, HumanMessage))
        results = [m for m in messages[start:] if isinstance(m, ToolMessage)]
        text = human.content.lower()
        if "direct" in text or len(results) == 3 or (results and any(s in text for s in ["repeated", "malformed"])):
            return AIMessage(content="Authored parent trip suggestion.", id="parent-final-" + token)
        roles = ["research", "booking", "itinerary"]
        selected = ["research", "research"] if "repeated" in text else roles if "parallel" in text else [roles[len(results)]]
        return AIMessage(content="", id="parent-" + token + "-" + str(len(results)), tool_calls=[
            {"id": "task-" + token + "-" + str(len(results)) + "-" + str(i),
             "name": "task", "args": {"subagent_type": role,
             "task_description": 123 if "malformed" in text else role + " LAX to JFK " + human.content},
             "type": "tool_call"} for i, role in enumerate(selected)
        ])

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(generations=[ChatGeneration(message=self.answer(messages))])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        if "You are a Booking Agent" in messages[0].content and "fail-child" in messages[-1].content:
            yield ChatGenerationChunk(message=AIMessageChunk(content="Authored partial child", id="failing-child"))
            raise RuntimeError("PRIVATE_CHILD_DIAGNOSTIC")
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
