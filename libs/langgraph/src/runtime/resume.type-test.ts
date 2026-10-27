import type {
  AgentSession,
  CompleteOutcome,
  PlainValue,
} from '@threadplane/core';
import { createSession } from './create-session';

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
const response: Readonly<Record<string, PlainValue>> = {
  first: { approved: false },
  second: [0, null],
};
const result: Promise<CompleteOutcome> = session.resume(response, {
  signal: new AbortController().signal,
});
session.resume();
session.resume(undefined);
session.resume(null);
session.resume(false);
// @ts-expect-error Functions are not plain response values.
session.resume(() => true);
// @ts-expect-error SDK classes are not plain response values.
session.resume(new Date());
// @ts-expect-error Resume options require AbortSignal.
session.resume(true, { signal: 'wrong' });
// @ts-expect-error Resume does not add arbitrary command options.
session.resume(true, { command: { goto: 'other' } });
const observer: AgentSession = session;
// @ts-expect-error Backend resume is absent from the borrowed core contract.
observer.resume(true);
const values: Readonly<Record<string, PlainValue>> | undefined =
  session.getSnapshot().values;
for (const call of session.getSnapshot().toolCalls) {
  if (call.status === 'complete') {
    const doubled: number = call.result.doubled;
    // @ts-expect-error Authored result inference survives resume extension.
    const wrong: string = call.result.doubled;
    void [doubled, wrong];
  }
}
void [result, values];
