/* eslint @typescript-eslint/no-unused-vars: ["warn", { "argsIgnorePattern": "^_" }] */
import type { AgentSession } from '@threadplane/core';
import { createSession } from './create-session';

interface Args {
  city: string;
}
interface Result {
  temperature: number;
}
const session = createSession({
  assistantId: 'a',
  threadId: 't',
  tools: {
    weather: {
      description: 'Weather',
      handler: async (args: Args): Promise<Result> => ({
        temperature: args.city.length,
      }),
    },
    ping: { description: 'Ping', handler: (_args: void): void => undefined },
  },
});
const observer: AgentSession = session;
for (const call of session.getSnapshot().toolCalls) {
  if (call.name === 'weather' && call.status === 'complete') {
    const result: number = call.result.temperature;
    const arg: string = call.args.city;
    // @ts-expect-error no any result fallback
    const wrong: string = call.result.temperature;
    // @ts-expect-error no unknown tool-name widening
    const wrongName: 'other' = call.name;
    void [result, arg, wrong, wrongName];
  }
}
// @ts-expect-error unsupported concrete handler argument data
createSession({
  assistantId: 'a',
  threadId: 't',
  tools: { invalid: { description: 'No', handler: (_args: Date) => '' } },
});
// @ts-expect-error unsupported concrete handler result data
createSession({
  assistantId: 'a',
  threadId: 't',
  tools: {
    invalid: { description: 'No', handler: (_args: string) => new Map() },
  },
});
createSession({
  assistantId: 'a',
  threadId: 't',
  // @ts-expect-error no implicit any handler fallback
  tools: { invalid: { description: 'No', handler: (args) => args.missing } },
});
void observer;
const unsupported = {
  assistantId: 'a',
  threadId: 't',
  tools: { invalid: { description: 'Invalid', handler: (_args: Date) => '' } },
};
// @ts-expect-error a non-fresh options variable cannot select the no-tools overload
createSession(unsupported);
