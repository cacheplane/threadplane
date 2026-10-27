"""Exercise the source-declared FastAPI route with the real frozen graph."""
import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import patch
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from test_streaming import actual_graph, request


class WeatherEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_actual_endpoint_clones_keep_same_thread_canonical_history(self):
        graph_module = ModuleType('src.graph')
        graph_module.graph = actual_graph()
        path = Path(__file__).resolve().parents[1] / 'src/server.py'
        spec = importlib.util.spec_from_file_location(f'src.frozen_server_{uuid4().hex}', path)
        server = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'src.graph': graph_module}):
            spec.loader.exec_module(server)
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url='http://frozen') as client:
            self.assertEqual((await client.get('/ok')).json(), {'ok': True})
            history = []
            for index, mode in enumerate(['batch', 'zero']):
                human = {'id': f'endpoint-human-{index}', 'role': 'user', 'content': mode}
                body = request('endpoint-weather-thread', f'endpoint-run-{index}', history + [human])
                response = await client.post('/agent', json=body.model_dump(by_alias=True, exclude_none=True))
                self.assertEqual(response.status_code, 200)
                self.assertIn('text/event-stream', response.headers['content-type'])
                wire = [json.loads(line[5:].strip()) for line in response.text.splitlines() if line.startswith('data:')]
                self.assertEqual(wire[-1]['type'], 'RUN_FINISHED')
                self.assertEqual(wire[-1]['runId'], f'endpoint-run-{index}')
                final = next(event['messages'] for event in reversed(wire) if event['type'] == 'MESSAGES_SNAPSHOT')
                self.assertEqual(final[:len(history)], history)
                self.assertEqual(final[len(history)], human)
                self.assertEqual(len(final), 5 if index == 0 else 7)
                self.assertEqual(len({message['id'] for message in final}), len(final))
                self.assertEqual(len([event for event in wire if event['type'] == 'TOOL_CALL_RESULT']), 2 if index == 0 else 0)
                history = final


if __name__ == '__main__':
    unittest.main()
