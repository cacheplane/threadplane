"""Deterministic callback providers for the actual Chat Input graph."""

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

ANSWER = "An authored answer.\n\n```typescript\nconst answer = 42;\n```"
TITLE = "Authored metadata title"


class AuthoredModel(BaseChatModel):
    title: bool = False
    answer_id: str = "authored-answer"

    @property
    def _llm_type(self):
        return "authored-chat-input"

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(generations=[ChatGeneration(message=AIMessage(
            content=TITLE if self.title else ANSWER,
            id="authored-title" if self.title else self.answer_id,
        ))])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        content = TITLE if self.title else ANSWER
        for start in range(0, len(content), 3):
            yield ChatGenerationChunk(message=AIMessageChunk(
                content=content[start:start + 3],
                id="authored-title" if self.title else self.answer_id,
            ))
        # Match the locked OpenAI provider's explicit terminal chunk. Without
        # this marker BaseChatModel synthesizes a different callback identity.
        yield ChatGenerationChunk(message=AIMessageChunk(
            content="", id="authored-title" if self.title else self.answer_id,
            chunk_position="last", response_metadata={"finish_reason": "stop", "model_provider": "openai"},
        ))


def model_factory(**kwargs):
    return AuthoredModel(
        title=not kwargs.get("streaming", False), tags=kwargs.get("tags", []),
    )


class AuthoredThreads:
    def __init__(self, title=None, fail=False):
        self.title = title
        self.fail = fail
        self.updates = []

    async def get(self, thread_id):
        if self.fail:
            raise RuntimeError("Authored metadata read failure")
        return {"metadata": {"title": self.title} if self.title else {}}

    async def update(self, thread_id, metadata):
        self.updates.append((thread_id, metadata))


class AuthoredClient:
    def __init__(self, **kwargs):
        self.threads = AuthoredThreads(**kwargs)
