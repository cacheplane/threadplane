import type { AgentSession } from '@threadplane/core';
import { createSession, type SessionOptions } from './create-session';

const lazy = createSession({
  assistantId: 'a',
  onThreadId: (threadId: string) => void threadId,
});
const fixed = createSession({ assistantId: 'a', threadId: 't' });
const cleared = createSession({ assistantId: 'a', threadId: null });
const current: string | undefined = lazy.threadId;
// @ts-expect-error The thread does not exist before the first submit.
const known: string = lazy.threadId;
// @ts-expect-error The created id is read, never assigned.
fixed.threadId = 'other';
// @ts-expect-error onThreadId receives the created thread id.
createSession({ assistantId: 'a', onThreadId: (threadId: number) => threadId });
// @ts-expect-error A thread id is text.
createSession({ assistantId: 'a', threadId: 1 });
const createThread: NonNullable<SessionOptions['transport']>['createThread'] =
  async (signal: AbortSignal) => (signal.aborted ? 'aborted' : 'created');
const observer: AgentSession = lazy;
// @ts-expect-error The core observer has no LangGraph thread.
void observer.threadId;
void [cleared, current, known, createThread];
