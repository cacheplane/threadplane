"""Deterministic local model; exercises the production compiled graph offline."""
import importlib.util
import os
from pathlib import Path
from unittest.mock import patch

os.environ['LANGSMITH_TRACING'] = 'false'
os.environ['LANGCHAIN_TRACING_V2'] = 'false'
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
import deepagents

ROOT = Path(__file__).parents[1]
SCOPE = 'b110fa66-41bb-4f89-8b8e-577cefd8a770'
OTHER = '1cdd373f-862c-4dfe-8bb1-bc9b79d17849'
FILE = '/memories/AGENTS.md'

class LocalModel(BaseChatModel):
    calls: list = []
    prompts: list = []
    @property
    def _llm_type(self):
        return 'offline-memory-contract'
    def bind_tools(self, tools, **kwargs):
        return self
    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.prompts.append(messages[0].text)
        human = next(m for m in reversed(messages) if m.type == 'human')
        results = [m for m in messages[messages.index(human):] if m.type == 'tool']
        if len(results) < len(self.calls):
            name, args = self.calls[len(results)]
            answer = AIMessage(content='', tool_calls=[{'name':name,'args':args,'id':human.id+'-'+str(len(results)),'type':'tool_call'}])
        else:
            answer = AIMessage(content='Offline completion.')
        return ChatResult(generations=[ChatGeneration(message=answer)])

class CountingStore(InMemoryStore):
    def __init__(self):
        super().__init__()
        self.operations = []
    def batch(self, ops):
        ops = list(ops)
        self.operations.extend(ops)
        return super().batch(ops)
    async def abatch(self, ops):
        return self.batch(ops)

def load(model, root=ROOT, store=None):
    with patch('langchain_openai.ChatOpenAI', return_value=model):
        spec = importlib.util.spec_from_file_location('offline_memory_graph', root/'src/graph.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        graph = module.build_memory_agent().builder.compile(checkpointer=InMemorySaver(), store=store or CountingStore())
    return module, graph
