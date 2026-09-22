import type { AgentSession } from '@threadplane/core';
import {
  createSession,
  type LangGraphInputState,
  type LangGraphSubmitInput,
} from './create-session';

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
const state = {
  model: 'model',
  reasoning: 'low',
  itinerary: [{ city: 'Paris', day: 1 }],
} as const satisfies LangGraphInputState;
const input: LangGraphSubmitInput = { message: '', state };
void session.submit(input);
void session.submit('Text');
void session.submit({ message: '' });
// @ts-expect-error State is recursively readonly.
state.itinerary[0].city = 'Rome';
// @ts-expect-error Message remains required.
void session.submit({ state });
// @ts-expect-error Runtime owns message assembly.
void session.submit({ message: 'Text', state: { messages: [] } });
// @ts-expect-error Runtime owns the client tool catalog.
void session.submit({ message: 'Text', state: { client_tools: [] } });
// @ts-expect-error State is a plain data record.
void session.submit({ message: 'Text', state: [] });
// @ts-expect-error Instances are not plain values.
void session.submit({ message: 'Text', state: { value: new Date() } });
// @ts-expect-error State belongs to input, not transport options.
void session.submit('Text', { state });
// @ts-expect-error Run config is deferred.
void session.submit('Text', { config: {} });
const observer: AgentSession = session;
// @ts-expect-error The neutral core still accepts text only.
void observer.submit(input);
interface ItineraryStop {
  readonly city: string;
  readonly day: number;
}
declare const itinerary: readonly ItineraryStop[];
// @ts-expect-error Interfaces need an explicit plain-record projection at this broad boundary.
void session.submit({ message: 'Plan', state: { itinerary } });
void session.submit({
  message: 'Plan',
  state: { itinerary: itinerary.map((stop) => ({ ...stop })) },
});
for (const call of session.getSnapshot().toolCalls) {
  if (call.status === 'complete') {
    const temperature: number = call.result.temperature;
    const city: string = call.args.city;
    // @ts-expect-error Typed tool inference survives the submit replacement.
    const wrong: string = call.result.temperature;
    void [temperature, city, wrong];
  }
}
