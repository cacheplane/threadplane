import {
  createSession,
  projectTextTranscript,
  type Session,
  type SessionOptions,
  type TextTranscriptRow,
  type ClientToolSession,
  type ClientToolSessionSnapshot,
  type ClientToolCall,
  type ClientToolBlocker,
} from '@threadplane/ag-ui';
import type { CheckedTools, ToolContracts } from '@threadplane/core/tools';
import type { CompleteOutcome } from '@threadplane/core';
export type NativeResponse = Parameters<Session['resume']>[1][number];
export function checkCandidate(signal: AbortSignal) {
  const options: SessionOptions = {
    threadId: 'candidate',
    url: 'http://127.0.0.1:1',
    interruptMode: 'native',
  };
  const session = createSession(options);
  void session.submit('Hello', { signal });
  void session.submit(
    { message: 'Hello', state: { model: 'small', nested: [null, true] } },
    { signal }
  );
  const snapshot = session.getSnapshot();
  const rows: readonly TextTranscriptRow[] = projectTextTranscript(
    snapshot.transcript
  );
  const stable = projectTextTranscript(snapshot.transcript, rows);
  const resolved: NativeResponse = {
    interruptId: 'backend-id',
    status: 'resolved',
    payload: null,
    metadata: { reviewed: true },
  };
  const cancelled: NativeResponse = {
    interruptId: 'backend-id',
    status: 'cancelled',
  };
  if (snapshot.decision?.kind === 'native') {
    void session.resume(snapshot.decision.id, [resolved], { signal });
    void session.resume(snapshot.decision.id, [cancelled]);
    // @ts-expect-error Pause generations are branded, not arbitrary strings.
    void session.resume('backend-id', [resolved]);
    void session.resume(snapshot.decision.id, [
      // @ts-expect-error Cancelled native responses cannot carry a payload.
      { interruptId: 'backend-id', status: 'cancelled', payload: null },
    ]);
    // @ts-expect-error Decision evidence is readonly.
    snapshot.decision.interrupts.push({ id: 'changed' });
  }
  // @ts-expect-error Native transcript remains readonly.
  snapshot.transcript.push({ id: 'x', role: 'user', content: 'changed' });
  // @ts-expect-error State is an observed readonly field.
  snapshot.state = {};
  // @ts-expect-error Child observations remain readonly.
  snapshot.subagents.push({});
  // @ts-expect-error Display rows remain readonly.
  rows[0].content = 'changed';
  // @ts-expect-error Native input requires text.
  void session.submit({ message: 1 });
  // @ts-expect-error Application state is a plain record.
  void session.submit({ message: '', state: { date: new Date() } });
  // @ts-expect-error Submission cannot override transport routing.
  void session.submit('', { threadId: 'other' });
  // @ts-expect-error No history loading capability is invented.
  void session.load();
  // @ts-expect-error No reconnect capability is invented.
  void session.reconnect();
  // @ts-expect-error No client tool execution command is invented.
  void session.addToolResult('id', 'result');
  return { session, snapshot, rows, stable };
}
export function checkClientTools(options: SessionOptions) {
  const catalog = {
    get_weather: {
      description: 'Weather',
      handler: (args: { location: string; nested: { values: number[] } }) => ({
        temperatures: [args.location.length],
      }),
    },
    book: {
      description: 'Book',
      handler: async (args: { seats: number }) => ({
        confirmation: String(args.seats),
      }),
    },
  };
  const checked = catalog satisfies CheckedTools<typeof catalog>;
  const owner: ClientToolSession<ToolContracts<typeof catalog>> = createSession(
    options,
    checked
  );
  const snapshot: ClientToolSessionSnapshot<ToolContracts<typeof catalog>> =
    owner.getSnapshot();
  const calls: readonly ClientToolCall<ToolContracts<typeof catalog>>[] =
    snapshot.clientTools.calls;
  const outcome: CompleteOutcome | undefined =
    snapshot.clientTools.commandOutcome;
  const blocker: ClientToolBlocker | undefined = snapshot.clientTools.blocker;
  void outcome;
  void blocker;
  for (const call of calls) {
    const name: 'get_weather' | 'book' = call.name;
    void name;
    if (call.name === 'get_weather') {
      const location: string | undefined = call.args?.location;
      const temperatures: readonly number[] | undefined =
        call.result?.temperatures;
      void location;
      void temperatures;
      // @ts-expect-error Heterogeneous results stay narrowed.
      call.result?.confirmation;
      // @ts-expect-error Nested arguments are deeply readonly.
      call.args?.nested.values.push(1);
      // @ts-expect-error Nested results are deeply readonly.
      call.result?.temperatures.push(1);
    } else {
      const seats: number | undefined = call.args?.seats;
      const confirmation: string | undefined = call.result?.confirmation;
      void seats;
      void confirmation;
      // @ts-expect-error Names determine authored argument contracts.
      call.args?.location;
    }
    // @ts-expect-error Local evidence is readonly.
    call.delivery = 'observed';
  }
  const empty = createSession(options, {});
  const impossible: readonly never[] = empty.getSnapshot().clientTools.calls;
  void impossible;
  void empty.getSnapshot().clientTools.blocker;
  // @ts-expect-error No catalog keeps the original exact snapshot.
  createSession(options).getSnapshot().clientTools;
  // @ts-expect-error Native snapshots do not manufacture core aggregates.
  snapshot.messages;
  return owner;
}
