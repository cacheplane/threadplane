import type { BaseEvent } from '@ag-ui/client';
import type { AgentSession } from '@threadplane/core';
import { createSession } from './create-session';
import { interruptSession, type InterruptSession } from './decision';
import { httpReplay, type ReplaySource } from './replay';
import type {
  ReconcileAnswer,
  SessionPersistence,
  ThreadRecord,
} from './thread-store';

declare const store: SessionPersistence['store'];
const persistence: SessionPersistence = {
  namespace: 'app',
  store,
  reconcile: async (record: ThreadRecord): Promise<ReconcileAnswer> =>
    record.pause
      ? { status: 'completed', messages: record.messages, state: record.state }
      : { status: 'unknown' },
};
const replay: ReplaySource = httpReplay({ url: (id) => `/threads/${id}/events` });
const session = createSession({ threadId: 't', url: 'unused', persistence, replay });
// Still a core session: checkStatus is the core contract's own command.
const core: AgentSession = session;
void core.checkStatus?.();
const ready: Promise<void> | undefined = session.ready;
void ready;
const reconciled: Promise<void> | undefined = session.reconcileInterrupt?.();
void reconciled;
// A replay source may also return anything with an observable's subscribe.
const streamed: ReplaySource = () => ({
  subscribe: (observer) => {
    observer.next({ type: 'RUN_STARTED' } as BaseEvent);
    observer.complete();
    return { unsubscribe: () => undefined };
  },
});
createSession({ threadId: 't', url: 'unused', replay: streamed });
// @ts-expect-error a replay source returns events, not a thread record
createSession({ threadId: 't', url: 'unused', replay: async () => ({ messages: [] }) });
// @ts-expect-error persistence needs a namespace
createSession({ threadId: 't', url: 'unused', persistence: { store } });
const bad: ReconcileAnswer = {
  // @ts-expect-error an answer names one of the four statuses
  status: 'done',
  messages: [],
};
void bad;
// A saved record is plain readonly data.
declare const record: ThreadRecord;
// @ts-expect-error records are readonly
record.revision = 2;
const view: InterruptSession = interruptSession(session.getSnapshot());
const phase:
  | 'none'
  | 'collecting'
  | 'pending'
  | 'resuming'
  | 'acknowledged'
  | 'uncertain'
  | 'recovery-required'
  | 'unsupported' = view.phase;
void phase;
// @ts-expect-error claiming and sending are one phase here
const claimed: 'claimed' = view.phase;
void claimed;
