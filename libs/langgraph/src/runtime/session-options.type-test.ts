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

export async function assertHistoryState() {
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    historyState: true,
  });
  const snapshot = session.getSnapshot();
  const id: string | undefined = snapshot.checkpoints?.[0].id;
  const parent: string | null | undefined =
    snapshot.checkpoints?.[0].saved.parent_checkpoint?.checkpoint_id;
  const checkpoint: string | undefined = snapshot.messageCheckpoints?.['a'];
  const branch: string | undefined = snapshot.branch;
  const item = snapshot.branchTree?.items[0];
  if (item?.type === 'node') void item.value.values;
  if (item?.type === 'fork') void item.items[0].items;
  await session.setBranch('a>b');
  // @ts-expect-error A branch is a string.
  await session.setBranch(1);
  // @ts-expect-error Checkpoints are read-only.
  snapshot.checkpoints?.push(snapshot.checkpoints[0]);
  void [id, parent, checkpoint, branch];
}

export async function assertRunSettings() {
  const session = createSession({ assistantId: 'agent', threadId: 'thread' });
  await session.submit('Go', {
    run: {
      command: { update: { topic: 'x' }, goto: 'agent' },
      checkpointId: 'c1',
      multitaskStrategy: 'enqueue',
      interruptBefore: ['review'],
      interruptAfter: '*',
      streamMode: ['debug'],
      streamSubgraphs: true,
      durability: 'sync',
      onDisconnect: 'cancel',
      webhook: 'https://example.test',
      afterSeconds: 1,
      ifNotExists: 'create',
      feedbackKeys: ['quality'],
      onRunCreated: (run) => void run.run_id,
    },
  });
  await session.submit(null);
  await session.submit(undefined, { run: { command: { goto: 'agent' } } });
  await session.resume([{ interruptId: 'i', status: 'resolved', value: 1 }], {
    run: { command: { update: { approved: true } } },
  });
  const cancelled: boolean = await session.cancelQueued('run');
  await session.clearQueue();
  const message: string | undefined = session.getSnapshot().queue?.[0].message;
  void [cancelled, message];
  // @ts-expect-error The session supplies the answer to a pause.
  await session.submit('Go', { run: { command: { resume: true } } });
  // @ts-expect-error Settings are stated under run, never at the root.
  await session.submit('Go', { multitaskStrategy: 'enqueue' });
  // @ts-expect-error An unknown strategy is rejected.
  await session.submit('Go', { run: { multitaskStrategy: 'later' } });
  // @ts-expect-error A fork always carries a message.
  await session.fork({ thread_id: 't', checkpoint_ns: '', checkpoint_id: 'c' }, null);
}
