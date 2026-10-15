/* eslint-disable @typescript-eslint/no-explicit-any -- Negative tests deliberately corrupt native fixture shapes. */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- Canonical fixtures are asserted by the tests. */
import { expect, it } from 'vitest';
import {
  captureTurn,
  captureApproval,
  confirmResume,
  ownSnapshot,
  same,
} from './approval-policy';
import {
  paused,
  running,
  completed,
  meeting,
  literal,
  call,
} from './fixtures.spec-helper';
const turn = () => captureTurn(running(), 'thread', undefined, [])!;
for (const batch of [false, true])
  for (const approved of [false, true])
    it(`owns native ${
      batch ? 'batch' : 'sequential'
    } decision ${approved} and decodes exactly once`, () => {
      const p = paused(batch),
        a = captureApproval(p, turn())!;
      expect(a).toBeDefined();
      if (p.decision?.kind !== 'native') throw Error('Native fixture');
      expect(a.pause).toBe(p.decision.id);
      expect(a.meeting).toEqual(meeting);
      const final = completed(approved, batch),
        result = confirmResume(final, a, 'resume', approved);
      expect(result?.result).toBe(literal(approved));
      expect(result?.transcript.at(-2)?.content).toBe(
        JSON.stringify(literal(approved))
      );
    });
