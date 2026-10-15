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
function batch(approved = true) {
  const done = structuredClone(completed(approved)) as any;
  done.transcript[1].toolCalls.unshift({
    id: 'policy',
    type: 'function',
    function: {
      name: 'lookup_expense_policy',
      arguments: '{"category":"meals"}',
    },
  });
  const pause = {
    ...paused(),
    transcript: structuredClone(done.transcript.slice(0, 2)),
  } as any;
  done.transcript.push({
    id: 'policy-result',
    role: 'tool',
    toolCallId: 'policy',
    content: 'Policy supplied by the native backend.',
  });
  return { pause, done };
}
it.each([true, false])(
  'confirms both previously declared batch results (%s)',
  (approved) => {
    const { pause, done } = batch(approved);
    const a = captureApproval(pause, turn())!;
    expect(a).toBeDefined();
    expect(confirmResume(done, a, 'resume', approved)?.result).toBe(
      literal(approved)
    );
  }
);
it('requires every matching pending lookup ID to resolve exactly once', () => {
  const { pause, done } = batch();
  const another = structuredClone(pause.transcript[1].toolCalls[0]);
  another.id = 'policy-two';
  pause.transcript[1].toolCalls.push(another);
  done.transcript[1].toolCalls.push(structuredClone(another));
  const a = captureApproval(pause, turn())!;
  expect(confirmResume(done, a, 'resume', true)).toBeUndefined();
  done.transcript.push({
    id: 'policy-result-two',
    role: 'tool',
    toolCallId: 'policy-two',
    content: 'Another native policy result.',
  });
  expect(confirmResume(done, a, 'resume', true)?.result).toBe(literal(true));
});
it.each([
  'missing',
  'child',
  'duplicate',
  'error',
  'blank',
  'nonstring',
  'malformed',
  'null-args',
  'array-args',
  'missing-category',
  'nonstring-category',
  'category',
  'extra',
  'unknown-name',
  'new-call',
  'undeclared-result',
  'history',
  'submit-args',
  'submit-result',
  'run',
  'thread',
  'child-terminal',
])('rejects batch %s corruption', (kind) => {
  const { pause, done } = batch();
  const call = pause.transcript[1].toolCalls[0];
  if (kind === 'malformed') call.function.arguments = '{';
  if (kind === 'null-args') call.function.arguments = 'null';
  if (kind === 'array-args') call.function.arguments = '["meals"]';
  if (kind === 'missing-category') call.function.arguments = '{}';
  if (kind === 'nonstring-category') call.function.arguments = '{"category":1}';
  if (kind === 'category') call.function.arguments = '{"category":"travel"}';
  if (kind === 'extra')
    call.function.arguments = '{"category":"meals","extra":true}';
  if (kind === 'unknown-name') call.function.name = 'another_tool';
  done.transcript[1] = structuredClone(pause.transcript[1]);
  const a = captureApproval(pause, turn())!;
  if (kind === 'missing') done.transcript.pop();
  if (kind === 'child') done.transcript[3].subagentRunId = 'child';
  if (kind === 'duplicate')
    done.transcript.push({ ...done.transcript[3], id: 'duplicate-result' });
  if (kind === 'error') done.transcript[3].error = true;
  if (kind === 'blank') done.transcript[3].content = ' \n ';
  if (kind === 'nonstring') done.transcript[3].content = { text: 'policy' };
  if (kind === 'new-call')
    done.transcript[1].toolCalls.push({
      ...structuredClone(call),
      id: 'new-policy',
    });
  if (kind === 'undeclared-result')
    done.transcript.push({
      ...done.transcript[3],
      id: 'new-result',
      toolCallId: 'unknown',
    });
  if (kind === 'history') done.transcript[0].content = 'Edited';
  if (kind === 'submit-args')
    done.transcript[1].toolCalls[1].function.arguments = '{}';
  if (kind === 'submit-result')
    done.transcript[2].content = 'Policy says approved';
  if (kind === 'run') done.run.terminal.runId = 'other';
  if (kind === 'thread') done.run.terminal.threadId = 'other';
  if (kind === 'child-terminal') done.run.terminal.subagentRunId = 'child';
  expect(confirmResume(done, a, 'resume', true)).toBeUndefined();
});
it('rejects duplicate pending lookup call IDs at pause and completion', () => {
  const { pause, done } = batch();
  const a = captureApproval(pause, turn())!;
  done.transcript[1].toolCalls.push(
    structuredClone(done.transcript[1].toolCalls[0])
  );
  expect(confirmResume(done, a, 'resume', true)).toBeUndefined();
  pause.transcript[1].toolCalls.push(
    structuredClone(pause.transcript[1].toolCalls[0])
  );
  expect(captureApproval(pause, turn())).toBeUndefined();
});
it('cannot authorize a lookup declared only by a child assistant', () => {
  const { pause, done } = batch();
  const child = {
    id: 'child-policy',
    role: 'assistant',
    subagentRunId: 'child',
    toolCalls: [pause.transcript[1].toolCalls.shift()],
  };
  done.transcript[1].toolCalls.shift();
  pause.transcript.push(structuredClone(child));
  done.transcript.push(structuredClone(child));
  const a = captureApproval(pause, turn())!;
  expect(confirmResume(done, a, 'resume', true)).toBeUndefined();
});
it('preserves an already resolved historical lookup row exactly', () => {
  const { pause, done } = batch();
  pause.transcript.push(structuredClone(done.transcript[3]));
  const a = captureApproval(pause, turn())!;
  expect(confirmResume(done, a, 'resume', true)).toBeDefined();
  done.transcript[3].content = 'Edited policy';
  expect(confirmResume(done, a, 'resume', true)).toBeUndefined();
});
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
it('normalizes optional empty assistant content while preserving ordered history', () => {
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
        transcript: [final.transcript[0], call, final.transcript[2]],
      },
      a,
      'resume',
      true
    )
  ).toBeDefined();
});
it('rejects a result before its known declaration, including metadata-only pause authority', () => {
  const final = completed(),
    a = captureApproval(paused(), turn())!;
  expect(
    confirmResume(
      {
        ...final,
        transcript: [
          final.transcript[0],
          final.transcript[2],
          final.transcript[1],
        ],
      },
      a,
      'resume',
      true
    )
  ).toBeUndefined();
});
// Synthetic multi-turn snapshots: previous completed expenses must keep their
// order while a previously declared pending lookup may finish between owned rows.
function laterTurn() {
  const completedPrefix = JSON.parse(
    JSON.stringify(completed().transcript)
      .replaceAll('"call"', '"old-call"')
      .replaceAll('"human"', '"old-human"')
      .replaceAll('"submit"', '"old-submit"')
      .replaceAll('"authoritative-result"', '"old-result"')
  ) as ReturnType<typeof completed>['transcript'];
  const prefix: typeof completedPrefix = [
    ...completedPrefix,
    {
      id: 'old-note-one',
      role: 'assistant',
      content: 'Recorded the previous expense.',
    },
    {
      id: 'old-note-two',
      role: 'assistant',
      content: 'Ready for another expense.',
    },
  ];
  const start = {
    ...running(),
    transcript: [...prefix, ...running().transcript],
  };
  const owned = captureTurn(start, 'thread', 'previous-resume', prefix)!;
  const { pause, done } = batch();
  pause.transcript = [
    ...prefix,
    ...pause.transcript,
    { id: 'pause-note', role: 'assistant', content: 'Awaiting review.' },
  ];
  // Move the known pending lookup result between the retained declaration and
  // the retained pause note, preserving every retained row's relative order.
  done.transcript = [
    ...prefix,
    ...done.transcript.slice(0, 2),
    done.transcript[3],
    pause.transcript.at(-1),
    done.transcript[2],
  ];
  return { prefix, start, owned, pause, done };
}
it('preserves a nonempty completed prefix and accepts an inserted known pending lookup result', () => {
  const { prefix, start, owned, pause, done } = laterTurn();
  expect(captureTurn(start, 'thread', 'previous-resume', prefix)).toBeDefined();
  const approval = captureApproval(pause, owned)!;
  expect(approval).toBeDefined();
  expect(confirmResume(done, approval, 'resume', true)?.result).toBe(
    literal(true)
  );
});
it.each(['turn', 'approval', 'resume'] as const)(
  'rejects reversed retained rows during %s with a nonempty completed prefix',
  (stage) => {
    const { prefix, start, owned, pause, done } = laterTurn();
    if (stage === 'turn') {
      expect(
        captureTurn(
          {
            ...start,
            transcript: [...prefix].reverse().concat(running().transcript),
          },
          'thread',
          'previous-resume',
          prefix
        )
      ).toBeUndefined();
    } else if (stage === 'approval') {
      pause.transcript.splice(0, prefix.length, ...[...prefix].reverse());
      expect(captureApproval(pause, owned)).toBeUndefined();
    } else {
      const approval = captureApproval(pause, owned)!;
      done.transcript.splice(0, prefix.length, ...[...prefix].reverse());
      expect(confirmResume(done, approval, 'resume', true)).toBeUndefined();
    }
  }
);
it.each(['turn', 'approval', 'resume'] as const)(
  'rejects reversed retained assistant prose during %s independently of tool causality',
  (stage) => {
    const { prefix, start, owned, pause, done } = laterTurn();
    const reordered = [...prefix];
    [reordered[3], reordered[4]] = [reordered[4], reordered[3]];
    if (stage === 'turn') {
      expect(
        captureTurn(
          { ...start, transcript: [...reordered, ...running().transcript] },
          'thread',
          'previous-resume',
          prefix
        )
      ).toBeUndefined();
    } else if (stage === 'approval') {
      pause.transcript.splice(0, prefix.length, ...reordered);
      expect(captureApproval(pause, owned)).toBeUndefined();
    } else {
      const approval = captureApproval(pause, owned)!;
      done.transcript.splice(0, prefix.length, ...reordered);
      expect(confirmResume(done, approval, 'resume', true)).toBeUndefined();
    }
  }
);
it.each(['approval', 'resume'] as const)(
  'rejects a current declaration before the owned current human during %s',
  (stage) => {
    const { prefix, owned, pause } = laterTurn();
    if (stage === 'approval') {
      [pause.transcript[prefix.length], pause.transcript[prefix.length + 1]] = [
        pause.transcript[prefix.length + 1],
        pause.transcript[prefix.length],
      ];
      expect(captureApproval(pause, owned)).toBeUndefined();
    } else {
      // Metadata-only native pause intentionally has no redundant declaration.
      const approval = captureApproval(
        { ...paused(), transcript: [...prefix, ...paused().transcript] },
        owned
      )!;
      expect(approval).toBeDefined();
      const final = {
        ...completed(),
        transcript: [...prefix, ...completed().transcript],
      };
      [final.transcript[prefix.length], final.transcript[prefix.length + 1]] = [
        final.transcript[prefix.length + 1],
        final.transcript[prefix.length],
      ];
      expect(confirmResume(final, approval, 'resume', true)).toBeUndefined();
    }
  }
);
it.each(['turn', 'approval', 'resume'] as const)(
  'rejects a result before a matching known historical declaration during %s',
  (stage) => {
    const { prefix, start, owned, pause, done } = laterTurn();
    // Use equally reordered retained input to isolate causal validation from
    // retained-subsequence validation at each admission stage.
    const reversed = [prefix[0], prefix[2], prefix[1]];
    if (stage === 'turn')
      expect(
        captureTurn(
          { ...start, transcript: [...reversed, ...running().transcript] },
          'thread',
          'previous-resume',
          reversed
        )
      ).toBeUndefined();
    if (stage === 'approval') {
      pause.transcript.splice(0, prefix.length, ...reversed);
      expect(
        captureApproval(pause, { ...owned, prefix: reversed })
      ).toBeUndefined();
    }
    if (stage === 'resume') {
      const approval = captureApproval(pause, owned)!;
      const rows = [...approval.transcript];
      rows.splice(0, prefix.length, ...reversed);
      done.transcript.splice(0, prefix.length, ...reversed);
      expect(
        confirmResume(done, { ...approval, transcript: rows }, 'resume', true)
      ).toBeUndefined();
    }
  }
);
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
