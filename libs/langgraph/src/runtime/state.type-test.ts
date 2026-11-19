import {
  type,
  type AgentSession,
  type PlainValue,
  type StandardSchemaV1,
} from '@threadplane/core';
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
const state: Readonly<Record<string, PlainValue>> | undefined = snapshot.state;
// @ts-expect-error A session with no declared state type assumes no fields.
const assumed: number = snapshot.state?.['counter'];
// @ts-expect-error State cannot be assigned.
snapshot.state = {};
if (snapshot.state) {
  // @ts-expect-error The broad application record is readonly.
  snapshot.state['counter'] = 1;
  const nested = snapshot.state['nested'];
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
// @ts-expect-error The snapshot no longer has a field named values.
void snapshot.values;

// A declared type reaches the snapshot and the submission.
interface Trip {
  readonly stops: { city: string; nights: number }[];
  draft?: string;
}
const typed = createSession({
  assistantId: 'a',
  threadId: 't',
  stateType: type<Trip>(),
});
const trip = typed.getSnapshot().state;
const city: string | undefined = trip?.stops[0]?.city;
const draft: string | undefined = trip?.draft;
// @ts-expect-error Declared fields keep their types.
const wrong: number | undefined = trip?.draft;
// @ts-expect-error The declared state has no such field.
void trip?.missing;
// @ts-expect-error Declared state is deeply readonly.
if (trip) trip.stops[0].city = 'Lyon';
void typed.submit({ message: 'Go', state: { draft: 'x' } });
void typed.submit('Go');
// @ts-expect-error A submission holds only declared fields.
void typed.submit({ message: 'Go', state: { other: 1 } });
// @ts-expect-error A declared field keeps its type in a submission.
void typed.submit({ message: 'Go', state: { draft: 1 } });
// @ts-expect-error The session assembles messages itself.
void typed.submit({ message: 'Go', state: { messages: [] } });
void typed.fork({ checkpointId: 'c' } as never, {
  message: 'Go',
  state: { draft: 'x' },
});
const typedObserver: AgentSession = typed;
const typedCore: AgentSession<Record<string, never>, Trip> = typed;

// A schema's output is the state type; tools and state infer together.
declare const schema: StandardSchemaV1<unknown, { count: number }>;
const checked = createSession({
  assistantId: 'a',
  threadId: 't',
  stateType: schema,
  tools: {
    weather: {
      description: 'Weather',
      handler: (args: { city: string }) => ({ temperature: args.city.length }),
    },
  },
});
const count: number | undefined = checked.getSnapshot().state?.count;
const issues: readonly string[] | undefined = checked.getSnapshot().stateIssues;
for (const call of checked.getSnapshot().toolCalls)
  if (call.status === 'complete')
    void (call.result.temperature satisfies number);
// @ts-expect-error A class instance is not a state declaration.
createSession({ assistantId: 'a', threadId: 't', stateType: new Date() });
// @ts-expect-error A child graph's state is not the declared type.
void checked.getSnapshot().subgraphs[0]?.state?.count.toFixed();

void [
  observer,
  exact,
  state,
  assumed,
  city,
  draft,
  wrong,
  typedObserver,
  typedCore,
  count,
  issues,
];
