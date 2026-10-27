import type { AgentSession, PlainValue } from '@threadplane/core';
import { createSession } from './create-session';
import type { LangGraphSnapshot } from './langgraph-snapshot';

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
const exact: LangGraphSnapshot<{
  weather: { args: { city: string }; result: { temperature: number } };
}> = snapshot;
const values: Readonly<Record<string, PlainValue>> | undefined =
  snapshot.values;
// @ts-expect-error The backend does not infer an application schema.
const assumed: number = snapshot.values?.['counter'];
// @ts-expect-error Values fields cannot be assigned.
snapshot.values = {};
if (snapshot.values) {
  // @ts-expect-error The broad application record is readonly.
  snapshot.values['counter'] = 1;
  const nested = snapshot.values['nested'];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    // @ts-expect-error Plain nested data is readonly too.
    nested['mutable'] = true;
  }
}
for (const call of snapshot.toolCalls)
  if (call.status === 'complete') {
    const temperature: number = call.result.temperature;
    // @ts-expect-error Authored result inference is retained by the replacement getter.
    const bad: string = call.result.temperature;
    void [temperature, bad];
  }
void [observer, exact, values, assumed];
