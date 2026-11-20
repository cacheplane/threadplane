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
  const checkpoint = { thread_id: 't', checkpoint_ns: '', checkpoint_id: 'c' };
  // @ts-expect-error A fork always carries a message.
  await session.fork(checkpoint, null);
}

export async function assertJoinStream() {
  const session = createSession({ assistantId: 'agent', threadId: 'thread' });
  const outcome: 'success' | 'error' | 'interrupted' | 'aborted' | 'paused' =
    await session.joinStream('run', 'event', {
      signal: new AbortController().signal,
    });
  void outcome;
  // @ts-expect-error A run id is required.
  await session.joinStream();
  // @ts-expect-error Joining creates no run, so it takes no run settings.
  await session.joinStream('run', undefined, { run: {} });
}

export function assertHostOptions() {
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    initialValues: { topic: 'draft' },
    toMessage: (message) => message,
    throttle: 16,
    a2uiClientCapabilities: { supportedCatalogIds: ['standard'] },
    telemetry: (payload) => void payload.properties.requestType,
    onOperationFailure: (code) => void (code === 'unauthorized'),
    developmentRuntime: {
      touch() {
        /* host */
      },
      milestone(kind) {
        void (kind === 'transport.connected');
      },
      dispose() {
        /* host */
      },
    },
    devtools: {
      begin: (type) => void type,
      end: () => undefined,
      wrote: (name) => void (name === 'messages'),
      outside: (_label, run) => run(),
    },
    scriptedRuns: { take: () => ({ frames: [{ event: 'values', data: {} }] }) },
  });
  createSession({
    assistantId: 'agent',
    threadId: 'thread',
    telemetry: false,
    throttle: false,
  });
  createSession({
    assistantId: 'agent',
    threadId: 'thread',
    // @ts-expect-error Initial values are plain data.
    initialValues: { when: new Date() },
  });
  createSession({
    assistantId: 'agent',
    threadId: 'thread',
    // @ts-expect-error Capabilities name the supported catalogs.
    a2uiClientCapabilities: {},
  });
  createSession({
    assistantId: 'agent',
    threadId: 'thread',
    // @ts-expect-error Telemetry is a function or false.
    telemetry: true,
  });
  return session;
}

export function assertAutoLoad() {
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    autoLoad: true,
  });
  const loading: true | undefined = session.getSnapshot().loading;
  void loading;
  // @ts-expect-error Loading is published, not set.
  session.getSnapshot().loading = true;
}

export function assertRawData() {
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    rawMessages: true,
  });
  const snapshot = session.getSnapshot();
  const wire = snapshot.langGraphMessages?.[0];
  const node = snapshot.messageMetadata?.['a'].streamMetadata['langgraph_node'];
  const state: 'starting' | 'running' | 'completed' | 'error' | undefined =
    snapshot.toolProgress?.[0].state;
  const tokens: number | undefined = snapshot.usage?.entries[0].inputTokens;
  const created: number | null =
    session.lifecycle.getSnapshot().threadCreatedAt;
  void [wire, node, state, tokens, created];
  // @ts-expect-error Raw messages are read-only.
  if (wire) wire['content'] = 'changed';
}
