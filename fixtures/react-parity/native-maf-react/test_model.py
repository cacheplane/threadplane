"""The fixture is an OpenAI model seam, never an AG-UI event producer."""
import json
import threading
import unittest
from urllib.request import Request, urlopen
from model import Model

class ModelTest(unittest.TestCase):
    def test_physical_invalid_request_is_counted(self):
        model = Model('approval')
        thread = threading.Thread(target=model.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaises(Exception):
                urlopen(Request(f'http://127.0.0.1:{model.server_port}/wrong', data=b'{}'), timeout=2)
            self.assertEqual(model.stats()['httpSeen'], 1)
            self.assertEqual(model.stats()['requests'], 0)
        finally:
            model.closing.set(); model.shutdown(); model.server_close(); thread.join()

    def test_actual_typed_openai_lookup_response(self):
        model = Model('approval')
        thread = threading.Thread(target=model.serve_forever, daemon=True); thread.start()
        body = {'messages':[{'role':'user','content':'Blue Finch Bistro'}], 'stream':False}
        try:
            data=json.dumps(body).encode()
            response=json.load(urlopen(Request(f'http://127.0.0.1:{model.server_port}/v1/chat/completions',data=data,headers={'Content-Type':'application/json'}),timeout=2))
            self.assertEqual(response['choices'][0]['message']['tool_calls'][0]['function']['name'],'lookup_expense_policy')
            self.assertEqual(model.stats()['records'][0]['body'],body)
            self.assertEqual(model.stats()['httpSeen'],1)
        finally:
            model.closing.set(); model.shutdown(); model.server_close(); thread.join()

if __name__ == '__main__': unittest.main()
