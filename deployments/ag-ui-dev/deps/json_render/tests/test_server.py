"""The authored FastAPI route serves the actual frozen dashboard graph."""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from test_streaming import actual_graph, request


def actual_server():
    name = f'dashboard_server_{uuid4().hex}'
    package = types.ModuleType(name)
    package.__path__ = []
    graph_module = types.ModuleType(name + '.graph')
    graph_module.graph = actual_graph()
    spec = importlib.util.spec_from_file_location(name + '.server', Path(__file__).resolve().parents[1] / 'src/server.py')
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {name: package, name + '.graph': graph_module}):
        spec.loader.exec_module(module)
    return module.app


class DashboardServerTests(unittest.TestCase):
    def test_existing_health_route(self):
        with TestClient(actual_server()) as client:
            self.assertEqual(client.get('/ok').json(), {'ok': True})

    def test_existing_agent_route_streams_all_five_tools_and_final_snapshot(self):
        body = request('server-thread', 'server-run', [{'id': 'server-human', 'role': 'user', 'content': 'full'}])
        with TestClient(actual_server()) as client:
            response = client.post('/agent', json=body.model_dump(mode='json', by_alias=True))
        self.assertEqual(response.status_code, 200)
        self.assertIn('text/event-stream', response.headers['content-type'])
        events = [json.loads(line.removeprefix('data:').strip()) for line in response.text.splitlines() if line.startswith('data:')]
        self.assertEqual(events[-1]['type'], 'RUN_FINISHED')
        self.assertEqual((events[-1]['threadId'], events[-1]['runId']), ('server-thread', 'server-run'))
        final = next(event['messages'] for event in reversed(events) if event['type'] == 'MESSAGES_SNAPSHOT')
        self.assertEqual(len(final), 9)
        results = [message for message in final if message['role'] == 'tool']
        self.assertEqual(len(results), 5)
        for result in results:
            self.assertEqual(result['id'], result['toolCallId'])

    def test_invalid_protocol_request_is_rejected(self):
        with TestClient(actual_server()) as client:
            self.assertEqual(client.post('/agent', json={}).status_code, 422)


if __name__ == '__main__':
    unittest.main()
