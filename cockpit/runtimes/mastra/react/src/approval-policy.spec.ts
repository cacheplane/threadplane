import { EventType as E } from '@ag-ui/client';
import { expect, it } from 'vitest';
import type { Session } from '@threadplane/ag-ui';
import {
  captureTurn,
  captureApproval,
  confirmResume,
  ownSnapshot,
} from './approval-policy';
type Snapshot = ReturnType<Session['getSnapshot']>;
export const human = {
  id: 'human',
  role: 'user' as const,
  content: 'Reserve North Pines for 2 nights.',
};
export const notice = () => ({
  type: 'mastra_suspend',
  toolName: 'reserve_campsite',
  runId: 'source',
  toolCallId: 'call',
  suspendPayload: { site: 'North Pines', nights: 2, total_usd: 90 },
  args: { site: 'North Pines', nights: 2 },
});
export const interrupt = () => ({
  id: 'opaque-interrupt',
  reason: 'mastra:tool_suspend',
  toolCallId: 'call',
  metadata: { mastra: notice() },
});
export const running = (): Snapshot => ({
  status: 'running',
  state: {},
  transcript: [human],
  subagents: [],
  run: { id: 'source' },
});
export const turn = () => ({
  threadId: 'thread',
  runId: 'source',
  human,
  prefix: [],
});
export const paused = (): Snapshot => ({
  ...running(),
  status: 'idle',
  decision: {
    kind: 'native',
    id: 'opaque-pause' as Parameters<Session['resume']>[0],
    sourceRunId: 'source',
    interrupts: [interrupt()],
  },
  run: {
    id: 'source',
    outcome: 'paused',
    legacyInterrupt: {
      type: E.CUSTOM,
      name: 'on_interrupt',
      value: JSON.stringify(notice()),
    },
    terminal: {
      type: E.RUN_FINISHED,
      threadId: 'thread',
      runId: 'source',
      outcome: { type: 'interrupt', interrupts: [interrupt()] },
    },
  },
});
export const expected = (approved: boolean) =>
  JSON.stringify(
    approved
      ? 'Reserved North Pines for 2 night(s) — total $90. Confirmation TP-0288.'
      : 'Reservation for North Pines was declined by the user. Nothing was booked.'
  );
