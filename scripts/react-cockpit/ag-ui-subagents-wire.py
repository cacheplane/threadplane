"""Offline proof: exact native request through the real graph and child bridge."""
import asyncio
from contextlib import nullcontext
import json
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path('tests').resolve()))
from test_streaming import actual_modules, run_actual, FrozenSubagentModel
from ag_ui.core import RunAgentInput


async def main():
    body = RunAgentInput.model_validate(json.load(sys.stdin))
    module, emitter, _ = actual_modules()
    agent = emitter.SubagentEmittingAgent(name='subagents', graph=module.graph)
    events = []
    provider = patch.object(module, 'ChatOpenAI', side_effect=lambda **kw: FrozenSubagentModel(disable_streaming=True)) if '--without-child-tokens' in sys.argv else nullcontext()
    with provider:
        try:
            await run_actual(agent, body, captured=events)
        except ValueError:
            # Actual child failure evidence is emitted before the provider
            # exception propagates. Never fabricate a successful root terminal.
            if not any(event['type'] == 'SUBAGENT_ERROR' for event in events):
                raise
    print(json.dumps(events))


asyncio.run(main())
