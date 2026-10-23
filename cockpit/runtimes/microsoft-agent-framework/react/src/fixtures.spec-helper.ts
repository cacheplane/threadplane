import type { Session } from '@threadplane/ag-ui';
import { EventType as E } from '@ag-ui/client';
export type Snapshot = ReturnType<Session['getSnapshot']>;
export const expense = {
  vendor: 'Blue Finch Bistro',
  category: 'meals',
  amount_usd: 220,
  memo: 'Team dinner for 4 attendees; receipt attached.',
};
export const human = {
  id: 'human',
  role: 'user' as const,
  content: 'File this expense.',
};
export const interrupt = () => {
  const request = {
    type: 'function_approval_request',
    function_call: {
      call_id: 'call',
      name: 'submit_expense',
      arguments: { expense: { ...expense } },
    },
  };
  return {
    id: 'call',
    reason: 'tool_call',
    toolCallId: 'call',
    metadata: {
      agent_framework: { ...request, value: structuredClone(request) },
    },
  };
};
export const running = (): Snapshot => ({
  status: 'running',
  state: {},
  transcript: [human],
  subagents: [],
  run: { id: 'source' },
});
export const paused = (): Snapshot => ({
  ...running(),
  status: 'idle',
  state: { expense },
  decision: {
    kind: 'native',
    id: 'opaque-pause' as Parameters<Session['resume']>[0],
    sourceRunId: 'source',
    interrupts: [interrupt()],
  },
  run: {
    id: 'source',
    outcome: 'paused',
    terminal: {
      type: E.RUN_FINISHED,
      threadId: 'thread',
      runId: 'source',
      outcome: { type: 'interrupt', interrupts: [interrupt()] },
    },
  },
});
export const literal = (approved: boolean) =>
  approved
    ? 'Expense recorded: $220.00 to Blue Finch Bistro (meals) — queued for reimbursement.'
    : 'Error: Tool call invocation was rejected by user.';
export const completed = (approved = true): Snapshot => ({
  ...running(),
  status: 'idle',
  transcript: [
    human,
    {
      id: 'submit',
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'call',
          type: 'function',
          function: {
            name: 'submit_expense',
            arguments: JSON.stringify({ expense }),
          },
        },
      ],
    },
    {
      id: 'authoritative-result',
      role: 'tool',
      toolCallId: 'call',
      content: literal(approved),
    },
  ],
  run: {
    id: 'resume',
    outcome: 'success',
    terminal: { type: E.RUN_FINISHED, threadId: 'thread', runId: 'resume' },
  },
});
