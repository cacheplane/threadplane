"""Deterministic providers; callbacks and graph execution remain real LangChain."""

from dataclasses import dataclass

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from pydantic import PrivateAttr

TITLE = "Authored debug metadata title"
SUMMARY_PROMPT = "Provide a brief one-sentence summary of the conversation so far."


@dataclass(frozen=True)
class Invocation:
    node: str
    content: str
    id: str


class AuthoredModel(BaseChatModel):
    title: bool = False
    _provider: object = PrivateAttr()

    @property
    def _llm_type(self):
        return "authored-chat-debug"

    def _begin(self, messages):
        if self.title:
            node = "generate_title"
        elif messages[0].content == SUMMARY_PROMPT:
            node = "summarize"
        else:
            node = "generate"
        turn = sum(call.node == node for call in self._provider.calls) + 1
        content = {
            "generate": f"Answer {turn}: aviation  facts.\nA second line.",
            "summarize": f"Summary {turn}: an authored aviation conversation.",
            "generate_title": TITLE,
        }[node]
        call = Invocation(node, content, f"authored-{node}-{turn}")
        self._provider.calls.append(call)
        return call

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        call = self._begin(messages)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(
            content=call.content, id=call.id,
        ))])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        call = self._begin(messages)
        for start in range(0, len(call.content), 3):
            yield ChatGenerationChunk(message=AIMessageChunk(
                content=call.content[start:start + 3], id=call.id,
            ))
        # Supported by the locked OpenAI provider. Let BaseChatModel emit all
        # callbacks, preserving the same identity through the terminal chunk.
        yield ChatGenerationChunk(message=AIMessageChunk(
            content="", id=call.id, chunk_position="last",
            response_metadata={"finish_reason": "stop", "model_provider": "openai"},
        ))


class AuthoredProvider:
    def __init__(self):
        self.calls = []

    def model_factory(self, **kwargs):
        model = AuthoredModel(
            title=not kwargs.get("streaming", False), tags=kwargs.get("tags", []),
        )
        model._provider = self
        return model


class AuthoredThreads:
    def __init__(self, title=None, fail_read=False, fail_update=False):
        self.title = title
        self.fail_read = fail_read
        self.fail_update = fail_update
        self.reads = []
        self.updates = []

    async def get(self, thread_id):
        self.reads.append(thread_id)
        if self.fail_read:
            raise RuntimeError("Authored metadata read failure")
        return {"metadata": {"title": self.title} if self.title else {}}

    async def update(self, thread_id, metadata):
        self.updates.append((thread_id, metadata))
        if self.fail_update:
            raise RuntimeError("Authored metadata update failure")
        self.title = metadata["title"]


class AuthoredClient:
    def __init__(self, **kwargs):
        self.threads = AuthoredThreads(**kwargs)
