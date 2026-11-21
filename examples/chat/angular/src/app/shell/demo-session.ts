import type { AgentSessionContext } from '@threadplane/angular';
import { type } from '@threadplane/core';
import {
  createSession,
  type LangGraphClientOptions,
  type SessionOptions,
} from '@threadplane/langgraph';
import { environment } from '../../environments/environment';
import type { DemoSession, DemoState } from './agent-ref';

/**
 * The canonical graph has side-effect LLM nodes such as generate_title; only
 * the generate node's token stream belongs in the chat transcript. Without the
 * filter the title's tokens land on the just-completed answer. A replayed
 * recording needs it too: it carries the same events the live run did.
 */
export const TRANSCRIPT_NODE_NAMES = ['generate'] as const;

/** The graph's `research` tool starts a child agent; relate the two. */
export const SUBAGENT_TOOL_NAMES = ['research'] as const;

/** What every demo session reads from the graph, live or replayed. */
type DemoSessionOptions = Omit<SessionOptions, 'assistantId' | 'threadId' | 'onThreadId' | 'stateType'> & {
  readonly assistantId?: string;
};

/**
 * Creates one session of the canonical demo graph for the thread the agent is
 * on. `provideAgent` calls this again for every thread switch.
 *
 * The options the chat surface depends on are stated here because a session
 * turns each of them on only when asked:
 * - `rawMessages`: the wire fields (`tool_calls`, content blocks) the chat
 *   reads to tell a generative-UI turn from prose.
 * - `historyState`: checkpoints with their state, for the devtools timeline
 *   and for a run started from a checkpoint.
 * - `restoreSubagents`: the research child comes back with a reloaded thread.
 */
export function createDemoSession(
  context: AgentSessionContext,
  options: DemoSessionOptions = {},
): DemoSession {
  return createSession({
    ...(options.transport ? {} : { apiUrl: environment.langGraphApiUrl }),
    assistantId: environment.assistantId,
    clientOptions: context.clientOptions as LangGraphClientOptions | undefined,
    transcriptNodeNames: TRANSCRIPT_NODE_NAMES,
    rawMessages: true,
    historyState: true,
    restoreSubagents: true,
    ...options,
    threadId: context.threadId,
    onThreadId: context.onThreadId,
    reportOperationFailure: context.reportOperationFailure,
    // The relay to the development-install collector: a factory that picks
    // fields from the context reports nothing unless it passes this on.
    developmentRuntime: context.developmentRuntime,
    stateType: type<DemoState>(),
  });
}
