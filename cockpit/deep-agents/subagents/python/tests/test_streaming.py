"""Offline contracts against the unchanged builder and pinned SubAgentMiddleware."""
import asyncio
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
import deepagents

SCENARIOS = ("single", "parallel", "duplicates", "no-task", "tool-error", "general-purpose", "default-tool", "root-tool-error")
def call(name, args, identity):
    return {"name": name, "args": args, "id": identity, "type": "tool_call"}

class LocalModel(BaseChatModel):
    scenario: str = "single"
    @property
    def _llm_type(self):
        return "local-subagents-contract"
    def bind_tools(self, tools, **kwargs):
        return self
    def answer(self, messages):
        human = next(m for m in reversed(messages) if m.type == "human")
        turn = messages[messages.index(human):]
        tools = [m for m in turn if m.type == "tool"]
        system = " ".join(str(m.content) for m in messages if m.type == "system")
        field = "You research airport field data" in system
        weather = "You read weather for a dispatch desk" in system
        # General-purpose receives the inherited parent's system instructions; its
        # seeded description is explicitly distinct from an actual parent human.
        general = human.content == "General-purpose local report."
        identity = human.id or "seed"
        if field or weather:
            airport = next(a for a in ("KSFO", "KASE", "KDEN") if a in human.content)
            if not tools:
                names = ["lookup_weather"] if weather else ["lookup_field_elevation", "lookup_runway_length"]
                args = {} if "Invalid lookup" in human.content else {"airport": airport}
                return AIMessage(content="", tool_calls=[call(n, args, identity+"-"+n) for n in names])
            return AIMessage(content="Observed lookup: " + " | ".join(str(t.content) for t in tools))
        if general:
            return AIMessage(content="General-purpose local report ready.")
        if tools:
            return AIMessage(id=identity+"-final", content="Dispatch assessment: " + " | ".join(str(t.content) for t in tools))
        if self.scenario == "no-task":
            return AIMessage(id=identity+"-final", content="No delegation requested.")
        if self.scenario == "default-tool":
            return AIMessage(id=identity+"-dispatch", content="", tool_calls=[call("ls", {"path":"/"}, identity+"-ls")])
        if self.scenario == "root-tool-error":
            return AIMessage(id=identity+"-dispatch", content="", tool_calls=[
                call("task", {"subagent_type": "field-researcher"}, identity+"-invalid-task")
            ])
        if self.scenario == "general-purpose":
            tasks = [("general-purpose", "General-purpose local report.")]
        elif self.scenario in ("parallel", "duplicates"):
            tasks = [(role, "Research "+airport+" dispatch.") for airport in ("KASE", "KDEN") for role in ("field-researcher", "weather-analyst")]
            if self.scenario == "duplicates":
                tasks = [("field-researcher", "Research KASE dispatch.")] * 4
        elif self.scenario == "tool-error":
            tasks = [("field-researcher", "Invalid lookup KSFO dispatch.")]
        else:
            tasks = [("field-researcher", "Research KSFO dispatch.")]
        return AIMessage(id=identity+"-dispatch", content="", tool_calls=[call("task", {"description":desc,"subagent_type":role}, identity+"-task-"+str(i)) for i,(role,desc) in enumerate(tasks)])
    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(generations=[ChatGeneration(message=self.answer(messages))])
    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        answer = self.answer(messages)
        for start in range(0, len(answer.content), 17):
            yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id, content=answer.content[start:start+17]))
        for i, tc in enumerate(answer.tool_calls):
            args=json.dumps(tc["args"])
            for part, fragment in enumerate((args[:3], args[3:])):
                yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id,content="",tool_call_chunks=[{"index":i,"id":tc["id"] if part==0 else None,"name":tc["name"] if part==0 else None,"args":fragment}]))
        yield ChatGenerationChunk(message=AIMessageChunk(id=answer.id,content="",chunk_position="last"))
    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        # Delays belong only to the deterministic model. Actual child tools and
        # graph scheduling remain untouched; faster weather finishes first.
        system=" ".join(str(m.content) for m in messages if m.type=="system")
        if "You research airport field data" in system:
            await asyncio.sleep(.04)
        for chunk in self._stream(messages, stop, run_manager, **kwargs):
            yield chunk


def build(model):
    with patch("langchain_openai.ChatOpenAI", return_value=model):
        path=Path(__file__).parents[1]/"src/graph.py"
        spec=importlib.util.spec_from_file_location("local_subagents_contract",path)
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        return module.build_subagents_agent().builder.compile(checkpointer=InMemorySaver())

class SubagentsStreamingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        network=self.enterContext(patch.object(socket.socket,"connect",side_effect=AssertionError("Remote socket forbidden")))
        self.addCleanup(network.assert_not_called)
        self.model=LocalModel(); self.graph=build(self.model)
        self.config={"configurable":{"thread_id":"subagents-contract"}}
    async def send(self, scenario, identity="turn"):
        self.model.scenario=scenario
        events=[deepcopy(e) async for e in self.graph.astream({"messages":[{"type":"human","id":identity,"content":"Dispatch request."}]},self.config,subgraphs=True,stream_mode=["messages","values","updates","checkpoints"])]
        saved=await self.graph.aget_state(self.config)
        self.assertEqual(saved.values,(await self.graph.aget_state(saved.config)).values)
        history=[s async for s in self.graph.aget_state_history(self.config)]
        self.assertEqual(history[0].values,saved.values)
        root=[data for ns,kind,data in events if not ns and kind=="values"]
        self.assertEqual({m.id: m for m in root[-1]["messages"]},{m.id: m for m in saved.values["messages"]})
        self.assertEqual(saved.next,()); self.assertEqual(saved.tasks,())
        return saved,events
    async def test_single_real_lookup_child_and_parent_report(self):
        saved,events=await self.send("single")
        self.assertIn("13 ft",saved.values["messages"][-1].content)
        self.assertIn("11870 ft",saved.values["messages"][-1].content)
        children=[data for ns,kind,data in events if ns and kind=="values"]
        self.assertTrue(children)
        self.assertTrue(any(m.type=="tool" for d in children for m in d["messages"]))
        self.assertTrue(any(m.type=="human" for d in children for m in d["messages"]))
    async def test_four_parallel_calls_with_reversed_completion(self):
        saved,events=await self.send("parallel")
        dispatch=next(m for m in saved.values["messages"] if m.type=="ai" and m.tool_calls)
        self.assertEqual(len(dispatch.tool_calls),4)
        self.assertEqual({t["args"]["subagent_type"] for t in dispatch.tool_calls},{"field-researcher","weather-analyst"})
        namespaces={ns for ns,kind,data in events if ns}
        self.assertEqual(len(namespaces),4)
        for text in ("7820 ft","5434 ft","mountain wave","gusting 31"):
            self.assertIn(text,saved.values["messages"][-1].content)
        finishes=[(ns,d) for ns,k,d in events if ns and k=="values" and d["messages"][-1].type=="ai" and not d["messages"][-1].tool_calls]
        self.assertTrue(any(m.type=="tool" and m.name=="lookup_weather" for m in finishes[0][1]["messages"]))
    async def test_identical_descriptions_and_repeated_turns(self):
        for identity in ("first","second"):
            saved,events=await self.send("duplicates",identity)
            self.assertEqual(len({ns for ns,k,d in events if ns}),4)
            calls=[m for m in saved.values["messages"] if m.id==identity+"-dispatch"][0].tool_calls
            self.assertEqual(len({c["id"] for c in calls}),4)
            self.assertEqual(len({c["args"]["description"] for c in calls}),1)
        self.assertEqual(len([m for m in saved.values["messages"] if m.type=="human"]),2)
    async def test_real_root_task_schema_error_is_reported_then_parent_finishes(self):
        saved, events = await self.send("root-tool-error")
        dispatch = next(m for m in saved.values["messages"] if m.type == "ai" and m.tool_calls)
        self.assertEqual(dispatch.tool_calls[0]["args"], {"subagent_type": "field-researcher"})
        reports = [m for m in saved.values["messages"] if m.type == "tool"]
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0].status, "error")
        self.assertEqual(reports[0].tool_call_id, dispatch.tool_calls[0]["id"])
        self.assertIn("description", reports[0].content)
        self.assertFalse(any(ns for ns, kind, data in events))
        self.assertEqual(saved.values["messages"][-1].type, "ai")

    async def test_no_task_general_purpose_default_tool_and_legitimate_error(self):
        for scenario in ("no-task","general-purpose","default-tool","tool-error"):
            saved,events=await self.send(scenario,scenario)
            if scenario=="no-task": self.assertFalse(any(ns for ns,k,d in events))
            if scenario=="default-tool": self.assertTrue(any(m.type=="tool" and m.name=="ls" and m.status=="success" for m in saved.values["messages"]))
            if scenario=="general-purpose": self.assertIn("General-purpose local report ready",saved.values["messages"][-1].content)
            if scenario=="tool-error":
                self.assertTrue(any(m.type=="tool" and m.status=="error" for ns,k,d in events if ns and k=="values" for m in d["messages"]))

if __name__=="__main__": unittest.main()
