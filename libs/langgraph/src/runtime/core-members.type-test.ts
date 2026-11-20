import {
  type,
  type AgentCheckpoint,
  type AgentClientTools,
  type AgentErrorDiagnostic,
  type AgentInputBlock,
  type AgentSession,
  type AgentSnapshot,
  type AgentSubagent,
  type CompleteOutcome,
  type ContentBlock,
  type PlainValue,
  type StreamingToolCall,
  type ToolCall,
} from '@threadplane/core';
import { createSession } from './create-session';

/** Every optional core member the session produces is the core type itself. */
export async function assertCoreMembers() {
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    historyState: true,
    stateType: type<{ draft?: string; count: number }>(),
  });
  const snapshot = session.getSnapshot();

  const blocks: readonly ContentBlock[] | undefined =
    snapshot.messages[0].blocks;
  const extra: Readonly<Record<string, PlainValue>> | undefined =
    snapshot.messages[0].extra;
  const streaming: readonly StreamingToolCall[] | undefined =
    snapshot.streamingToolCalls;
  const diagnostic: AgentErrorDiagnostic | undefined = snapshot.errorDiagnostic;
  const blocked: AgentInputBlock | undefined = snapshot.inputBlocked;
  const checkpoints: readonly AgentCheckpoint[] | undefined =
    snapshot.checkpoints;
  const messageCheckpoints: Readonly<Record<string, string>> | undefined =
    snapshot.messageCheckpoints;
  const pending: readonly ToolCall[] | undefined = snapshot.pendingClientTools;
  const children: readonly AgentSubagent[] = snapshot.subagents;
  const childState: Readonly<Record<string, PlainValue>> | undefined =
    snapshot.subagents[0].state;
  const childStreaming: readonly StreamingToolCall[] | undefined =
    snapshot.subagents[0].streamingToolCalls;
  const status: 'pending' | 'running' | 'complete' | 'error' | 'unknown' =
    snapshot.subagents[0].status;
  for (const call of snapshot.toolCalls) {
    if (call.status === 'complete' || call.status === 'error') {
      const parts: readonly PlainValue[] | undefined = call.parts;
      void parts;
    }
    // @ts-expect-error A call that has not settled has no result parts.
    if (call.status === 'pending') void call.parts;
  }
  // @ts-expect-error The retained run was renamed; `reconnect` is the command.
  void snapshot.reconnect;
  // @ts-expect-error Published blocks are read-only.
  snapshot.messages[0].blocks?.push({ type: 'text', text: 'x' });
  // @ts-expect-error The block is the session's to publish.
  snapshot.inputBlocked = { reason: 'mine' };

  // The whole snapshot and session are still the core contract's.
  const core: AgentSnapshot = snapshot;
  const borrowed: AgentSession = session;

  const tools: AgentClientTools | undefined = session.clientTools;
  tools?.setCatalog([{ name: 'ask', description: 'Ask', parameters: {} }]);
  tools?.resolve('call', { ok: true, value: { answer: 1 } });
  tools?.settle?.('call', { ok: false, error: 'Declined' });
  const flushed: void | Promise<void> = tools?.flush?.();
  // @ts-expect-error A result is a value or an error text.
  tools?.resolve('call', { value: 1 });
  // @ts-expect-error A spec needs its schema.
  tools?.setCatalog([{ name: 'ask', description: 'Ask' }]);

  const ran: Promise<CompleteOutcome> = session.runWithoutMessage();
  await session.runWithoutMessage({ state: { draft: 'Notes' } });
  await session.runWithoutMessage(
    { state: { count: 2 } },
    { run: { command: { goto: 'review' } } }
  );
  // @ts-expect-error The state is part of the declared state.
  await session.runWithoutMessage({ state: { draft: 1 } });
  // @ts-expect-error A run without a message takes no message.
  await session.runWithoutMessage({ message: 'Hello' });
  // @ts-expect-error The session assembles its own messages.
  await session.runWithoutMessage({ state: { messages: [] } });

  await session.submit({
    message: 'Look',
    blocks: [
      { type: 'text', text: 'Look' },
      { type: 'image', url: 'https://example.test/a.png', alt: 'A' },
    ],
    state: { count: 1 },
  });
  // @ts-expect-error A block is one of the core block shapes.
  await session.submit({ message: 'x', blocks: [{ type: 'video', url: '' }] });

  const answers = [
    { interruptId: 'approve', status: 'resolved', value: true },
  ] as const;
  await session.resume(answers, {
    message: 'Go ahead',
    blocks: [{ type: 'text', text: 'Go ahead' }],
    state: { draft: 'Approved' },
    run: { command: { update: { priority: 'high' } } },
  });
  // @ts-expect-error A resume message is text.
  await session.resume(answers, { message: 1 });
  // @ts-expect-error The state is part of the declared state.
  await session.resume(answers, { state: { count: 'two' } });
  // The core resume options are accepted through the core contract too.
  await borrowed.resume?.(answers, {
    message: 'Go ahead',
    state: { anything: true },
  });

  void [
    blocks,
    extra,
    streaming,
    diagnostic,
    blocked,
    checkpoints,
    messageCheckpoints,
    pending,
    children,
    childState,
    childStreaming,
    status,
    core,
    flushed,
    ran,
  ];
}
