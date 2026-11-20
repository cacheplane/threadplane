import type {
  AgentSession,
  AgentSubagent,
  Message,
  PlainValue,
  ToolCall,
} from '@threadplane/core';
import { createSession } from './create-session';
import type { LangGraphSubgraph } from './langgraph-snapshot';
import type { LangGraphSubagent } from './subagent-projection';
const session = createSession({
  assistantId: 'a',
  threadId: 't',
  tools: {
    weather: {
      description: 'Weather',
      handler: (args: { city: string }) => ({ temperature: args.city.length }),
    },
    count: {
      description: 'Count',
      handler: (args: { items: string[] }) => args.items.length,
    },
  },
});
const observer: AgentSession = session;
const snapshot = session.getSnapshot();
const children: readonly LangGraphSubgraph[] = snapshot.subgraphs;
const messages: readonly Message[] = children[0].messages;
const payload: PlainValue = children[0].state?.['any'];
// Child graphs are also published as the core contract's child agents.
const agents: readonly LangGraphSubagent[] = snapshot.subagents;
const coreAgents: readonly AgentSubagent[] | undefined =
  observer.getSnapshot().subagents;
const agentCalls: readonly ToolCall[] = agents[0].toolCalls;
const childCalls: readonly ToolCall[] = children[0].toolCalls;
const path: readonly string[] = agents[0].namespace;
// @ts-expect-error The child agents are derived, not assigned.
snapshot.subagents = [];
// @ts-expect-error A child agent exposes no commands.
agents[0].resume([]);
void [coreAgents, agentCalls, childCalls, path];
// @ts-expect-error Observation collection is readonly.
snapshot.subgraphs = [];
// @ts-expect-error Observation arrays are readonly.
children.push(children[0]);
// @ts-expect-error Namespace tuples are readonly.
children[0].namespace.push('wrong');
// @ts-expect-error Transcript messages are readonly.
messages[0].content = 'wrong';
// @ts-expect-error Child observations expose no commands.
children[0].resume(true);
for (const call of snapshot.toolCalls) {
  if (call.name === 'weather' && call.status === 'complete') {
    const temperature: number = call.result.temperature;
    const city: string = call.args.city;
    // @ts-expect-error Result remains authored and heterogeneous.
    const bad: string = call.result.temperature;
    void [temperature, city, bad];
  }
  if (call.name === 'count' && call.status === 'complete') {
    const count: number = call.result;
    void count;
  }
}
void [observer, payload];
