import type {
  AgentError,
  AgentSession,
  AgentSnapshot,
  CompleteOutcome,
  Message,
  PlainValue,
  ToolCall,
} from '@threadplane/core';
import type { FunctionTool } from '@threadplane/core/tools';
import type { FixtureTools } from './scenarios';

/* BINDING_IMPORT */

export function assertSnapshot(snapshot: AgentSnapshot<FixtureTools>) {
  /* BACKEND_VALUES */
  for (const call of snapshot.toolCalls) {
    if (call.name === 'weather') {
      const city: string = call.args.city;
      // @ts-expect-error Heterogeneous tool arguments remain distinct.
      void call.args.values;
      // @ts-expect-error Snapshot arguments are deeply readonly.
      call.args.city = city;
      if (call.status === 'complete') {
        const temperature: number = call.result.temperature;
        // @ts-expect-error Result retains its authored object shape.
        const count: number = call.result;
        // @ts-expect-error Results are readonly too.
        call.result.temperature = temperature;
        void count;
      }
    } else {
      const values: readonly string[] = call.args.values;
      // @ts-expect-error Nested arrays remain readonly.
      call.args.values.push('extra');
      // @ts-expect-error Count has no city argument.
      void call.args.city;
      if (call.status === 'complete') {
        const count: number = call.result;
        // @ts-expect-error Count result does not widen to any.
        void call.result.temperature;
        void count;
      }
      void values;
    }
    // @ts-expect-error Results require status narrowing.
    void call.result;
    // @ts-expect-error Names remain a literal union.
    const unknownName: 'missing' = call.name;
    void unknownName;
  }
  // @ts-expect-error Aggregate collections are immutable.
  snapshot.toolCalls.push({} as ToolCall<FixtureTools>);
}

export function assertCore(
  session: AgentSession<FixtureTools>,
  signal: AbortSignal
) {
  const snapshot: AgentSnapshot<FixtureTools> = session.getSnapshot();
  assertSnapshot(snapshot);
  void session.submit('Hello', { signal });
  // @ts-expect-error The neutral session does not acquire backend application input.
  void session.submit({ message: 'Hello', state: { model: 'gpt-5-mini' } });
  const tool: FunctionTool<{ values: readonly string[] }, number> = {
    description: 'Count values',
    handler: ({ values }, context) => {
      const standardSignal: AbortSignal = context.signal;
      void standardSignal;
      return values.length;
    },
  };
  return tool;
}
