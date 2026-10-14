import { expect, it } from 'vitest';
import {
  captureApproval,
  captureTurn,
  confirmResume,
  ownSnapshot,
  validAmount,
} from './approval-policy';
import { running, paused, completed, literal } from './fixtures.spec-helper';
const turn = () => captureTurn(running(), 'thread', undefined, [])!;
it('captures the native tool_call approval with complete expense and original opaque pause', () => {
  const p = paused(),
    a = captureApproval(p, turn())!;
  expect(a.expense.vendor).toBe('Blue Finch Bistro');
  expect(a.expense.amount_usd).toBe(220);
  expect(a.pause).toBe(
    p.decision?.kind === 'native' ? p.decision.id : undefined
  );
});
it.each([0, 1.1, 19.99, 220])('accepts exact cents %s', (amount) =>
  expect(validAmount(amount)).toBe(true)
);
it.each([-1, NaN, Infinity, 220.000000001, 0.001, 1e15])(
  'rejects invalid amount %s',
  (amount) => expect(validAmount(amount)).toBe(false)
);
it('accepts optional unrelated child observations but rejects duplicate tool call IDs', () => {
  const p = paused() as any;
  p.transcript.push({
    id: 'child',
    role: 'assistant',
    subagentRunId: 'child-run',
    toolCalls: [
      {
        id: 'call',
        type: 'function',
        function: { name: 'submit_expense', arguments: '{}' },
      },
    ],
  });
  // A child call sharing an approval ID cannot authenticate or shadow a root call.
  p.transcript.push(completed().transcript[1]);
  expect(captureApproval(p, turn())).toBeUndefined();
});
it('accepts a legitimate optional child activity without conferring root authority', () => {
  const child = {
    id: 'child-activity',
    role: 'activity',
    activityType: 'progress',
    content: { text: 'Child activity' },
    subagentRunId: 'child',
  } as const;
  const p = paused(),
    a = captureApproval({ ...p, transcript: [...p.transcript, child] }, turn());
  expect(a).toBeDefined();
  const done = completed();
  expect(
    confirmResume(
      { ...done, transcript: [...done.transcript, child] },
      a!,
      'resume',
      true
    )?.result
  ).toBe(literal(true));
});
it('checks proxy revocation after own-data traps', () => {
  let valid = true;
  const p = new Proxy(paused(), {
    ownKeys(target) {
      valid = false;
      return Reflect.ownKeys(target);
    },
  });
  expect(ownSnapshot(p, () => valid)).toBeUndefined();
});
it('rejects malformed numeric root run IDs', () => {
  expect(
    captureTurn(
      { ...running(), run: { id: 42 } } as never,
      'thread',
      undefined,
      []
    )
  ).toBeUndefined();
});
it('rejects a malformed interrupt terminal without throwing', () => {
  const p = paused() as any;
  delete p.run.terminal.outcome.interrupts;
  expect(captureApproval(p, turn())).toBeUndefined();
});
it('normalizes optional empty assistant content and authoritative ordering while preserving history', () => {
  const p = paused(),
    final = completed();
  const call = final.transcript[1];
  if (call.role !== 'assistant') throw Error('Assistant fixture required');
  const a = captureApproval(
    { ...p, transcript: [...p.transcript, { ...call, content: undefined }] },
    turn()
  )!;
  expect(
    confirmResume(
      {
        ...final,
        transcript: [final.transcript[0], final.transcript[2], call],
      },
      a,
      'resume',
      true
    )
  ).toBeDefined();
});
it('rejects an unrelated new root tool result alongside the expected result', () => {
  const done = completed(),
    a = captureApproval(paused(), turn())!;
  expect(
    confirmResume(
      {
        ...done,
        transcript: [
          ...done.transcript,
          {
            id: 'unrelated',
            role: 'tool',
            toolCallId: 'unknown',
            content: 'Spoof',
          },
        ],
      },
      a,
      'resume',
      true
    )
  ).toBeUndefined();
});
it.each([true, false])(
  'confirms literal raw authoritative result and normal terminal (%s)',
  (approved) => {
    const a = captureApproval(paused(), turn())!;
    expect(
      confirmResume(completed(approved), a, 'resume', approved)?.result
    ).toBe(literal(approved));
  }
);
it('rejects accessor, cycle and excessive observation data', () => {
  const p = paused();
  expect(
    ownSnapshot(
      Object.defineProperty({}, 'state', {
        get() {
          throw Error();
        },
      }) as typeof p
    )
  ).toBeUndefined();
  const cycle: Record<string, unknown> = {};
  cycle['self'] = cycle;
  expect(ownSnapshot({ ...p, state: cycle as never })).toBeUndefined();
  expect(ownSnapshot({ ...p, state: 'x'.repeat(1_100_000) })).toBeUndefined();
});
it('rejects a high-index sparse observation before enumerating array keys', () => {
  const sparse: unknown[] = [];
  sparse[1_000_000] = 'retained';
  let enumerations = 0;
  const guarded = new Proxy(sparse, {
    ownKeys(target) {
      enumerations++;
      return Reflect.ownKeys(target);
    },
  });
  const p = paused();
  const snapshot = {
    ...p,
    decision: { ...p.decision!, extra: guarded },
  } as unknown as ReturnType<typeof paused>;
  expect(ownSnapshot(snapshot)).toBeUndefined();
  expect(captureApproval(snapshot, turn())).toBeUndefined();
  expect(enumerations).toBe(0);
});
it('rejects nested sparse logical-size budget bypass even when each array is below the cap', () => {
  const nested = Array.from({ length: 20 }, () => {
    const sparse: unknown[] = [];
    sparse[10_000] = 'retained';
    return sparse;
  });
  expect(
    ownSnapshot({ ...paused(), state: { nested } as never })
  ).toBeUndefined();
});
it('rejects numeric indices beyond a proxy-reported array length', () => {
  const sparse: unknown[] = [];
  sparse[10_000] = 'retained';
  const disguised = new Proxy(sparse, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      return key === 'length' ? { ...descriptor!, value: 0 } : descriptor;
    },
  });
  expect(
    ownSnapshot({ ...paused(), state: { disguised } as never })
  ).toBeUndefined();
});
it('retains normal dense nested arrays as frozen owned observations', () => {
  const dense = Array.from({ length: 10 }, (_, index) => [
    index,
    'plain',
    { ok: true },
  ]);
  const owned = ownSnapshot({ ...paused(), state: { dense } });
  expect(owned?.state).toEqual({ dense });
  expect(
    Object.isFrozen((owned?.state as { dense: unknown[][] }).dense[0])
  ).toBe(true);
});
it('retains the shared node budget across dense arrays', () => {
  const dense = Array.from({ length: 20 }, () =>
    Array.from({ length: 6_000 }, () => 0)
  );
  expect(ownSnapshot({ ...paused(), state: { dense } })).toBeUndefined();
});
it('checks revocation immediately after the array length descriptor trap', () => {
  let valid = true,
    enumerations = 0;
  const array = new Proxy([1, 2], {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'length') valid = false;
      return Object.getOwnPropertyDescriptor(target, key);
    },
    ownKeys(target) {
      enumerations++;
      return Reflect.ownKeys(target);
    },
  });
  expect(
    ownSnapshot({ ...paused(), state: { array } }, () => valid)
  ).toBeUndefined();
  expect(enumerations).toBe(0);
});
it.each([
  'tool',
  'name',
  'call',
  'run',
  'thread',
  'missing',
  'conflict',
  'multiple',
  'attempt',
  'expired',
  'partial',
  'amount',
  'history',
  'duplicate',
  'child',
])('rejects %s approval corruption', (kind) => {
  const p = structuredClone(paused()) as any;
  const i = p.decision.interrupts[0],
    f = i.metadata.agent_framework.function_call;
  if (kind === 'tool') i.reason = 'other';
  if (kind === 'name') f.name = 'other';
  if (kind === 'call') f.call_id = 'other';
  if (kind === 'run') p.decision.sourceRunId = 'other';
  if (kind === 'thread') p.run.terminal.threadId = 'other';
  if (kind === 'missing') delete i.metadata.agent_framework;
  if (kind === 'conflict')
    i.metadata.agent_framework.value.function_call.name = 'other';
  if (kind === 'multiple') p.decision.interrupts.push(structuredClone(i));
  if (kind === 'attempt')
    p.decision.attempt = { runId: 'resume', responses: [] };
  if (kind === 'expired') i.expiresAt = '2000-01-01T00:00:00Z';
  if (kind === 'partial') delete f.arguments.expense.memo;
  if (kind === 'amount') f.arguments.expense.amount_usd = 0.001;
  if (kind === 'history') p.transcript[0].content = 'Changed';
  if (kind === 'duplicate') p.transcript.push(p.transcript[0]);
  if (kind === 'child') i.subagentRunId = 'child';
  if (!['thread', 'multiple'].includes(kind))
    p.run.terminal.outcome.interrupts = structuredClone(p.decision.interrupts);
  expect(captureApproval(p, turn())).toBeUndefined();
});
it.each([
  'result',
  'json',
  'duplicate',
  'child',
  'tool',
  'args',
  'terminal',
  'error',
  'cancelled',
  'run',
  'thread',
  'history',
])('rejects %s completion corruption', (kind) => {
  const p = structuredClone(completed()) as any,
    a = captureApproval(paused(), turn())!;
  if (kind === 'result') p.transcript[2].content = 'Done';
  if (kind === 'json') p.transcript[2].content = JSON.stringify(literal(true));
  if (kind === 'duplicate')
    p.transcript.push({ ...p.transcript[2], id: 'second' });
  if (kind === 'child') p.transcript[2].subagentRunId = 'child';
  if (kind === 'tool') p.transcript[2].toolCallId = 'other';
  if (kind === 'args') p.transcript[1].toolCalls[0].function.arguments = '{}';
  if (kind === 'terminal') delete p.run.terminal;
  if (kind === 'error') p.run.terminal.type = 'RUN_ERROR';
  if (kind === 'cancelled') p.run.outcome = 'aborted';
  if (kind === 'run') p.run.terminal.runId = 'other';
  if (kind === 'thread') p.run.terminal.threadId = 'other';
  if (kind === 'history') p.transcript[0].content = 'Changed';
  expect(confirmResume(p, a, 'resume', true)).toBeUndefined();
});