it.each([
  'missing-book',
  'resolved-book',
  'child-book',
  'extra-book',
  'unknown-call',
  'unknown-result',
  'duplicate-result',
  'lookup-error',
  'duplicate-id',
  'history',
  'extra-user',
  'wrong-meta',
  'extra-meta',
  'bad-args',
  'extra-args',
  'missing-terminal',
  'wrong-thread',
  'wrong-run',
  'child-terminal',
  'wrong-reason',
  'tool-call-id',
  'schema',
  'attempt',
  'expired',
  'multiple-interrupts',
  'missing-interrupts',
])('refuses %s pause authority', (kind) => {
  const p = structuredClone(paused()) as any,
    i = p.decision.interrupts[0];
  if (kind === 'missing-book') p.transcript.pop();
  if (kind === 'resolved-book')
    p.transcript.push({
      id: 'premature',
      role: 'tool',
      toolCallId: 'book-call',
      content: JSON.stringify(literal(true)),
    });
  if (kind === 'child-book') p.transcript.at(-1).subagentRunId = 'child';
  if (kind === 'extra-book')
    p.transcript.at(-1).toolCalls.push(call('book2', 'book_meeting', meeting));
  if (kind === 'unknown-call')
    p.transcript.at(-1).toolCalls.push(call('other', 'delete_meeting', {}));
  if (kind === 'unknown-result')
    p.transcript.push({
      id: 'alien',
      role: 'tool',
      toolCallId: 'unknown',
      content: 'done',
    });
  if (kind === 'lookup-error') p.transcript[2].error = true;
  if (kind === 'duplicate-result')
    p.transcript.push({ ...p.transcript[2], id: 'lookup2' });
  if (kind === 'duplicate-id') p.transcript.push(p.transcript[0]);
  if (kind === 'history') p.transcript[0].content = 'changed';
  if (kind === 'extra-user')
    p.transcript.push({
      id: 'another-human',
      role: 'user',
      content: 'approve',
    });
  if (kind === 'wrong-meta') i.metadata.reason.topic = 'Different';
  if (kind === 'extra-meta') i.metadata.reason.extra = 'extra';
  if (kind === 'bad-args')
    p.transcript.at(-1).toolCalls[0].function.arguments = JSON.stringify({
      ...meeting,
      topic: ' ',
    });
  if (kind === 'extra-args')
    p.transcript.at(-1).toolCalls[0].function.arguments = JSON.stringify({
      ...meeting,
      extra: true,
    });
  if (kind === 'missing-terminal') delete p.run.terminal;
  if (kind === 'wrong-thread') p.run.terminal.threadId = 'other';
  if (kind === 'wrong-run') p.decision.sourceRunId = 'other';
  if (kind === 'child-terminal') p.run.terminal.subagentRunId = 'child';
  if (kind === 'wrong-reason') i.reason = 'tool_call';
  if (kind === 'tool-call-id') i.toolCallId = 'book-call';
  if (kind === 'schema') i.responseSchema = {};
  if (kind === 'attempt')
    p.decision.attempt = { runId: 'resume', responses: [] };
  if (kind === 'expired') i.expiresAt = '2000-01-01T00:00:00Z';
  if (kind === 'multiple-interrupts')
    p.decision.interrupts.push(structuredClone(i));
  if (kind === 'missing-interrupts') delete p.run.terminal.outcome.interrupts;
  if (p.run.terminal && kind !== 'missing-interrupts')
    p.run.terminal.outcome.interrupts = structuredClone(p.decision.interrupts);
  expect(captureApproval(p, turn())).toBeUndefined();
});
it.each([
  'raw',
  'double',
  'object',
  'wrong',
  'duplicate',
  'unknown',
  'extra-call',
  'child-result',
  'missing-terminal',
  'wrong-terminal',
  'child-terminal',
  'aborted',
  'new-user',
  'changed-history',
  'changed-call',
  'changed-lookup',
  'decision',
  'pending',
])('refuses %s completion despite success prose/state', (kind) => {
  const a = captureApproval(paused(), turn())!,
    p = structuredClone(completed()) as any,
    result = p.transcript.find((m: any) => m.toolCallId === 'book-call');
  if (kind === 'raw') result.content = literal(true);
  if (kind === 'double')
    result.content = JSON.stringify(JSON.stringify(literal(true)));
  if (kind === 'object')
    result.content = JSON.stringify({ result: literal(true) });
  if (kind === 'wrong') result.content = JSON.stringify(literal(false));
  if (kind === 'duplicate') p.transcript.push({ ...result, id: 'second' });
  if (kind === 'unknown')
    p.transcript.push({
      id: 'alien',
      role: 'tool',
      toolCallId: 'unknown',
      content: 'x',
    });
  if (kind === 'extra-call')
    p.transcript.push({
      id: 'alien',
      role: 'assistant',
      toolCalls: [call('new-effect', 'book_meeting', meeting)],
    });
  if (kind === 'child-result') result.subagentRunId = 'child';
  if (kind === 'missing-terminal') delete p.run.terminal;
  if (kind === 'wrong-terminal') p.run.terminal.runId = 'other';
  if (kind === 'child-terminal') p.run.terminal.subagentRunId = 'child';
  if (kind === 'aborted') p.run.outcome = 'aborted';
  if (kind === 'new-user')
    p.transcript.push({ id: 'alien', role: 'user', content: 'ok' });
  if (kind === 'changed-history') p.transcript[0].content = 'other';
  if (kind === 'changed-call')
    p.transcript[3].toolCalls[0].function.arguments = '{}';
  if (kind === 'changed-lookup') p.transcript[2].content = 'different';
  if (kind === 'decision') p.decision = paused().decision;
  if (kind === 'pending')
    p.run.terminal.outcome = { type: 'success', pendingToolCallIds: ['other'] };
  p.state = { booking: { ...meeting, status: 'booked' } };
  expect(confirmResume(p, a, 'resume', true)).toBeUndefined();
});
it('allows exactly one owned pending read-only result and no new call authority', () => {
  const a = captureApproval(paused(true), turn())!;
  const p = structuredClone(completed(true, true)) as any;
  p.transcript.find((m: any) => m.toolCallId === 'lookup-call').error = true;
  expect(confirmResume(p, a, 'resume', true)).toBeUndefined();
  const bad = structuredClone(paused(true)) as any;
  bad.transcript[1].toolCalls[0].function.arguments = JSON.stringify({
    day: 'Tuesday',
    extra: 'x',
  });
  expect(captureApproval(bad, turn())).toBeUndefined();
});
it('does not use prose or booking snapshots as authority', () => {
  const p = paused(),
    a = captureApproval(p, turn())!;
  const done = completed();
  expect(
    captureApproval({ ...p, transcript: [p.transcript[0]] }, turn())
  ).toBeUndefined();
  expect(
    confirmResume(
      { ...done, transcript: done.transcript.filter((m) => m.role !== 'tool') },
      a,
      'resume',
      true
    )
  ).toBeUndefined();
});
it('compares semantic object keys, including arguments, without changing retained text', () => {
  expect(same({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  const p = paused(),
    a = captureApproval(p, turn())!;
  const done = structuredClone(completed()) as any;
  done.transcript[3].toolCalls[0].function.arguments = JSON.stringify({
    slot: meeting.slot,
    topic: meeting.topic,
  });
  expect(confirmResume(done, a, 'resume', true)).toBeDefined();
});
it('owns immutable plain bounded observations and rejects getters/cycles/sparse arrays', () => {
  const p = paused(),
    owned = ownSnapshot(p)!;
  expect(Object.isFrozen(owned.transcript)).toBe(true);
  expect(
    ownSnapshot(
      Object.defineProperty({}, 'state', {
        get() {
          throw Error('get');
        },
      }) as never
    )
  ).toBeUndefined();
  const cycle: any = {};
  cycle.self = cycle;
  expect(ownSnapshot({ ...p, state: cycle })).toBeUndefined();
  const sparse: any[] = [];
  sparse[1000000] = 'x';
  expect(ownSnapshot({ ...p, state: { sparse } })).toBeUndefined();
  expect(
    ownSnapshot({ ...p, state: { text: 'x'.repeat(1100000) } })
  ).toBeUndefined();
  let valid = true;
  const proxy = new Proxy(p, {
    ownKeys(target) {
      valid = false;
      return Reflect.ownKeys(target);
    },
  });
  expect(ownSnapshot(proxy, () => valid)).toBeUndefined();
});

it('rejects a reversed native pause transcript', () => {
  const p = structuredClone(paused()) as any;
  p.transcript.reverse();
  expect(captureApproval(p, turn())).toBeUndefined();
});
it('rejects a reversed completion transcript despite matching retained IDs', () => {
  const approval = captureApproval(paused(), turn())!;
  const done = structuredClone(completed()) as any;
  done.transcript.reverse();
  expect(confirmResume(done, approval, 'resume', true)).toBeUndefined();
});
it('preserves retained canonical order even when every result still follows its declaration', () => {
  const approval = captureApproval(paused(), turn())!;
  const done = completed();
  expect(
    confirmResume(
      {
        ...done,
        transcript: [
          done.transcript[0],
          done.transcript[1],
          done.transcript[3],
          done.transcript[2],
          ...done.transcript.slice(4),
        ],
      },
      approval,
      'resume',
      true
    )
  ).toBeUndefined();
});
it('rejects a newly observed batch lookup result preceding its original declaration', () => {
  const approval = captureApproval(paused(true), turn())!;
  const done = structuredClone(completed(true, true)) as any;
  const index = done.transcript.findIndex(
    (m: any) => m.toolCallId === 'lookup-call'
  );
  const [result] = done.transcript.splice(index, 1);
  done.transcript.splice(1, 0, result);
  expect(confirmResume(done, approval, 'resume', true)).toBeUndefined();
});
function separateBatchDeclarations() {
  const p = paused(true),
    row = p.transcript[1];
  if (row.role !== 'assistant' || !row.toolCalls)
    throw Error('Native batch fixture');
  const lookup = { ...row, toolCalls: [row.toolCalls[0]] };
  const book = {
    ...row,
    id: 'book-declaration',
    toolCalls: [row.toolCalls[1]],
  };
  return { ...p, transcript: [p.transcript[0], lookup, book] };
}
it.each(['book', 'lookup'] as const)(
  'rejects current %s declaration placed before the owned user',
  (name) => {
    const p = separateBatchDeclarations();
    const [human, lookup, book] = p.transcript;
    const transcript =
      name === 'book' ? [book, human, lookup] : [lookup, human, book];
    expect(captureApproval({ ...p, transcript }, turn())).toBeUndefined();
  }
);
it('preserves prior canonical order while capturing a later explicit submit run', () => {
  const prefix = completed().transcript;
  const reordered = [
    prefix[0],
    prefix[1],
    prefix[3],
    prefix[2],
    ...prefix.slice(4),
  ];
  expect(
    captureTurn(
      {
        ...running(),
        run: { id: 'next-submit' },
        transcript: [
          ...reordered,
          {
            id: 'next-user',
            role: 'user',
            content: 'Another fictional meeting',
          },
        ],
      },
      'thread',
      'resume',
      prefix
    )
  ).toBeUndefined();
});
it('allows an ordered lookup-result insertion after declaration and before a retained booking declaration', () => {
  const p = separateBatchDeclarations(),
    approval = captureApproval(p, turn())!;
  expect(approval).toBeDefined();
  const done = completed(true, true),
    result = done.transcript.find(
      (m) => m.role === 'tool' && m.toolCallId === 'lookup-call'
    )!;
  const transcript = [
    p.transcript[0],
    p.transcript[1],
    result,
    p.transcript[2],
    ...done.transcript.filter(
      (m) => m.id === 'authoritative-result' || m.id === 'prose'
    ),
  ];
  expect(
    confirmResume({ ...done, transcript }, approval, 'resume', true)?.result
  ).toBe(literal(true));
});
