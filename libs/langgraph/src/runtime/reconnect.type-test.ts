import type { AgentSession, CompleteOutcome } from '@threadplane/core';
import { createSession } from './create-session';

const session = createSession({
  assistantId: 'a',
  threadId: 't',
  tools: {
    count: {
      description: 'Count',
      handler: (args: { amount: number }) => ({ total: args.amount }),
    },
    label: {
      description: 'Label',
      handler: (args: { name: string }) => ({ label: args.name }),
    },
  },
});
const result: Promise<CompleteOutcome> = session.reconnect({
  signal: new AbortController().signal,
});
session.reconnect();
// @ts-expect-error No arbitrary run IDs or caller-selected cursor.
session.reconnect({ runId: 'other', lastEventId: 'cursor' });
// @ts-expect-error Reconnect accepts only an AbortSignal.
session.reconnect({ signal: 'wrong' });
const snapshot = session.getSnapshot();
if (snapshot.reconnect) {
  const runId: string = snapshot.reconnect.runId;
  // @ts-expect-error The descriptor is owned and readonly.
  snapshot.reconnect.runId = 'wrong';
  void runId;
}
// @ts-expect-error Backend snapshot properties are readonly.
snapshot.reconnect = undefined;
for (const call of snapshot.toolCalls) {
  if (call.name === 'count' && call.status === 'complete') {
    const total: number = call.result.total;
    // @ts-expect-error Heterogeneous authored results remain inferred.
    const label: string = call.result.label;
    void [total, label];
  }
}
const borrowed: AgentSession = session;
// @ts-expect-error Reconnect is absent from the core observer contract.
borrowed.reconnect();
// @ts-expect-error Backend reconnect state is absent from the core snapshot.
void borrowed.getSnapshot().reconnect;
void result;
