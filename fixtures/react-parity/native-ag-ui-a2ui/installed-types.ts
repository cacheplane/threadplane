import { createSession, type Session } from '@threadplane/ag-ui';
import type { CompleteOutcome } from '@threadplane/core';

/** Compile only: actual installed public declarations, no execution. */
export function checkInstalledA2ui(signal: AbortSignal) {
  const owner: Session = createSession({
    threadId: 'types-only',
    url: 'http://127.0.0.1:1/agent',
  });
  const unsubscribe: () => void = owner.subscribe(() => {
    const snapshot: ReturnType<Session['getSnapshot']> = owner.getSnapshot();
    const transcript: typeof snapshot.transcript = snapshot.transcript;
    for (const row of transcript) {
      const id: string = row.id;
      if (row.role === 'assistant') {
        const calls = row.toolCalls;
        const content = row.content;
        void [id, calls, content];
      }
    }
    const run = snapshot.run;
    if (run) {
      const id: string = run.id;
      const outcome: CompleteOutcome | undefined = run.outcome;
      if (run.terminal?.type === 'RUN_FINISHED') {
        const thread: string = run.terminal.threadId;
        const runId: string = run.terminal.runId;
        void [thread, runId, run.terminal.outcome];
      }
      void [id, outcome, run.legacyInterrupt];
    }
    if (snapshot.decision?.kind === 'native')
      void owner.resume(
        snapshot.decision.id,
        [{ interruptId: 'i', status: 'resolved', payload: null }],
        { signal }
      );
    void [snapshot.status, snapshot.state, snapshot.subagents];
  });
  const completion: Promise<CompleteOutcome> = owner.submit(
    { message: 'types-only', state: { selected: ['SFO'] } },
    { signal }
  );
  const stopped: Promise<void> = owner.stop();
  const disposed: Promise<void> = owner.dispose();
  unsubscribe();
  return { owner, completion, stopped, disposed };
}
