import type { Signal } from '@angular/core';
import type {
  AgentSession,
  AgentSnapshot,
  PlainValue,
} from '@threadplane/core';
import { observeAgent } from './public-api.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This type-only integration probe observes the actual private factory through the borrowed fixture.
import type { bindingFixture } from '../../langgraph/src/runtime/testing/binding-fixture';

export function observeInferredRuntime(
  session: ReturnType<typeof bindingFixture>['session']
) {
  const snapshot = observeAgent(session)();
  const payload = snapshot.interrupts[0]?.value;
  const plainPayload: PlainValue = payload;
  const namespace: readonly string[] | undefined =
    snapshot.interrupts[0]?.namespace;
  // @ts-expect-error The backend interrupt field remains readonly.
  snapshot.interrupts = [];
  // @ts-expect-error The observed batch remains readonly.
  snapshot.interrupts.push({ value: false });
  // @ts-expect-error Namespace metadata remains readonly.
  snapshot.interrupts[0].namespace?.push('changed');
  // @ts-expect-error The broad backend payload has no inferred application schema.
  const assumed: { approved: boolean } = payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    // @ts-expect-error Nested payload fields remain readonly.
    payload['changed'] = true;
  }
  for (const call of snapshot.toolCalls)
    if (call.status === 'complete') {
      if (call.name === 'weather') {
        const temperature: number = call.result.temperature;
        // @ts-expect-error The weather result retains its authored object shape.
        const wrong: number = call.result;
        void [temperature, wrong];
      } else {
        const count: number = call.result;
        // @ts-expect-error The count result retains its authored primitive shape.
        void call.result.temperature;
        void count;
      }
    }
  void [plainPayload, namespace, assumed];
  return snapshot;
}

interface Tools {
  weather: { args: { city: string }; result: { temperature: number } };
  count: { args: { values: readonly string[] }; result: number };
}

interface ConcreteSnapshot extends AgentSnapshot<Tools> {
  readonly backend: 'concrete';
  readonly values: {
    readonly counter: number;
    readonly items: readonly string[];
  };
}

class ConcreteObserver {
  constructor(readonly snapshot: ConcreteSnapshot) {}
  getSnapshot() {
    return this.snapshot;
  }
  subscribe(notify: () => void) {
    void notify;
    return () => undefined;
  }
}

export function observeConcreteSession(session: ConcreteObserver) {
  const observation = observeAgent(session);
  const exact: Signal<ConcreteSnapshot> = observation;
  const snapshot = observation();
  const count: number = snapshot.values.counter;
  const backend: 'concrete' = snapshot.backend;
  // @ts-expect-error The concrete values field remains readonly.
  snapshot.values = { counter: 2, items: [] };
  // @ts-expect-error Concrete fields remain readonly.
  snapshot.values.counter = 2;
  // @ts-expect-error Nested concrete arrays remain readonly.
  snapshot.values.items.push('mutable');
  // @ts-expect-error Exact concrete fields cannot widen to any.
  const invalid: string = snapshot.values.counter;
  void [count, backend, invalid];
  return exact;
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
