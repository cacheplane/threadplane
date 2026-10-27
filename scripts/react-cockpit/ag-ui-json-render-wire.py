"""Offline browser proof: actual compiled graph, frozen providers and AG-UI bridge."""
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path('tests').resolve()))
from test_streaming import actual_graph
from ag_ui.core.types import RunAgentInput
from ag_ui_langgraph import LangGraphAgent


async def main():
    request = RunAgentInput.model_validate(json.loads(sys.stdin.read()))
    events = [event.model_dump(mode='json', by_alias=True, exclude_none=True)
              async for event in LangGraphAgent(name='json-render', graph=actual_graph()).run(request)]
    print(json.dumps(events))


asyncio.run(main())
