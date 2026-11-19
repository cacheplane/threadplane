import type {
  AgentInterruptResponse,
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
const interruptId = session.getSnapshot().interrupts[0].id;
const responses: readonly AgentInterruptResponse[] = [
  { interruptId, status: 'resolved', value: response },
];
const result: Promise<CompleteOutcome> = session.resume(responses, {
  signal: new AbortController().signal,
});
session.resume([{ interruptId, status: 'resolved' }]);
session.resume([{ interruptId, status: 'resolved', value: null }]);
session.resume([{ interruptId, status: 'resolved', value: false }]);
// @ts-expect-error Resume takes responses, not a bare value.
session.resume(false);
// @ts-expect-error Resume needs its responses.
session.resume();
// @ts-expect-error A response names its interrupt.
session.resume([{ status: 'resolved', value: true }]);
// @ts-expect-error Functions are not plain response values.
session.resume([{ interruptId, status: 'resolved', value: () => true }]);
// @ts-expect-error SDK classes are not plain response values.
session.resume([{ interruptId, status: 'resolved', value: new Date() }]);
// @ts-expect-error Resume options require AbortSignal.
session.resume(responses, { signal: 'wrong' });
// @ts-expect-error Resume does not add arbitrary command options.
session.resume(responses, { command: { goto: 'other' } });
// The session's resume is the core contract's command, always present here.
const observer: AgentSession = session;
const viaCore: Promise<CompleteOutcome> | undefined =
  observer.resume?.(responses);
// @ts-expect-error The core contract makes resume optional.
observer.resume(responses);
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
void [result, values, viaCore];
