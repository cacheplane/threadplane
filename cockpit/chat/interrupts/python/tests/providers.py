"""Deterministic providers for the real compiled aviation graph."""
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

ANSWER = "An authored aviation answer.\n\n```typescript\nconst approved = true;\n```"
TITLE = "Authored aviation conversation"


class AuthoredModel(BaseChatModel):
    title: bool = False

    @property
    def _llm_type(self):
        return "authored-chat-interrupts"

    def bind_tools(self, tools, **kwargs):
        return self

    def answer(self, messages):
        if self.title:
            return AIMessage(content=TITLE, id="authored-title")
        start = max(i for i, message in enumerate(messages) if isinstance(message, HumanMessage))
        human, turn = messages[start], messages[start:]
        text = human.content.lower()
        results = [message for message in turn if isinstance(message, ToolMessage)]
        identity = f"answer-{human.id}-{len(results)}"
        if results and not ("read then book" in text and len(results) == 1):
            return AIMessage(content=results[-1].content, id=identity)
        if "book" not in text and "multiple" not in text:
            return AIMessage(content=ANSWER, id=identity)
        flight = "ZZ999" if "unknown" in text else "  ua123  " if "padded" in text else "AA404" if "aa404" in text else "UA123"
        name = "lookup_flight" if "read then book" in text and not results else "book_flight"
        flights = ["UA123", "AA404"] if "multiple" in text else [flight]
        return AIMessage(content="", id=identity, tool_calls=[{
            "name": name, "args": {"flight_number": number},
            "id": f"call-{human.id}-{len(results)}-{index}", "type": "tool_call",
        } for index, number in enumerate(flights)])

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(generations=[ChatGeneration(message=self.answer(messages))])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        message = self.answer(messages)
        if message.tool_calls:
            yield ChatGenerationChunk(message=AIMessageChunk(
                content="", id=message.id, tool_calls=message.tool_calls,
                chunk_position="last", response_metadata={"finish_reason": "tool_calls", "model_provider": "openai"},
            ))
            return
        for start in range(0, len(message.content), 3):
            yield ChatGenerationChunk(message=AIMessageChunk(content=message.content[start:start + 3], id=message.id))
        yield ChatGenerationChunk(message=AIMessageChunk(
            content="", id=message.id, chunk_position="last",
            response_metadata={"finish_reason": "stop", "model_provider": "openai"},
        ))


def model_factory(**kwargs):
    return AuthoredModel(title=not kwargs.get("streaming", False), tags=kwargs.get("tags", []))


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
