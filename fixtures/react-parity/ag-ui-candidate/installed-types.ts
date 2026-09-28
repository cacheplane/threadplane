import {
  createSession,
  projectTextTranscript,
  type Session,
  type SessionOptions,
  type TextTranscriptRow,
} from '@threadplane/ag-ui';
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
