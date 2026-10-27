import type { Checkpoint, ThreadState } from '@langchain/langgraph-sdk';
import type { LangGraphSession } from './create-session';
import type { LangGraphHistoryEntry } from './langgraph-snapshot';

declare const session: LangGraphSession;
declare const checkpoint: Checkpoint;
declare const state: ThreadState;
declare const history: LangGraphHistoryEntry;

void session.fork(checkpoint, 'Fork');
void session.fork(state.checkpoint, {
  message: 'Fork',
  state: { locale: 'fr' },
});
void session.fork(history.checkpoint, 'Fork', {
  signal: new AbortController().signal,
});
// @ts-expect-error A complete reference is required; IDs are not aliases.
void session.fork('id', 'Fork');
// @ts-expect-error Null input historical replay is not the fork capability.
void session.fork(checkpoint, null);
