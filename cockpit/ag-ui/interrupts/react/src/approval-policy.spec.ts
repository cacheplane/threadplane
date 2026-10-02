import { EventType as E } from '@ag-ui/client';
import { expect, it } from 'vitest';
import type { Session } from '@threadplane/ag-ui';
import { captureTurn, captureApproval, confirmResume } from './approval-policy';

type Snapshot = ReturnType<Session['getSnapshot']>;
const human = { id: 'human', role: 'user' as const, content: '  Refund $25  ' };
const draft = {
  id: 'draft',
  role: 'assistant' as const,
  content: 'Draft ready.',
};
const answer = {
  id: 'answer',
  role: 'assistant' as const,
  content: 'Refund issued.',
};
const raw = () => ({
  kind: 'refund_approval',
  amount: 25,
  customer_id: 'cus_demo',
  reason: 'Fictional damaged item',
});
const interrupt = () => ({
  id: 'interrupt-A',
  reason: 'approval',
  metadata: { langgraph: { raw: raw() } },
});
const admitted = (): Snapshot => ({
  status: 'running',
  state: {},
  transcript: [human],
  subagents: [],
  run: { id: 'draft-run' },
});
const turn = () => ({
  threadId: 'thread',
  runId: 'draft-run',
  human,
  prefix: [],
});
const paused = (): Snapshot => ({
  ...admitted(),
  status: 'idle',
  transcript: [human, draft],
  decision: {
    kind: 'native',
    id: 'opaque-pause' as Parameters<Session['resume']>[0],
    sourceRunId: 'draft-run',
    interrupts: [interrupt()],
  },
  run: {
    id: 'draft-run',
    outcome: 'paused',
    terminal: {
      type: E.RUN_FINISHED,
      threadId: 'thread',
      runId: 'draft-run',
      outcome: { type: 'interrupt', interrupts: [interrupt()] },
    },
  },
});
const completed = (): Snapshot => ({
  ...paused(),
  decision: undefined,
  transcript: [human, draft, answer],
  run: {
    id: 'resume-run',
    outcome: 'success',
    terminal: { type: E.RUN_FINISHED, threadId: 'thread', runId: 'resume-run' },
  },
});

