import type {
  AgentSession,
  AgentSnapshot,
  PlainValue,
} from '@threadplane/core';
import { useAgent } from './index.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This type-only integration probe observes the actual private factory through the borrowed fixture.
import type { bindingFixture } from '../../langgraph/src/runtime/testing/binding-fixture';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only admission proof for the actual private native owner, not a production dependency.
import type { createSession } from '../../ag-ui/src/runtime/create-session';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The private native snapshot is inferred without a core display projection.
import type { SessionSnapshot } from '../../ag-ui/src/runtime/session-observation';

export function useInferredRuntime(
  session: ReturnType<typeof bindingFixture>['session']
) {
  const snapshot = useAgent(session);
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

export function useConcreteSession(session: ConcreteObserver) {
  const snapshot = useAgent(session);
  const exact: ConcreteSnapshot = snapshot;
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

export function useTypedSession(session: AgentSession<Tools>) {
  const snapshot = useAgent(session);
  const exact: AgentSnapshot<Tools> = snapshot;
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
  // @ts-expect-error The binding exposes a snapshot, not session commands.
  snapshot.submit('Hello');
  return exact;
}

export function useNativeSession(session: ReturnType<typeof createSession>) {
  const snapshot = useAgent(session);
  const exact: SessionSnapshot = snapshot;
  const state: PlainValue = snapshot.state;
  const name: string | undefined = snapshot.subagents[0]?.started.name;
  const terminal = snapshot.run?.terminal;
  if (terminal?.type === 'RUN_FINISHED') {
    const runId: string = terminal.runId;
    if (terminal.outcome?.type === 'interrupt') {
      const reason: string = terminal.outcome.interrupts[0].reason;
      // @ts-expect-error Native terminal payloads remain readonly.
      terminal.outcome.interrupts.push({ reason: 'changed' });
      void reason;
    }
    // @ts-expect-error Root terminal fields are readonly.
    terminal.runId = runId;
  }
  const child = snapshot.subagents[0]?.terminal;
  if (child?.type === 'SUBAGENT_ERROR') {
    const error: string = child.message;
    void error;
  }
  for (const message of snapshot.transcript) {
    if (message.role === 'assistant') {
      const raw: string | undefined =
        message.toolCalls?.[0]?.function.arguments;
      if (message.toolCalls?.[0]) {
        // @ts-expect-error Native arguments remain raw protocol strings, not decoded objects.
        const decoded: { city: string } =
          message.toolCalls[0].function.arguments;
        // @ts-expect-error Nested protocol tool fields stay readonly.
        message.toolCalls[0].function.arguments = '{}';
        void decoded;
      }
      void raw;
    }
    // @ts-expect-error Native transcript messages remain readonly.
    message.id = 'changed';
  }
  // @ts-expect-error Collections retain their readonly native shape.
  snapshot.transcript.push({ id: 'new', role: 'user', content: 'mutable' });
  // @ts-expect-error Child start evidence remains readonly.
  snapshot.subagents[0].started.name = 'changed';
  // @ts-expect-error The native owner does not fabricate executable core tools.
  void snapshot.toolCalls;
  // @ts-expect-error Commands belong to the session, not its snapshot.
  snapshot.submit('Hello');
  // @ts-expect-error The native state field is readonly.
  snapshot.state = {};
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    // @ts-expect-error Nested native state is readonly too.
    state['changed'] = true;
  }
  void [state, name];
  return exact;
}

export function useStructuralContract() {
  const primitive = useAgent({
    getSnapshot: () => 1,
    subscribe: () => () => undefined,
  });
  const exact: number = primitive;
  // @ts-expect-error Observation requires a snapshot getter.
  useAgent({ subscribe: () => () => undefined });
  // @ts-expect-error The snapshot getter must be callable.
  useAgent({ getSnapshot: 1, subscribe: () => () => undefined });
  // @ts-expect-error Observation requires a subscription method.
  useAgent({ getSnapshot: () => 1 });
  // @ts-expect-error Subscription must return a release function.
  useAgent({ getSnapshot: () => 1, subscribe: () => undefined });
  return exact;
}
