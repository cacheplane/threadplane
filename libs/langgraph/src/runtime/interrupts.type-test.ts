import type { AgentSession, PlainValue } from '@threadplane/core';
import { createSession } from './create-session';
import type { LangGraphInterrupt } from './langgraph-snapshot';

const session = createSession({
  assistantId: 'a',
  threadId: 't',
  tools: {
    weather: {
      description: 'Weather',
      handler: (args: { city: string }) => ({ temperature: args.city.length }),
    },
  },
});
const observer: AgentSession = session;
const snapshot = session.getSnapshot();
const interrupts: readonly LangGraphInterrupt[] = snapshot.interrupts;
const value: PlainValue = interrupts[0]?.value;
// @ts-expect-error Snapshot fields are readonly.
snapshot.interrupts = [];
// @ts-expect-error The batch is readonly.
snapshot.interrupts.push({ value: false });
// @ts-expect-error Namespace metadata is deeply readonly.
snapshot.interrupts[0].namespace?.push('changed');
// @ts-expect-error Broad backend data does not infer an application schema.
const assumed: { approved: boolean } = value;
if (value && typeof value === 'object' && !Array.isArray(value)) {
  // @ts-expect-error Payload fields are readonly.
  value['approved'] = true;
}
for (const call of snapshot.toolCalls)
  if (call.status === 'complete') {
    const temperature: number = call.result.temperature;
    // @ts-expect-error Adding interrupts preserves authored tool result inference.
    const bad: string = call.result.temperature;
    void [temperature, bad];
  }
void [observer, interrupts, value, assumed];
