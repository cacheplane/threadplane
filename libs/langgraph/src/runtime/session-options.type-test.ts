import { createSession } from './create-session';

export function assertSessionOptions() {
  createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transcriptNodeNames: ['agent'] as const,
  });
  createSession({
    assistantId: 'agent',
    threadId: 'thread',
    // @ts-expect-error Node names are strings.
    transcriptNodeNames: [1],
  });
}

export function assertDelegation() {
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    subagentToolNames: ['task', 'delegate'],
  });
  const [subgraph] = session.getSnapshot().subgraphs;
  const toolCallId: string | undefined = subgraph.delegation?.toolCallId;
  const status: 'running' | 'complete' | 'error' | undefined =
    subgraph.delegation?.status;
  const related: string | undefined =
    session.getSnapshot().subagents[0].toolCallId;
  void [toolCallId, status, related];
  // @ts-expect-error A relation is read-only.
  if (subgraph.delegation) subgraph.delegation.toolCallId = 'other';
}
