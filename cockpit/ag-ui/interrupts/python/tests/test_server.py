import ast
import importlib
import json
import sys
from types import ModuleType
from pathlib import Path
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint
from src.native_agent import NativeRefundAgent

from test_streaming import FIELDS, actual_graph, final_messages, request


def standalone_app():
    graph, _ = actual_graph('tool')
    module = ModuleType('src.graph')
    module.graph = graph
    with patch.dict(sys.modules, {'src.graph': module}):
        server = importlib.reload(importlib.import_module('src.server'))
    return server.app


def decode(response):
    return [
        json.loads(block.removeprefix('data:').strip())
        for block in response.text.split('\n\n')
        if block.startswith('data:')
    ]


def generated_refund_app():
    """Execute the real generated mounts and middleware, isolating other runtimes."""
    root = Path(__file__).resolve().parents[5]
    path = root / 'deployments/ag-ui-dev/server.py'
    parsed = ast.parse(path.read_text(), filename=str(path))
    selected = []
    for node in parsed.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'app' for target in node.targets):
            selected.append(node)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in ['require_internal_token', 'ok']:
            selected.append(node)
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            paths = [keyword.value.value for keyword in node.value.keywords if keyword.arg == 'path' and isinstance(keyword.value, ast.Constant)]
            if any(value in ['/agent/interrupts', '/agent/interrupts/native'] for value in paths):
                selected.append(node)
    graph, _ = actual_graph('tool')
    namespace = {
        'FastAPI': FastAPI, 'Request': Request, 'JSONResponse': JSONResponse,
        'LangGraphAgent': LangGraphAgent, 'NativeRefundAgent': NativeRefundAgent,
        'add_langgraph_fastapi_endpoint': add_langgraph_fastapi_endpoint,
        'interrupts_graph': graph, 'AG_UI_INTERNAL_TOKEN': 'frozen-internal-token',
    }
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(path), 'exec'), namespace)
    return namespace['app']


class RefundEndpointTests(unittest.IsolatedAsyncioTestCase):
    app_factory = staticmethod(standalone_app)
    native_path = '/agent/native'
    ordinary_path = '/agent'
    headers = {}

    async def test_native_endpoint_uses_structured_pause_and_resume(self):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app_factory()), base_url='http://example.test', headers=self.headers,
        ) as client:
            human = {'id': 'native-http-human', 'role': 'user', 'content': 'Draft a fictional refund.'}
            body = request('native-http-thread', 'native-http-run', [human])
            response = await client.post(self.native_path, json=body.model_dump(by_alias=True, exclude_none=True))
            self.assertEqual(response.status_code, 200, 'The native counterpart must be separately mounted')
            paused = decode(response)
            self.assertFalse(any(event.get('name') == 'on_interrupt' for event in paused))
            finish = next(event for event in reversed(paused) if event['type'] == 'RUN_FINISHED')
            self.assertEqual(finish['runId'], body.run_id)
            self.assertEqual(finish['outcome']['type'], 'interrupt')
            selected = finish['outcome']['interrupts'][0]
            self.assertEqual(selected['metadata']['langgraph']['raw'], {'kind': 'refund_approval', **FIELDS})
            messages = final_messages(paused)
            resumed = request('native-http-thread', 'native-http-resume', messages, resume=[{
                'interruptId': selected['id'], 'status': 'resolved', 'payload': {'approved': True, 'amount': 20},
            }])
            result = await client.post(self.native_path, json=resumed.model_dump(by_alias=True, exclude_none=True))
            self.assertEqual(result.status_code, 200)
            final = final_messages(decode(result))
            self.assertEqual(final[:2], messages)
            self.assertIn('$20.00', final[-1]['content'])
            self.assertEqual((await client.get(self.native_path + '/health')).status_code, 200)

    async def test_ordinary_endpoint_preserves_legacy_approve_and_cancel(self):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app_factory()), base_url='http://example.test', headers=self.headers,
        ) as client:
            for approved in [True, False]:
                thread = f'legacy-http-{approved}'
                human = {'id': f'human-{approved}', 'role': 'user', 'content': 'Draft a fictional refund.'}
                paused_response = await client.post(self.ordinary_path, json=request(
                    thread, f'run-{approved}', [human],
                ).model_dump(by_alias=True, exclude_none=True))
                self.assertEqual(paused_response.status_code, 200)
                paused = decode(paused_response)
                notice = next(event for event in paused if event.get('name') == 'on_interrupt')
                self.assertEqual(json.loads(notice['value']), {'kind': 'refund_approval', **FIELDS})
                finish = next(event for event in reversed(paused) if event['type'] == 'RUN_FINISHED')
                self.assertNotIn('outcome', finish)
                messages = final_messages(paused)
                resumed = await client.post(self.ordinary_path, json=request(
                    thread, f'resume-{approved}', messages, legacy={'approved': approved},
                ).model_dump(by_alias=True, exclude_none=True))
                self.assertEqual(resumed.status_code, 200)
                completed = decode(resumed)
                self.assertEqual(final_messages(completed)[:2], messages)
                self.assertIn('$47.50' if approved else 'Refund cancelled', final_messages(completed)[-1]['content'])
                terminal = next(event for event in reversed(completed) if event['type'] == 'RUN_FINISHED')
                self.assertNotIn('outcome', terminal)


class GeneratedRefundEndpointTests(RefundEndpointTests):
    app_factory = staticmethod(generated_refund_app)
    native_path = '/agent/interrupts/native'
    ordinary_path = '/agent/interrupts'
    headers = {'X-Internal-Token': 'frozen-internal-token'}

    async def test_generated_native_and_ordinary_endpoints_require_the_internal_token(self):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app_factory()), base_url='http://example.test',
        ) as client:
            for path in [self.native_path, self.ordinary_path]:
                self.assertEqual((await client.post(path, json={})).status_code, 401)
                self.assertEqual((await client.get(path + '/health')).status_code, 401)
            self.assertEqual((await client.get('/ok')).status_code, 200)


if __name__ == '__main__':
    unittest.main()
