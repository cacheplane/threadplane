"""Deterministic streaming providers for the actual Threads graph."""
import hashlib
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

TITLE = "Authored conversation title"


def answer_for(messages):
    human = next(m for m in reversed(messages) if isinstance(m, HumanMessage))
    token = hashlib.sha256(((human.id or "") + "\0" + human.content).encode()).hexdigest()[:20]
    return AIMessage(content="Authored answer: " + human.content + "\n\n```typescript\nconst answer = 42;\n```", id="answer-" + token)


class AuthoredModel(BaseChatModel):
    title: bool = False

    @property
    def _llm_type(self):
        return "authored-chat-threads"

    def answer(self, messages):
        return AIMessage(content=TITLE, id="authored-title") if self.title else answer_for(messages)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(generations=[ChatGeneration(message=self.answer(messages))])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        message = self.answer(messages)
        for start in range(0, len(message.content), 3):
            yield ChatGenerationChunk(message=AIMessageChunk(content=message.content[start:start + 3], id=message.id))
            if not self.title and start >= 9 and next(m for m in reversed(messages) if isinstance(m, HumanMessage)).content == "fail-stream":
                raise RuntimeError("Authored stream failure")
        yield ChatGenerationChunk(message=AIMessageChunk(content="", id=message.id, chunk_position="last", response_metadata={"finish_reason": "stop", "model_provider": "openai"}))


def model_factory(**kwargs):
    return AuthoredModel(title=not kwargs.get("streaming", False), tags=kwargs.get("tags", []))


class AuthoredThreads:
    def __init__(self, titles=None, fail_read=False, fail_write=False):
        self.titles = dict(titles or {})
        self.fail_read = fail_read
        self.fail_write = fail_write
        self.updates = []
        self.reads = []

    async def get(self, thread_id):
        self.reads.append(thread_id)
        if self.fail_read:
            raise RuntimeError("Authored metadata read failure")
        return {"thread_id": thread_id, "metadata": {"title": self.titles[thread_id]} if thread_id in self.titles else {}}

    async def update(self, thread_id, metadata):
        if self.fail_write:
            raise RuntimeError("Authored metadata write failure")
        self.titles[thread_id] = metadata["title"]
        self.updates.append((thread_id, dict(metadata)))


class AuthoredClient:
    def __init__(self, **kwargs):
        self.threads = AuthoredThreads(**kwargs)