export const completed = (approved = true): Snapshot => ({
  ...running(),
  status: 'idle',
  transcript: [
    human,
    {
      id: 'result',
      role: 'tool',
      toolCallId: 'call',
      content: expected(approved),
    },
    {
      id: 'answer',
      role: 'assistant',
      content: approved ? 'Booked.' : 'Declined.',
    },
  ],
  run: {
    id: 'resume',
    outcome: 'success',
    terminal: { type: E.RUN_FINISHED, threadId: 'thread', runId: 'resume' },
  },
});
it('owns the source turn and correlates the informational notice with the settled native pause', () => {
  expect(captureTurn(running(), 'thread', undefined, [])).toEqual(turn());
  expect(captureApproval(paused(), turn())).toMatchObject({
    threadId: 'thread',
    sourceRunId: 'source',
    toolCallId: 'call',
    pause: 'opaque-pause',
    interruptId: 'opaque-interrupt',
    site: 'North Pines',
    nights: 2,
    total: 90,
  });
});
it('requires settled native evidence; notice alone never grants authority', () => {
  const s = paused();
  expect(captureApproval({ ...s, status: 'running' }, turn())).toBeUndefined();
  expect(
    captureApproval(
      {
        ...s,
        decision: { kind: 'unsupported', sourceRunId: 'source' },
        run: { ...s.run!, terminal: undefined },
      },
      turn()
    )
  ).toBeUndefined();
});
it.each([
  'missing',
  'invalid-json',
  'oversized',
  'unknown-type',
  'wrong-tool',
  'wrong-run',
  'wrong-call',
  'wrong-total',
  'fractional-nights',
  'blank-site',
  'args-mismatch',
  'metadata-mismatch',
  'duplicate',
  'expired',
  'child',
  'terminal-thread',
  'terminal-call',
])('rejects %s evidence', (kind) => {
  const s = paused();
  const n = notice();
  if (kind === 'unknown-type') n.type = 'other';
  if (kind === 'wrong-tool') n.toolName = 'other';
  if (kind === 'wrong-run') n.runId = 'old';
  if (kind === 'wrong-call') n.toolCallId = 'old';
  if (kind === 'wrong-total') n.suspendPayload.total_usd = 91;
  if (kind === 'fractional-nights') n.suspendPayload.nights = 1.5;
  if (kind === 'blank-site') n.suspendPayload.site = '  ';
  if (kind === 'args-mismatch') n.args.nights = 3;
  const i = interrupt();
  if (kind === 'metadata-mismatch')
    i.metadata.mastra.suspendPayload.total_usd = 91;
  const decision = {
    ...s.decision!,
    interrupts:
      kind === 'duplicate'
        ? [i, i]
        : [
            {
              ...i,
              ...(kind === 'expired' ? { expiresAt: '2020-01-01' } : {}),
              ...(kind === 'child' ? { subagentRunId: 'child' } : {}),
            },
          ],
  };
  const terminal = {
    type: E.RUN_FINISHED,
    threadId: kind === 'terminal-thread' ? 'old' : 'thread',
    runId: 'source',
    outcome: {
      type: 'interrupt',
      interrupts: [
        {
          ...interrupt(),
          toolCallId: kind === 'terminal-call' ? 'other' : 'call',
        },
      ],
    },
  };
  const legacyInterrupt =
    kind === 'missing'
      ? undefined
      : {
          type: E.CUSTOM,
          name: 'on_interrupt',
          value:
            kind === 'invalid-json'
              ? '{'
              : kind === 'oversized'
              ? 'x'.repeat(17000)
              : JSON.stringify(n),
        };
  expect(
    captureApproval(
      {
        ...s,
        decision,
        run: { ...s.run!, terminal, legacyInterrupt },
      } as Snapshot,
      turn()
    )
  ).toBeUndefined();
});
it('copies only owned data and rejects accessors, cycles, and revoked proxy observations', () => {
  const s = paused();
  const a = captureApproval(s, turn())!;
  expect(Object.isFrozen(s.transcript)).toBe(false);
  expect(Object.isFrozen(a.transcript)).toBe(true);
  let active = true;
  const proxy = new Proxy(s, {
    ownKeys(target) {
      active = false;
      return Reflect.ownKeys(target);
    },
  });
  expect(captureApproval(proxy, turn(), () => active)).toBeUndefined();
  expect(
    ownSnapshot({
      ...s,
      get transcript(): Snapshot['transcript'] {
        throw new Error('must not invoke');
      },
    })
  ).toBeUndefined();
  const cycle: Record<string, unknown> = {};
  cycle['self'] = cycle;
  expect(ownSnapshot({ ...s, state: cycle } as Snapshot)).toBeUndefined();
});
it.each([true, false])(
  'confirms only the exact serialized backend result for approved=%s',
  (approved) => {
    const a = captureApproval(paused(), turn())!;
    expect(
      confirmResume(completed(approved), a, 'resume', approved)?.result
    ).toBe(expected(approved));
    expect(
      confirmResume(completed(!approved), a, 'resume', approved)
    ).toBeUndefined();
  }
);
it.each([
  'missing-terminal',
  'missing-result',
  'substring',
  'duplicate-result',
  'child-result',
  'changed-prefix',
  'old-run',
  'pending-tools',
])('cannot confirm %s', (kind) => {
  let s = completed();
  if (kind === 'missing-terminal')
    s = { ...s, run: { ...s.run!, terminal: undefined } };
  if (kind === 'missing-result')
    s = { ...s, transcript: [human, s.transcript[2]] };
  if (kind === 'substring')
    s = {
      ...s,
      transcript: [
        human,
        { ...s.transcript[1], content: expected(true) + ' extra' },
        s.transcript[2],
      ],
    } as Snapshot;
  if (kind === 'duplicate-result')
    s = {
      ...s,
      transcript: [...s.transcript, { ...s.transcript[1], id: 'result2' }],
    };
  if (kind === 'child-result')
    s = {
      ...s,
      transcript: [
        human,
        { ...s.transcript[1], subagentRunId: 'child' },
        s.transcript[2],
      ],
    };
  if (kind === 'changed-prefix')
    s = {
      ...s,
      transcript: [{ ...human, content: 'changed' }, ...s.transcript.slice(1)],
    };
  if (kind === 'old-run') s = { ...s, run: { ...s.run!, id: 'source' } };
  if (kind === 'pending-tools')
    s = {
      ...s,
      run: {
        ...s.run!,
        terminal: {
          type: E.RUN_FINISHED,
          threadId: 'thread',
          runId: 'resume',
          outcome: { type: 'success', pendingToolCallIds: ['another'] },
        },
      },
    };
  expect(
    confirmResume(s, captureApproval(paused(), turn())!, 'resume', true)
  ).toBeUndefined();
});
it.each([
  { transcript: [null] },
  {
    transcript: [
      human,
      { id: 'bad', role: 'assistant', toolCalls: 'not-array' },
    ],
  },
  { transcript: [human, { id: 'bad', role: 'assistant', toolCalls: [null] }] },
  {
    decision: {
      kind: 'native',
      id: 'pause',
      sourceRunId: 'source',
      interrupts: null,
    },
  },
  {
    decision: {
      kind: 'native',
      id: 42,
      sourceRunId: 'source',
      interrupts: [interrupt()],
    },
  },
  {
    run: {
      ...paused().run!,
      terminal: {
        type: E.RUN_FINISHED,
        threadId: 'thread',
        runId: 'source',
        outcome: { type: 'interrupt', interrupts: null },
      },
    },
  },
])('malformed plain candidates revoke without throwing: %j', (change) => {
  expect(() =>
    captureApproval({ ...paused(), ...change } as unknown as Snapshot, turn())
  ).not.toThrow();
  expect(
    captureApproval({ ...paused(), ...change } as unknown as Snapshot, turn())
  ).toBeUndefined();
});
it.each([
  'terminal-child',
  'notice-child',
  'invalid-expiry',
  'multi-notice',
  'missing-payload',
  'zero-nights',
  'too-many-nights',
  'long-site',
  'schema-mismatch',
] as const)('rejects unsupported or malformed %s policy', (kind) => {
  const s = paused(),
    n = notice(),
    i = interrupt();
  if (kind === 'zero-nights') n.suspendPayload.nights = 0;
  if (kind === 'too-many-nights') {
    n.suspendPayload.nights = 366;
    n.suspendPayload.total_usd = 366 * 45;
  }
  if (kind === 'long-site') n.suspendPayload.site = 'x'.repeat(501);
  const changed = {
    ...s,
    decision: {
      ...s.decision!,
      interrupts: [
        {
          ...i,
          ...(kind === 'invalid-expiry' ? { expiresAt: 'invalid' } : {}),
          ...(kind === 'schema-mismatch'
            ? {
                metadata: {
                  mastra: { ...notice(), resumeSchema: { different: true } },
                },
              }
            : {}),
        },
      ],
    },
    run: {
      ...s.run!,
      terminal: {
        ...s.run!.terminal!,
        ...(kind === 'terminal-child' ? { subagentRunId: 'child' } : {}),
      },
      legacyInterrupt: {
        ...s.run!.legacyInterrupt!,
        ...(kind === 'notice-child' ? { subagentRunId: 'child' } : {}),
        value: JSON.stringify(
          kind === 'multi-notice'
            ? [n]
            : kind === 'missing-payload'
            ? { ...n, suspendPayload: undefined }
            : n
        ),
      },
    },
  } as Snapshot;
  expect(captureApproval(changed, turn())).toBeUndefined();
});
