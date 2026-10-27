"""The existing FastAPI route serves the actual frozen subagent producer."""
import importlib.util
import json
from pathlib import Path
import types
from unittest.mock import patch

from fastapi.testclient import TestClient

from test_streaming import actual_modules, FrozenSubagentModel, FrozenThreads, request


def actual_server():
    _, _, name = actual_modules()
    spec = importlib.util.spec_from_file_location(name + '.server', Path(__file__).resolve().parents[1] / 'src/server.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.app


def test_existing_health_route():
    with TestClient(actual_server()) as client:
        assert client.get('/ok').json() == {'ok': True}


def test_existing_agent_route_streams_three_children_and_stable_final_results():
    body = request('server-thread', 'server-run', [{'id': 'server-human', 'role': 'user', 'content': 'sequential'}])
    with patch('langchain_openai.ChatOpenAI', side_effect=lambda **kw: FrozenSubagentModel(streaming=kw.get('streaming', False))), patch('langgraph_sdk.get_client', return_value=types.SimpleNamespace(threads=FrozenThreads())):
        with TestClient(actual_server()) as client:
            response = client.post('/agent', json=body.model_dump(mode='json', by_alias=True))
    assert response.status_code == 200 and 'text/event-stream' in response.headers['content-type']
    events = [json.loads(line.removeprefix('data:').strip()) for line in response.text.splitlines() if line.startswith('data:')]
    assert events[-1] == {'type': 'RUN_FINISHED', 'threadId': 'server-thread', 'runId': 'server-run'}
    assert len([event for event in events if event['type'] == 'SUBAGENT_FINISHED']) == 3
    final = next(event['messages'] for event in reversed(events) if event['type'] == 'MESSAGES_SNAPSHOT')
    results = [message for message in final if message['role'] == 'tool']
    assert len(results) == 3 and all(message['id'] == message['toolCallId'] for message in results)


def test_invalid_protocol_request_is_rejected():
    with TestClient(actual_server()) as client:
        assert client.post('/agent', json={}).status_code == 422
