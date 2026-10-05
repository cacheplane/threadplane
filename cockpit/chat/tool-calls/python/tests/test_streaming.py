"""Actual compiled graph, streamed tool arguments and canonical checkpoints."""

import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from providers import AuthoredClient, TITLE, model_factory


class StreamingTests(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, text="Status UA123", *, title=None, fail=False):
        client = AuthoredClient(title=title, fail=fail)
        callbacks = []
        with (
            patch.object(
                socket.socket,
                "connect",
                side_effect=AssertionError("Remote socket forbidden"),
            ) as connect,
            patch(
                "langchain_openai.ChatOpenAI",
                model_factory,
            ),
            patch("langgraph_sdk.get_client", return_value=client),
            redirect_stdout(io.StringIO()) as diagnostics,
        ):
            path = Path(__file__).parents[1] / "src/graph.py"
            spec = importlib.util.spec_from_file_location(
                "authored_tool_calls_graph", path
            )
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            graph = module.build_tool_calls_graph().builder.compile(
                checkpointer=InMemorySaver()
            )
            config = {"configurable": {"thread_id": "authored-thread"}}
            async for kind, event in graph.astream(
                {"messages": [HumanMessage(content=text, id="authored-human")]},
                config,
                stream_mode=["messages", "values"],
            ):
                if kind == "messages":
                    callbacks.append(event)
            saved = graph.get_state(config)
            self.assertFalse(saved.next)
            self.assertFalse(saved.tasks)
            messages = saved.values["messages"]
            calls = {
                call["id"]: (index, call)
                for index, message in enumerate(messages)
                if message.type == "ai"
                for call in message.tool_calls
            }
            results = [
                (index, message)
                for index, message in enumerate(messages)
                if message.type == "tool"
            ]
            self.assertEqual(len(calls), len(results))
            for index, result in results:
                owner_index, call = calls[result.tool_call_id]
                self.assertLess(owner_index, index)
                self.assertEqual(call["name"], result.name)
                self.assertEqual(
                    next(
                        message.id
                        for message, _ in callbacks
                        if message.type == "tool"
                        and message.tool_call_id == result.tool_call_id
                    ),
                    result.id,
                )
            self.assertTrue(messages[-1].content)
            self.assertEqual(messages[-1].type, "ai")
            connect.assert_not_called()
        return messages, callbacks, client, diagnostics.getvalue()

    async def test_absent_title_preserves_tool_stream_without_title_callbacks(self):
        messages, callbacks, client, _ = await self.scenario()
        self.assertEqual(
            client.threads.updates, [("authored-thread", {"title": TITLE})]
        )
        self.assertEqual(
            [
                message
                for message, metadata in callbacks
                if metadata.get("langgraph_node") == "generate_title"
            ],
            [],
        )
        self.assertIn("UA123", messages[-1].content)

    async def test_existing_title_skips_metadata_generation(self):
        _, callbacks, client, _ = await self.scenario(title="Existing")
        self.assertFalse(client.threads.updates)
        self.assertFalse(
            [
                message
                for message, metadata in callbacks
                if metadata.get("langgraph_node") == "generate_title"
            ]
        )

    async def test_metadata_failure_preserves_real_tool_result(self):
        messages, _, client, diagnostics = await self.scenario(fail=True)
        self.assertFalse(client.threads.updates)
        self.assertIn("Authored metadata read failure", diagnostics)
        self.assertIn("UA123", messages[-1].content)

    async def test_parallel_same_name_calls_keep_distinct_arguments_and_results(self):
        messages, callbacks, _, _ = await self.scenario(
            "Compare airports", title="Existing"
        )
        results = [
            json.loads(message.content)
            for message in messages
            if message.type == "tool"
        ]
        self.assertEqual({result["code"] for result in results}, {"LAX", "JFK"})
        chunks = [
            chunk
            for message, _ in callbacks
            for chunk in getattr(message, "tool_call_chunks", [])
        ]
        self.assertTrue(
            any(chunk.get("name") is None and chunk.get("args") for chunk in chunks)
        )

    async def test_sequential_calls_have_separate_requesting_assistants(self):
        messages, _, _, _ = await self.scenario("Sequential lookup", title="Existing")
        self.assertEqual(
            [message.name for message in messages if message.type == "tool"],
            ["lookup_flight", "get_airport_info"],
        )
        self.assertEqual(
            len(
                [
                    message
                    for message in messages
                    if message.type == "ai" and message.tool_calls
                ]
            ),
            2,
        )

    async def test_routes_return_real_dataset(self):
        messages, _, _, _ = await self.scenario("Routes tomorrow", title="Existing")
        result = json.loads(
            next(message.content for message in messages if message.type == "tool")
        )
        self.assertEqual(
            (result["from"], result["to"], result["date_offset_days"]),
            ("LAX", "JFK", 1),
        )
        self.assertTrue(result["flights"])

    async def test_domain_error_is_ordinary_tool_data(self):
        messages, _, _, _ = await self.scenario("Unknown flight", title="Existing")
        result = next(message for message in messages if message.type == "tool")
        self.assertEqual(result.status, "success")
        self.assertIn("not found", json.loads(result.content)["error"])

    async def test_invocation_validation_error_remains_literal_error_observation(self):
        messages, _, _, _ = await self.scenario("Malformed flight", title="Existing")
        result = next(message for message in messages if message.type == "tool")
        self.assertEqual(result.status, "error")
        self.assertIn("Error invoking tool", result.content)
        self.assertEqual(messages[1].tool_calls[0]["args"], {"flight_number": 123})

    async def test_text_only_answer_has_no_tool_observations(self):
        messages, _, _, _ = await self.scenario("No tools", title="Existing")
        self.assertEqual([message.type for message in messages], ["human", "ai"])


if __name__ == "__main__":
    unittest.main()
