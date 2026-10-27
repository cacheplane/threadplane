import {
  createSession,
  type LangGraphInputState,
  type LangGraphRunOptions,
  type SessionOptions,
} from '@threadplane/langgraph';
import type {
  AgentSession,
  CompleteOutcome,
  PlainValue,
} from '@threadplane/core';

export type ExistingOptionalTransportQueue = NonNullable<
  SessionOptions['transport']
>['createQueuedRun'];

export function checkCandidate(signal: AbortSignal) {
  const session = createSession({
    assistantId: 'fixture',
    threadId: 'fixed',
    apiUrl: 'http://127.0.0.1:1',
    tools: {
      weather: {
        description: 'Weather',
        handler: ({ city }: { city: string }) => ({ city, temperature: 20 }),
      },
      count: {
        description: 'Count',
        handler: ({ values }: { values: readonly string[] }) => values.length,
      },
    },
  });
  const borrowed: AgentSession = session;
  const state: LangGraphInputState = {
    model: 'candidate',
    itinerary: [{ day: 1 }],
    empty: null,
  };
  const options: LangGraphRunOptions = {
    signal,
    config: {
      tags: ['candidate'],
      configurable: { user_id: 'reviewer' },
      recursion_limit: 50,
    },
    context: { locale: 'en' },
    metadata: { source: 'candidate' },
  };
  const outcome: Promise<CompleteOutcome> = session.submit(
    { message: 'Hello', state },
    options
  );
  void session.submit('Hello', { signal });
  void session.load?.({ signal });
  void session.resume({ approval: true }, options);
  void session.resume(null);
  void session.reconnect({ signal });
  const snapshot = session.getSnapshot();
  const values: Readonly<Record<string, PlainValue>> | undefined =
    snapshot.values;
  for (const tool of snapshot.toolCalls) {
    if (tool.name === 'weather') {
      const city: string = tool.args.city;
      // @ts-expect-error Heterogeneous arguments are not widened to another tool.
      const count: number = tool.args.values;
      if (tool.status === 'complete') {
        const temperature: number = tool.result.temperature;
        // @ts-expect-error Result remains the authored weather record.
        const number: number = tool.result;
        void [temperature, number];
      }
      void [city, count];
    } else if (tool.status === 'complete') {
      const count: number = tool.result;
      // @ts-expect-error Count result is not a weather record.
      const temperature: number = tool.result.temperature;
      void [count, temperature];
    }
  }
  const checkpoint = snapshot.history?.[0].checkpoint;
  if (checkpoint) {
    void session.fork(checkpoint, { message: 'Branch', state }, options);
    // @ts-expect-error Checkpoints are owned readonly observations.
    checkpoint.checkpoint_id = 'changed';
  }
  // @ts-expect-error No invented session queue capability.
  void session.queue;
  // @ts-expect-error No public command for joining arbitrary external runs.
  void session.joinStream('other-run');
  // @ts-expect-error Reconnect accepts only its observed owned run.
  void session.reconnect({ runId: 'other-run' });
  // @ts-expect-error A message is required for application input.
  void session.submit({ state });
  // @ts-expect-error Input message remains text.
  void session.submit({ message: 1 });
  // @ts-expect-error Runtime-owned messages cannot be application state.
  void session.submit({ message: '', state: { messages: [] } });
  // @ts-expect-error Tool catalog is runtime-owned.
  void session.submit({ message: '', state: { client_tools: [] } });
  // @ts-expect-error Plain data excludes Date instances.
  void session.submit({ message: '', state: { date: new Date() } });
  // @ts-expect-error Run options cannot route another thread.
  void session.submit('', { config: { configurable: { thread_id: 'other' } } });
  // @ts-expect-error Resume cannot override transport commands.
  void session.resume(true, { command: { goto: 'other' } });
  // @ts-expect-error Fork requires the actual checkpoint shape.
  void session.fork('checkpoint', 'Branch');
  // @ts-expect-error Observed state cannot be replaced by a consumer.
  snapshot.values = {};
  // @ts-expect-error Schema-free values do not infer an application model.
  const count: number = values?.['count'];
  return { session, borrowed, outcome, values, count };
}
