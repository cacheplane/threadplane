"""Fresh browser-scoped store observations; scope partitioning is not authentication.

The byte bound applies after backend materialization, not to store allocation.
Private attributes omit I/O schemas and API values filtered by output_channels.
Custom events and raw checkpoints retain them; this is not a secrecy guarantee.
"""
from typing import Annotated, NotRequired, TypedDict
from uuid import UUID
from langchain.agents.middleware import AgentMiddleware, AgentState
from langchain.agents.middleware.types import PrivateStateAttr
from langgraph.config import get_stream_writer

MEMORY_FILE = '/memories/AGENTS.md'
MEMORY_EVENT = 'deep_agents.memory'
MEMORY_NAMESPACE = ('cockpit', 'deep-agents-memory', 'browser-v1')
MAX_MEMORY_BYTES = 65_536

class MemoryContext(TypedDict):
    memory_scope: str

class MemoryObservationState(AgentState):
    memory_scope_owner: NotRequired[Annotated[str, PrivateStateAttr]]
    memory_contents: NotRequired[Annotated[dict[str, str], PrivateStateAttr]]

def validate_scope(context):
    """Require an exact context and canonical lowercase UUID v4."""
    if not isinstance(context, dict) or set(context) != {'memory_scope'}:
        raise ValueError('Invalid memory scope context')
    scope = context['memory_scope']
    if not isinstance(scope, str) or len(scope) != 36:
        raise ValueError('Invalid memory scope context')
    try:
        parsed = UUID(scope)
    except ValueError:
        raise ValueError('Invalid memory scope context') from None
    if parsed.version != 4 or str(parsed) != scope:
        raise ValueError('Invalid memory scope context')
    return scope

def memory_namespace(runtime):
    return (*MEMORY_NAMESPACE, validate_scope(getattr(runtime, 'context', None)))

class MemoryObservationError(RuntimeError):
    """An actual read could not establish a fresh observation."""

class MemoryObservationMiddleware(AgentMiddleware):
    state_schema = MemoryObservationState
    def __init__(self, backend):
        self.backend = backend
    def _admit(self, state, runtime):
        scope = validate_scope(runtime.context)
        if 'memory_scope_owner' in state and state['memory_scope_owner'] != scope:
            raise ValueError('Memory scope differs from thread owner')
        return scope
    def _snapshot(self, responses):
        try:
            if len(responses) != 1 or responses[0].path != MEMORY_FILE:
                raise ValueError()
            response = responses[0]
            if response.error == 'file_not_found':
                return {}
            if response.error is not None or not isinstance(response.content, bytes):
                raise ValueError()
            if len(response.content) > MAX_MEMORY_BYTES:
                raise ValueError()
            return {MEMORY_FILE: response.content.decode('utf-8', errors='strict')}
        except Exception:
            raise MemoryObservationError('Memory observation unavailable') from None
    def _publish(self, contents, scope, phase):
        get_stream_writer()({'name': MEMORY_EVENT, 'data': {
            'memory_contents': contents, 'memory_scope_owner': scope, 'phase': phase,
        }})
        return {'memory_contents': contents, 'memory_scope_owner': scope}
    def _refresh(self, state, runtime, phase):
        scope = self._admit(state, runtime)
        try:
            contents = self._snapshot(self.backend.download_files([MEMORY_FILE]))
        except Exception:
            raise MemoryObservationError('Memory observation unavailable') from None
        return self._publish(contents, scope, phase)
    async def _arefresh(self, state, runtime, phase):
        scope = self._admit(state, runtime)
        try:
            contents = self._snapshot(await self.backend.adownload_files([MEMORY_FILE]))
        except Exception:
            raise MemoryObservationError('Memory observation unavailable') from None
        return self._publish(contents, scope, phase)
    def before_agent(self, state, runtime):
        return self._refresh(state, runtime, 'initial')
    async def abefore_agent(self, state, runtime):
        return await self._arefresh(state, runtime, 'initial')
    def before_model(self, state, runtime):
        return self._refresh(state, runtime, 'model')
    async def abefore_model(self, state, runtime):
        return await self._arefresh(state, runtime, 'model')
    def after_agent(self, state, runtime):
        return self._refresh(state, runtime, 'terminal')
    async def aafter_agent(self, state, runtime):
        return await self._arefresh(state, runtime, 'terminal')
