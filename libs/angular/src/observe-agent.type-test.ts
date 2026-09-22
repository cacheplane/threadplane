import type { Signal } from '@angular/core';
import type { AgentSession, AgentSnapshot } from '@threadplane/core';
import { observeAgent } from './public-api.js';

interface Tools {
  weather: { args: { city: string }; result: { temperature: number } };
  count: { args: { values: readonly string[] }; result: number };
}

export function observeTypedSession(session: AgentSession<Tools>) {
  const signal = observeAgent(session);
  const exact: Signal<AgentSnapshot<Tools>> = signal;
  const snapshot = signal();
  for (const call of snapshot.toolCalls) {
    if (call.name === 'weather') {
      const city: string = call.args.city;
      // @ts-expect-error Heterogeneous names retain their own argument shape.
      void call.args.values;
      // @ts-expect-error Snapshot arguments are immutable.
      call.args.city = city;
      if (call.status === 'complete') {
        const temperature: number = call.result.temperature;
        // @ts-expect-error Weather results cannot widen to any or the count result.
        const count: number = call.result;
        void [temperature, count];
      }
    } else {
      const values: readonly string[] = call.args.values;
      // @ts-expect-error Count arguments cannot widen to any or the weather arguments.
      void call.args.city;
      if (call.status === 'complete') {
        const count: number = call.result;
        // @ts-expect-error Count results preserve the primitive type.
        void call.result.temperature;
        void count;
      }
      void values;
    }
    // @ts-expect-error Results are only present on completed calls.
    void call.result;
    // @ts-expect-error Tool names stay a literal union.
    const unknownName: 'missing' = call.name;
    void unknownName;
  }
  // @ts-expect-error Observation is read-only.
  signal.set(snapshot);
  // @ts-expect-error Commands remain on the borrowed session.
  snapshot.submit('Hello');
  return exact;
}