it('captures the native admitted human and accepts exactly the settled current refund pause', () => {
  expect(captureTurn(admitted(), 'thread', undefined, [])).toEqual(turn());
  const approval = captureApproval(paused(), turn());
  expect(approval).toMatchObject({
    pause: 'opaque-pause',
    interruptId: 'interrupt-A',
    sourceRunId: 'draft-run',
    amount: 25,
    customerId: 'cus_demo',
    reason: 'Fictional damaged item',
    rows: [human, draft],
  });
});
it('owns selected scalars without freezing or retaining the producer graph', () => {
  const snapshot = paused();
  const approval = captureApproval(snapshot, turn())!;
  const decision = snapshot.decision;
  if (decision?.kind !== 'native') throw new Error('Expected native fixture');
  const metadata = decision.interrupts[0].metadata as {
    langgraph: { raw: ReturnType<typeof raw> };
  };
  const payload = metadata.langgraph.raw;
  payload.amount = 70;
  expect(approval.amount).toBe(25);
  expect(Object.isFrozen(payload)).toBe(false);
});
it.each([
  { status: 'running' },
  { status: 'error' },
  { decision: undefined },
  { decision: { kind: 'unsupported', sourceRunId: 'draft-run' } },
  { run: { ...paused().run!, id: 'old' } },
  { run: { ...paused().run!, outcome: 'success' } },
  { transcript: [human] },
  { transcript: [human, { ...draft, id: human.id }] },
  { transcript: [human, { ...draft, subagentRunId: 'child' }] },
  {
    transcript: [
      human,
      {
        ...draft,
        toolCalls: [
          {
            id: 'call',
            type: 'function',
            function: { name: 'private', arguments: '{}' },
          },
        ],
      },
    ],
  },
  { transcript: [human, { ...draft, content: '' }] },
  {
    subagents: [
      {
        started: {
          type: E.SUBAGENT_STARTED,
          subagentRunId: 'child',
          name: 'worker',
        },
      },
    ],
  },
])('rejects unsupported, incomplete or unowned pauses: %j', (change) => {
  expect(
    captureApproval({ ...paused(), ...change } as Snapshot, turn())
  ).toBeUndefined();
});
it.each([
  { sourceRunId: 'old' },
  { id: '' },
  { attempt: { runId: 'resume', responses: [] } },
  { interrupts: [] },
  { interrupts: [interrupt(), { ...interrupt(), id: 'second' }] },
  { interrupts: [{ ...interrupt(), expiresAt: '2020-01-01T00:00:00Z' }] },
  { interrupts: [{ ...interrupt(), expiresAt: 'invalid' }] },
  { interrupts: [{ ...interrupt(), subagentRunId: 'child' }] },
  {
    interrupts: [
      {
        ...interrupt(),
        metadata: { langgraph: { raw: { ...raw(), amount: -1 } } },
      },
    ],
  },
  {
    interrupts: [
      {
        ...interrupt(),
        metadata: { langgraph: { raw: { ...raw(), amount: Infinity } } },
      },
    ],
  },
  {
    interrupts: [
      {
        ...interrupt(),
        metadata: { langgraph: { raw: { ...raw(), amount: '25' } } },
      },
    ],
  },
  {
    interrupts: [
      {
        ...interrupt(),
        metadata: { langgraph: { raw: { ...raw(), kind: 'other' } } },
      },
    ],
  },
  {
    interrupts: [
      {
        ...interrupt(),
        metadata: { langgraph: { raw: { ...raw(), customer_id: '' } } },
      },
    ],
  },
  { interrupts: [{ id: 'interrupt-A', payload: raw() }] },
])('rejects invalid native decision evidence: %j', (change) => {
  const snapshot = paused();
  expect(
    captureApproval(
      {
        ...snapshot,
        decision: { ...snapshot.decision!, ...change },
      } as Snapshot,
      turn()
    )
  ).toBeUndefined();
});
it.each(['other-thread', 'other-run', 'wrong-interrupt', 'different-payload'])(
  'requires the terminal to agree with the native decision: %s',
  (mismatch) => {
    const snapshot = paused();
    const terminal = snapshot.run!.terminal!;
    if (terminal.type !== E.RUN_FINISHED) throw new Error('Fixture');
    const changed = {
      ...terminal,
      ...(mismatch === 'other-thread' ? { threadId: 'other' } : {}),
      ...(mismatch === 'other-run' ? { runId: 'other' } : {}),
      ...(mismatch === 'wrong-interrupt'
        ? {
            outcome: {
              type: 'interrupt' as const,
              interrupts: [{ ...interrupt(), id: 'other' }],
            },
          }
        : {}),
      ...(mismatch === 'different-payload'
        ? {
            outcome: {
              type: 'interrupt' as const,
              interrupts: [
                {
                  ...interrupt(),
                  metadata: { langgraph: { raw: { ...raw(), amount: 99 } } },
                },
              ],
            },
          }
        : {}),
    };
    expect(
      captureApproval(
        { ...snapshot, run: { ...snapshot.run!, terminal: changed } },
        turn()
      )
    ).toBeUndefined();
  }
);
it('confirms only a new admitted resume run and its exact paused prefix plus final assistant', () => {
  const approval = captureApproval(paused(), turn())!;
  expect(confirmResume(completed(), approval, 'resume-run')).toEqual([
    human,
    draft,
    answer,
  ]);
  expect(
    confirmResume(
      { ...completed(), state: { refund_id: 'old', decision_approved: true } },
      approval,
      'resume-run'
    )
  ).toEqual([human, draft, answer]);
});
it.each([
  { run: { ...completed().run!, id: 'draft-run' } },
  { transcript: [human, answer] },
  { transcript: [human, { ...draft, content: 'Changed' }, answer] },
  { transcript: [human, draft, { ...answer, id: draft.id }] },
  { transcript: [human, draft, answer, { ...answer, id: 'extra' }] },
  { decision: paused().decision },
  { status: 'running' },
  { run: { ...completed().run!, outcome: 'error' } },
  { run: { id: 'resume-run', outcome: 'success' } },
])('rejects uncertain or stale resume completion: %j', (change) => {
  const approval = captureApproval(paused(), turn())!;
  expect(
    confirmResume(
      { ...completed(), ...change } as Snapshot,
      approval,
      'resume-run'
    )
  ).toBeUndefined();
});
it('revokes authority even when borrowed property access reenters the owner', () => {
  let active = true;
  const snapshot = {
    ...paused(),
    get transcript() {
      active = false;
      return paused().transcript;
    },
  };
  expect(captureApproval(snapshot, turn(), () => active)).toBeUndefined();
  expect(
    captureTurn(admitted(), 'thread', undefined, [], () => false)
  ).toBeUndefined();
  expect(
    confirmResume(
      completed(),
      captureApproval(paused(), turn())!,
      'resume-run',
      () => false
    )
  ).toBeUndefined();
});
