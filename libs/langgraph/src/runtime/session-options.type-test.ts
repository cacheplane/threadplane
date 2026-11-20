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
