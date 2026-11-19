import type { AgentSession } from '@threadplane/core';
import {
  captureResponses,
  type Decision,
  type InterruptResponse,
  type NativeResponse,
  type PauseId,
} from './decision';
import type { Session } from './create-session';

const resolved: InterruptResponse = {
  interruptId: 'i',
  status: 'resolved',
  value: null,
  metadata: { nested: [1, undefined] },
};
const cancelled: InterruptResponse = { interruptId: 'i', status: 'cancelled' };
// A caller answers with `value`; the captured response carries `payload`.
const captured: readonly NativeResponse[] = captureResponses([
  resolved,
  cancelled,
] as const);
void captured;
const wire: NativeResponse = {
  interruptId: 'i',
  status: 'resolved',
  payload: { approved: true },
};
void wire;
// @ts-expect-error status is mandatory
captureResponses([{ interruptId: 'i' }]);
// @ts-expect-error no aliases for backend interrupt IDs
captureResponses([{ id: 'i', status: 'resolved' }]);
// @ts-expect-error cancelled responses cannot have a value
captureResponses([{ interruptId: 'i', status: 'cancelled', value: null }]);
// @ts-expect-error the wire name is not a response field
captureResponses([{ interruptId: 'i', status: 'resolved', payload: true }]);
// @ts-expect-error functions are not portable values
captureResponses([{ interruptId: 'i', status: 'resolved', value: () => 1 }]);
captureResponses([
  // @ts-expect-error Date is not a portable value
  { interruptId: 'i', status: 'resolved', value: new Date() },
]);
// @ts-expect-error metadata must be a plain record
captureResponses([{ interruptId: 'i', status: 'resolved', metadata: [] }]);
// @ts-expect-error state patches are not resume fields
captureResponses([{ interruptId: 'i', status: 'resolved', state: {} }]);
// @ts-expect-error an arbitrary backend ID is not a generation token
const plain: PauseId = 'interrupt-id';
declare const decision: Decision;
if (decision.kind === 'native') {
  const token: PauseId = decision.id;
  // @ts-expect-error snapshots own readonly batches
  decision.interrupts.push({ id: 'i', reason: 'Approve' });
  // @ts-expect-error captured attempt responses are readonly
  decision.attempt?.responses.push(wire);
  void token;
}
void plain;
declare const session: Session;
declare const pause: PauseId;
session.resume([resolved, cancelled] as const, {
  signal: new AbortController().signal,
});
void session.resume([
  {
    interruptId: 'i',
    status: 'resolved',
    value: { approved: true, notes: ['ok'] },
    metadata: { origin: 'review' },
  },
]);
void session.resume([
  // @ts-expect-error an answer is carried as `value`, not the wire `payload`
  { interruptId: 'i', status: 'resolved', payload: { approved: true } },
]);
// @ts-expect-error there is no pause token: the pending decision is answered
session.resume(pause, [resolved]);
// @ts-expect-error a backend ID cannot stand in for the responses
session.resume('backend-id', [resolved]);
// @ts-expect-error native resume never accepts a new user message
session.resume([resolved], { message: 'new intent' });
// @ts-expect-error native resume never accepts a state patch
session.resume([resolved], { state: {} });
// @ts-expect-error transport fields cannot override a correlated native resume
session.resume([resolved], { runId: 'guessed' });
// @ts-expect-error an explicit response batch is required
session.resume();

// The session is a core session, and a core observer answers through it.
const observer: AgentSession = session;
void observer.resume?.([
  { interruptId: 'i', status: 'resolved', value: { approved: true } },
  { interruptId: 'j', status: 'cancelled' },
]);
void observer.resume?.([
  // @ts-expect-error the core response has no wire `payload` either
  { interruptId: 'i', status: 'resolved', payload: true },
]);
// @ts-expect-error the core contract has no pause token
void observer.resume?.(pause, [resolved]);

// Child agents of earlier root runs are marked, so a view can tell them apart.
const earlierChild: true | undefined =
  session.getSnapshot().subagents[0]?.earlier;
// @ts-expect-error The mark is derived, not assigned.
session.getSnapshot().subagents[0].earlier = true;
void earlierChild;
