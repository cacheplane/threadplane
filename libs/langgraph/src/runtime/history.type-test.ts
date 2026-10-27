import type { AgentSession, ToolContract } from '@threadplane/core';
import { createSession, type LangGraphSession } from './create-session';

const session = createSession({
  assistantId: 'a',
  threadId: 't',
  tools: {
    work: {
      description: 'Work',
      handler: (args: { amount: number }) => ({ doubled: args.amount * 2 }),
    },
  },
});
const observer: AgentSession = session;
const adapter: LangGraphSession = session;
const broad: AgentSession<Record<string, ToolContract>> = adapter;
const loaded: Promise<void> | undefined = session.load?.({
  signal: new AbortController().signal,
});
session.load?.();
// @ts-expect-error load accepts only a standard abort signal
session.load?.({ signal: 'not a signal' });
// @ts-expect-error load does not introduce submit input
session.load?.('message');
// @ts-expect-error core observer does not gain adapter-specific load
observer.load?.();
for (const call of session.getSnapshot().toolCalls) {
  if (call.status === 'complete') {
    const result: number = call.result.doubled;
    const input: number = call.args.amount;
    // @ts-expect-error authored result inference survives adapter extension
    const incorrect: string = call.result.doubled;
    void [result, input, incorrect];
  }
}
void [observer, adapter, broad, loaded];
