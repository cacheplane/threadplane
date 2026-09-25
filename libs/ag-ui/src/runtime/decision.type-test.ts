import {
  captureResponses,
  type Decision,
  type NativeResponse,
  type PauseId,
} from './decision';
import type { Session } from './create-session';

const resolved: NativeResponse = {
  interruptId: 'i',
  status: 'resolved',
  payload: null,
  metadata: { nested: [1, undefined] },
};
const cancelled: NativeResponse = { interruptId: 'i', status: 'cancelled' };
captureResponses([resolved, cancelled] as const);
// @ts-expect-error status is mandatory
captureResponses([{ interruptId: 'i' }]);
// @ts-expect-error no aliases for backend interrupt IDs
captureResponses([{ id: 'i', status: 'resolved' }]);
// @ts-expect-error cancelled responses cannot have a defined payload
captureResponses([{ interruptId: 'i', status: 'cancelled', payload: null }]);
// @ts-expect-error functions are not portable payloads
captureResponses([{ interruptId: 'i', status: 'resolved', payload: () => 1 }]);
captureResponses([
  // @ts-expect-error Date is not a portable value
  { interruptId: 'i', status: 'resolved', payload: new Date() },
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
  decision.attempt?.responses.push(resolved);
  void token;
}
void plain;
declare const session: Session;
declare const pause: PauseId;
session.resume(pause, [resolved, cancelled] as const, {
  signal: new AbortController().signal,
});
// @ts-expect-error a backend ID cannot stand in for a native pause generation
session.resume('backend-id', [resolved]);
// @ts-expect-error native resume never accepts a new user message
session.resume(pause, [resolved], { message: 'new intent' });
// @ts-expect-error native resume never accepts a state patch
session.resume(pause, [resolved], { state: {} });
// @ts-expect-error transport fields cannot override a correlated native resume
session.resume(pause, [resolved], { runId: 'guessed' });
// @ts-expect-error an explicit response batch is required
session.resume(pause);
