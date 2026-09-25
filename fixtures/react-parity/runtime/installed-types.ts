import type {
  AgentError,
  AgentSession,
  AgentSnapshot,
  Citation,
  CompleteOutcome,
  Message,
  PlainValue,
  ToolCall,
} from '@threadplane/core';
import type { FunctionTool } from '@threadplane/core/tools';
import type { FixtureTools } from './scenarios';

/* BINDING_IMPORT */
/* TEXT_TRANSCRIPT_TYPES */
/* TOOL_OBSERVATION_TYPES */

export function assertSnapshot(snapshot: AgentSnapshot<FixtureTools>) {
  const reasoning: Message['reasoning'] = snapshot.messages[0]?.reasoning;
  // @ts-expect-error Reasoning remains readonly through native snapshots.
  snapshot.messages[0].reasoning = 'changed';
  // @ts-expect-error Reasoning is display text, not an SDK object.
  const invalidReasoning: Message['reasoning'] = { text: 'reasoning' };
  void [reasoning, invalidReasoning];
  /* BACKEND_VALUES */
  const citations: readonly Citation[] | undefined =
    snapshot.messages[0]?.citations;
  if (citations) {
    const citation: Citation = citations[0];
    const publishedAt: string | number | undefined = citation.publishedAt;
    const extra: Readonly<Record<string, PlainValue>> | undefined =
      citation.extra;
    // @ts-expect-error Citation collections remain readonly through the native binding.
    citations.push(citation);
    // @ts-expect-error Citation fields remain readonly.
    citation.title = 'changed';
    if (extra) {
      // @ts-expect-error Provider records remain deeply readonly plain data.
      extra['changed'] = true;
      const nested = extra['nested'];
      if (nested && typeof nested === 'object') {
        // @ts-expect-error Nested provider records remain readonly.
        nested['value'] = true;
      }
    }
    void publishedAt;
  }
  const badTimestamp: Citation = {
    id: 'c',
    index: 1,
    // @ts-expect-error Date timestamps are not in the neutral contract.
    publishedAt: new Date(),
  };
  const badExtra: Citation = {
    id: 'c',
    index: 1,
    // @ts-expect-error SDK instances and callbacks cannot enter plain extras.
    extra: { date: new Date(), callback: () => true },
  };
  void [badTimestamp, badExtra];
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
