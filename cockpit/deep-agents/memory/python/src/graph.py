"""Agent-authored cross-thread Memory with validated browser scope and fresh reads.

Custom events announce new reads. API values filtered through output_channels
omit private Memory keys; custom events and raw checkpoints retain them.
Private I/O schema attributes are not authentication or a secrecy guarantee.
"""
from pathlib import Path
from deepagents import create_deep_agent
from deepagents.backends import StoreBackend
from langchain_openai import ChatOpenAI
from src.memory_observation import (
    MEMORY_EVENT, MEMORY_FILE, MEMORY_NAMESPACE, MemoryContext,
    MemoryObservationMiddleware, memory_namespace,
)

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

def build_memory_agent():
    """Bind a thread once and refresh actual store contents at each phase."""
    backend = StoreBackend(namespace=memory_namespace)
    return create_deep_agent(
        model=ChatOpenAI(model="gpt-4.1", temperature=0),
        system_prompt=(PROMPTS_DIR / "memory.md").read_text(),
        backend=backend,
        memory=[MEMORY_FILE],
        context_schema=MemoryContext,
        middleware=[MemoryObservationMiddleware(backend)],
    )

graph = build_memory_agent()
