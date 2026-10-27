import { describe, expect, it } from 'vitest';
import type { AGUIEvent, Message } from '@ag-ui/client';
import { createClientToolLedger } from './client-tool-ledger.js';
import { ownTranscript } from './transcript.js';

type Contracts = {
  weather: { args: { city: string }; result: { degrees: number } };
};
const call = (
  id = 'c',
  raw = '{"city":"Paris"}',
  name = 'weather',
  owner = 'a',
  child?: string
): Message => ({
  id: owner,
  role: 'assistant',
  ...(child && { subagentRunId: child }),
  toolCalls: [{ id, type: 'function', function: { name, arguments: raw } }],
});
const tool = (id = 'result', toolCallId = 'c', content = 'ok'): Message => ({
  id,
  role: 'tool',
  toolCallId,
  content,
});
const event = (value: unknown) => value as AGUIEvent;
const success = (pending?: string[]) =>
  event({
    type: 'RUN_FINISHED',
    runId: 'r',
    threadId: 't',
    ...(pending !== undefined && {
      outcome: { type: 'success', pendingToolCallIds: pending },
    }),
  });
function fixture(initial: Message[] = []) {
  const ledger = createClientToolLedger<Contracts>(
    ['weather'],
    ownTranscript(initial)
  );
  const physical = ledger.startPhysical({
    runId: 'r',
    threadId: 't',
    transcript: ownTranscript(initial),
  });
  ledger.observe(
    physical,
    event({ type: 'RUN_STARTED', runId: 'r', threadId: 't' }),
    ownTranscript(initial)
  );
  const finish = (messages: Message[], pending?: string[]) => {
    ledger.observe(
      physical,
      event({ type: 'MESSAGES_SNAPSHOT', messages }),
      ownTranscript(messages)
    );
    ledger.observe(physical, success(pending), ownTranscript(messages));
    return ledger.admitSuccess(physical);
  };
  return { ledger, physical, finish };
}

describe('request-local client tool ledger', () => {
  it.each(['not-paused', 'foreign-pause', 'rewritten', 'new'] as const)(
    'denies native resume capture for %s history',
    (mode) => {
      const { ledger, physical } = fixture();
      ledger.observe(
        physical,
        event({ type: 'MESSAGES_SNAPSHOT', messages: [call()] }),
        ownTranscript([call()])
      );
      if (mode !== 'not-paused')
        ledger.observe(
          physical,
          event({
            type: 'RUN_FINISHED',
            threadId: mode === 'foreign-pause' ? 'foreign' : 't',
            runId: 'r',
            outcome: { type: 'interrupt', interrupts: [{ id: 'approve' }] },
          }),
          ownTranscript([call()])
        );
      const history =
        mode === 'rewritten'
          ? [call('c', '{"city":"Rome"}')]
          : mode === 'new'
          ? [call(), call('new', '{}', 'weather', 'new-owner')]
          : [call()];
      ledger.startPhysical({
        runId: 'resume',
        threadId: 't',
        transcript: ownTranscript(history),
      });
      expect(() =>
        ledger.captureNativeResumeRequest(ownTranscript(history), physical)
      ).toThrow();
    }
  );
  it('captures the actual retained result batch for the exact paused request without acknowledgement', () => {
    const { ledger, physical, finish } = fixture();
    finish([call()]);
    ledger.markRunning('c');
    ledger.complete('c', 'local', { degrees: 20 }, ownTranscript([call()]));
    const history = ledger.retainHistory(ownTranscript([call()]));
    const continuation = ledger.startPhysical({
      runId: 'continuation',
      threadId: 't',
      transcript: history,
    });
    ledger.observe(
      continuation,
      event({ type: 'RUN_STARTED', threadId: 't', runId: 'continuation' }),
      history
    );
    ledger.observe(
      continuation,
      event({
        type: 'RUN_FINISHED',
        threadId: 't',
        runId: 'continuation',
        outcome: { type: 'interrupt', interrupts: [{ id: 'approve' }] },
      }),
      history
    );
    ledger.startPhysical({
      runId: 'resume',
      threadId: 't',
      transcript: history,
    });
    expect(() =>
      ledger.captureNativeResumeRequest(history, physical)
    ).toThrow();
    const capture = ledger.captureNativeResumeRequest(history, continuation);
    expect(capture.transcript).toEqual(history);
    expect(capture.resultMessageIds).toEqual(['local']);
    expect(ledger.snapshot().calls[0].delivery).toBe('unsent');
    ledger.markFetchInvoked(capture);
    expect(ledger.snapshot().calls[0].delivery).toBe('sent-unconfirmed');
  });
  it('admits snapshot-only finalized root calls as an immutable typed group', () => {
    const { ledger, finish } = fixture();
    expect(finish([call()])).toEqual(['c']);
    expect(ledger.snapshot().calls[0]).toMatchObject({
      name: 'weather',
      args: { city: 'Paris' },
      status: 'pending',
      provenance: 'local',
      delivery: 'unsent',
    });
    expect(Object.isFrozen(ledger.snapshot().calls[0].args)).toBe(true);
  });
  it('uses final snapshot arguments to repair provisional fragments', () => {
    const { ledger, physical, finish } = fixture();
    ledger.observe(
      physical,
      event({
        type: 'TOOL_CALL_START',
        toolCallId: 'c',
        toolCallName: 'weather',
        parentMessageId: 'a',
      }),
      ownTranscript([call('c', '')])
    );
    ledger.observe(
      physical,
      event({ type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: '{"city":' }),
      ownTranscript([call('c', '{"city":')])
    );
    expect(finish([call('c', ' { "city": "Paris" } ')])).toEqual(['c']);
    expect(ledger.snapshot().calls[0].args).toEqual({ city: 'Paris' });
  });
  it('requires tool end and valid JSON for a stream without a final snapshot', () => {
    for (const ended of [false, true]) {
      const { ledger, physical } = fixture();
      ledger.observe(
        physical,
        event({
          type: 'TOOL_CALL_START',
          toolCallId: 'c',
          toolCallName: 'weather',
          parentMessageId: 'a',
        }),
        ownTranscript([call()])
      );
      if (ended)
        ledger.observe(
          physical,
          event({ type: 'TOOL_CALL_END', toolCallId: 'c' }),
          ownTranscript([call()])
        );
      ledger.observe(physical, success(), ownTranscript([call()]));
      expect(ledger.admitSuccess(physical)).toEqual(ended ? ['c'] : []);
    }
    const { ledger, physical } = fixture();
    ledger.observe(
      physical,
      event({ type: 'TOOL_CALL_END', toolCallId: 'c' }),
      ownTranscript([call('c', '{')])
    );
    ledger.observe(physical, success(), ownTranscript([call('c', '{')]));
    expect(ledger.admitSuccess(physical)).toEqual([]);
  });
  it.each([
    undefined,
    { type: 'RUN_FINISHED', threadId: 't', runId: 'foreign' },
    { type: 'RUN_FINISHED', threadId: 't', runId: 'r', subagentRunId: 'child' },
    {
      type: 'RUN_FINISHED',
      threadId: 't',
      runId: 'r',
      outcome: { type: 'interrupt', interrupts: [] },
    },
    { type: 'RUN_ERROR', message: 'error' },
  ])('admits nothing without matching genuine success: %j', (terminal) => {
    const { ledger, physical } = fixture();
    ledger.observe(
      physical,
      event({ type: 'MESSAGES_SNAPSHOT', messages: [call()] }),
      ownTranscript([call()])
    );
    if (terminal)
      ledger.observe(physical, event(terminal), ownTranscript([call()]));
    expect(ledger.admitSuccess(physical)).toEqual([]);
    expect(ledger.snapshot().calls).toEqual([]);
  });
  it('does not admit child calls, backend-result calls or removed calls', () => {
    expect(
      fixture().finish([call('c', '{}', 'weather', 'a', 'child')])
    ).toEqual([]);
    expect(fixture().finish([call(), tool()])).toEqual([]);
    const { ledger, physical, finish } = fixture();
    ledger.observe(
      physical,
      event({
        type: 'TOOL_CALL_START',
        toolCallId: 'c',
        toolCallName: 'weather',
        parentMessageId: 'a',
      }),
      ownTranscript([call()])
    );
    expect(finish([])).toEqual([]);
  });
  it.each([[[]], [['missing']], [['c', 'c']]])(
    'blocks invalid or orphan explicit selection %j',
    (pending) => {
      const { ledger, finish } = fixture();
      expect(finish([call()], pending)).toEqual([]);
      expect(ledger.snapshot().blocker).toBeDefined();
      expect(ledger.snapshot().calls).toEqual([]);
    }
  );
  it('blocks the whole group for unknown names and excluded unresolved calls', () => {
    for (const pending of [undefined, ['c']]) {
      const { ledger, finish } = fixture();
      expect(
        finish([call(), call('other', '{}', 'unknown', 'b')], pending)
      ).toEqual([]);
      expect(ledger.snapshot().blocker).toBeDefined();
      expect(ledger.snapshot().calls).toEqual([]);
    }
  });
  it('blocks imported or resumed baseline unresolved root history', () => {
    expect(fixture([call()]).ledger.snapshot().blocker?.reason).toBe(
      'unsupported'
    );
    const { ledger } = fixture();
    const physical = ledger.startPhysical({
      runId: 'r',
      threadId: 't',
      transcript: ownTranscript([call()]),
    });
    ledger.observe(
      physical,
      event({ type: 'RUN_STARTED', runId: 'r', threadId: 't' }),
      ownTranscript([call()])
    );
    ledger.observe(physical, success(['c']), ownTranscript([call()]));
    expect(ledger.admitSuccess(physical)).toEqual([]);
    expect(ledger.snapshot().blocker).toBeDefined();
  });
  it.each([
    call('c', '{}', 'weather', 'other'),
    call('c', '{}', 'unknown'),
    call('c', '{}', 'weather', 'a', 'child'),
  ])('blocks a candidate ownership/name/attribution rewrite', (rewritten) => {
    const { ledger, physical, finish } = fixture();
    ledger.observe(
      physical,
      event({
        type: 'TOOL_CALL_START',
        toolCallId: 'c',
        toolCallName: 'weather',
        parentMessageId: 'a',
      }),
      ownTranscript([call()])
    );
    expect(finish([rewritten])).toEqual([]);
    expect(ledger.snapshot().blocker?.reason).toBe('conflict');
  });
  it('consumes all calls in final order before publication and does not replay', () => {
    const { ledger, finish } = fixture();
    expect(finish([call('second', '{}', 'weather', 'b'), call()])).toEqual([
      'second',
      'c',
    ]);
    expect(ledger.snapshot().calls.map((item) => item.status)).toEqual([
      'pending',
      'pending',
    ]);
    ledger.complete(
      'second',
      's',
      { degrees: 2 },
      ownTranscript([call('second', '{}', 'weather', 'b'), call()])
    );
    ledger.complete(
      'c',
      'z',
      { degrees: 3 },
      ownTranscript([call('second', '{}', 'weather', 'b'), call()])
    );
    const physical = ledger.startPhysical({
      runId: 'r',
      threadId: 't',
      transcript: ownTranscript([]),
    });
    const history = ownTranscript([
      call('second', ' {} ', 'weather', 'b'),
      call('c', ' {"city":"Paris"} '),
    ]);
    ledger.observe(
      physical,
      event({ type: 'RUN_STARTED', runId: 'r', threadId: 't' }),
      history
    );
    ledger.observe(
      physical,
      event({ type: 'MESSAGES_SNAPSHOT', messages: history }),
      history
    );
    ledger.observe(physical, success(), history);
    expect(ledger.admitSuccess(physical)).toEqual([]);
    expect(ledger.snapshot().blocker).toBeUndefined();
    expect(ledger.snapshot().calls).toHaveLength(2);
  });
  it('blocks a consumed invocation rewrite even when a backend result exists', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', { degrees: 1 }, ownTranscript([call()]));
    expect(
      ledger.retainHistory(
        ownTranscript([
          call('c', '{"city":"Rome"}'),
          tool('result', 'c', '{"degrees":1}'),
        ])
      )
    ).toHaveLength(2);
    expect(ledger.snapshot().blocker?.reason).toBe('conflict');
  });
  it('keeps malformed final JSON raw and produces a legitimate local error', () => {
    const { ledger, finish } = fixture();
    expect(finish([call('c', '{')])).toEqual(['c']);
    expect(ledger.snapshot().calls[0]).toMatchObject({
      rawArguments: '{',
      error: expect.any(String),
      status: 'pending',
    });
    expect(ledger.snapshot().calls[0]).not.toHaveProperty('args');
    ledger.fail(
      'c',
      'error-result',
      'Invalid JSON arguments',
      ownTranscript([call('c', '{')])
    );
    expect(
      ledger.retainHistory(ownTranscript([call('c', '{')]))[1]
    ).toMatchObject({
      role: 'tool',
      content: 'Error: Invalid JSON arguments',
      toolCallId: 'c',
    });
  });
  it('owns copied results and mutable handler args independently including dangerous keys', () => {
    const { ledger, finish } = fixture();
    finish([
      call('c', '{"city":"Paris","__proto__":{"x":1},"constructor":{"y":2}}'),
    ]);
    const args = ledger.argumentsFor('c') as { city: string };
    args.city = 'Rome';
    expect(ledger.snapshot().calls[0].args).toMatchObject({
      city: 'Paris',
      __proto__: { x: 1 },
    });
    const result = { degrees: 1 };
    ledger.markRunning('c');
    ledger.complete(
      'c',
      'result',
      result,
      ownTranscript([
        call('c', '{"city":"Paris","__proto__":{"x":1},"constructor":{"y":2}}'),
      ])
    );
    result.degrees = 99;
    expect(ledger.snapshot().calls[0].result).toEqual({ degrees: 1 });
    expect(Object.isFrozen(ledger.snapshot().calls[0].result)).toBe(true);
  });
  it.each([
    ['literal', 'literal'],
    [undefined, ''],
    [{ degrees: 4 }, '{"degrees":4}'],
  ])('encodes result %j explicitly', (value, content) => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', value, ownTranscript([call()]));
    expect(ledger.retainHistory(ownTranscript([call()]))[1]).toMatchObject({
      content,
    });
  });
  it.each([
    () => 1,
    new Date(),
    Number.NaN,
    { x: undefined },
    { toJSON: () => 'hidden' },
  ])(
    'retains explicit error for nonportable or lossy encoded results',
    (value) => {
      const { ledger, finish } = fixture();
      finish([call()]);
      ledger.complete('c', 'result', value, ownTranscript([call()]));
      expect(ledger.snapshot().calls[0].status).toBe('error');
      expect(ledger.retainHistory(ownTranscript([call()]))[1]).toMatchObject({
        content: expect.stringMatching(/^Error:/),
      });
    }
  );
  it('rejects result message collisions before publication', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    expect(() =>
      ledger.complete('c', 'a', { degrees: 1 }, ownTranscript([call()]))
    ).toThrow();
    expect(ledger.snapshot().blocker?.reason).toBe('conflict');
    expect(ledger.snapshot().calls[0].status).toBe('pending');
  });
  it('captures exact request batches and marks only invoked captured results', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', { degrees: 1 }, ownTranscript([call()]));
    const captured = ledger.captureRequest(ownTranscript([call()]));
    const physical = ledger.startPhysical({
      runId: 'r',
      threadId: 't',
      transcript: captured.transcript,
    });
    const next = ownTranscript([call(), call('d', '{}', 'weather', 'b')]);
    ledger.observe(
      physical,
      event({ type: 'RUN_STARTED', runId: 'r', threadId: 't' }),
      captured.transcript
    );
    ledger.observe(
      physical,
      event({ type: 'MESSAGES_SNAPSHOT', messages: next }),
      next
    );
    ledger.observe(physical, success(), next);
    expect(ledger.admitSuccess(physical)).toEqual(['d']);
    ledger.complete(
      'd',
      'later',
      { degrees: 2 },
      ownTranscript([call(), call('d', '{}', 'weather', 'b')])
    );
    expect(ledger.snapshot().calls.map((item) => item.delivery)).toEqual([
      'unsent',
      'unsent',
    ]);
    ledger.markFetchInvoked(captured);
    expect(ledger.snapshot().calls.map((item) => item.delivery)).toEqual([
      'sent-unconfirmed',
      'unsent',
    ]);
    expect(captured.transcript).toHaveLength(2);
  });
  it('retains omitted sent results and acknowledges only exact native echoes', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', { degrees: 1 }, ownTranscript([call()]));
    ledger.markFetchInvoked(ledger.captureRequest(ownTranscript([call()])));
    expect(ledger.retainHistory(ownTranscript([call()]))).toHaveLength(2);
    expect(ledger.snapshot().calls[0].delivery).toBe('sent-unconfirmed');
    ledger.reconcileNativeHistory(
      ownTranscript([call(), tool('result', 'c', '{"degrees":1}')])
    );
    expect(ledger.snapshot().calls[0].delivery).toBe('observed');
  });
  it.each([
    tool('result', 'c', 'changed'),
    tool('result', 'other', '{"degrees":1}'),
    tool('alternate', 'c', '{"degrees":1}'),
  ])('blocks incompatible native echo %j', (echo) => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', { degrees: 1 }, ownTranscript([call()]));
    ledger.reconcileNativeHistory(ownTranscript([call(), echo]));
    expect(ledger.snapshot().blocker?.reason).toBe('conflict');
  });
  it('does not invent messages for cancelled incomplete calls or allow orphan history', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.cancelIncomplete('r');
    expect(ledger.snapshot().calls[0].status).toBe('cancelled');
    expect(ledger.retainHistory(ownTranscript([call()]))).toHaveLength(1);
    expect(ledger.snapshot().blocker?.reason).toBe('cancelled');
    expect(ledger.historyIntegrity(ownTranscript([call()]))).toBe(false);
    expect(() =>
      ledger.complete('c', 'late', { degrees: 1 }, ownTranscript([call()]))
    ).toThrow();
  });
  it('does not acknowledge a retained local result while preparing another request', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', { degrees: 1 }, ownTranscript([call()]));
    const history = ledger.retainHistory(ownTranscript([call()]));
    ledger.captureRequest(history);
    expect(ledger.snapshot().calls[0].delivery).toBe('unsent');
  });
  it('copies result getters exactly once and rejects nested symbol data', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    let reads = 0;
    ledger.complete(
      'c',
      'result',
      {
        get degrees() {
          reads++;
          return reads;
        },
      },
      ownTranscript([call()])
    );
    expect(reads).toBe(1);
    expect(ledger.snapshot().calls[0].result).toEqual({ degrees: 1 });
    const other = fixture();
    other.finish([call()]);
    other.ledger.complete(
      'c',
      'result',
      { nested: { [Symbol('private')]: 1 } },
      ownTranscript([call()])
    );
    expect(other.ledger.snapshot().calls[0].status).toBe('error');
  });
  it('never admits a call whose backend result was observed then removed', () => {
    const { ledger, physical, finish } = fixture();
    ledger.observe(
      physical,
      event({
        type: 'TOOL_CALL_RESULT',
        messageId: 'backend',
        toolCallId: 'c',
        content: 'ok',
      }),
      ownTranscript([call(), tool('backend')])
    );
    expect(finish([call()])).toEqual([]);
    expect(ledger.snapshot().blocker?.reason).toBe('unsupported');
  });
  it('ignores stale physical authority after a newer physical request starts', () => {
    const { ledger, physical, finish } = fixture();
    ledger.startPhysical({
      runId: 'new',
      threadId: 't',
      transcript: ownTranscript([]),
    });
    expect(finish([call()])).toEqual([]);
    expect(ledger.snapshot().calls).toEqual([]);
    expect(ledger.admitSuccess(physical)).toEqual([]);
  });
  it('blocks an owner snapshot that removes a consumed invocation', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', { degrees: 1 }, ownTranscript([call()]));
    ledger.reconcileNativeHistory(
      ownTranscript([{ id: 'a', role: 'assistant', content: 'replaced' }])
    );
    expect(ledger.snapshot().blocker?.reason).toBe('conflict');
  });
  it('retains the exact local invocation and result when native history omits both', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', { degrees: 1 }, ownTranscript([call()]));
    const history = ledger.reconcileNativeHistory(ownTranscript([]));
    expect(history).toHaveLength(2);
    expect(ledger.historyIntegrity(history)).toBe(true);
    expect(ledger.snapshot().calls[0].delivery).toBe('unsent');
  });
  it('blocks incompatible child event attribution even if the transcript is root', () => {
    const { ledger, physical, finish } = fixture();
    ledger.observe(
      physical,
      event({
        type: 'TOOL_CALL_START',
        toolCallId: 'c',
        toolCallName: 'weather',
        parentMessageId: 'a',
        subagentRunId: 'child',
      }),
      ownTranscript([call()])
    );
    expect(finish([call()])).toEqual([]);
    expect(ledger.snapshot().blocker?.reason).toBe('conflict');
  });
  it('does not accept forged result batches', () => {
    const { ledger } = fixture();
    expect(() =>
      ledger.markFetchInvoked({
        transcript: ownTranscript([]),
        resultMessageIds: [],
      })
    ).toThrow();
  });
  it('blocks native local-result conflicts before admitting another group', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', { degrees: 1 }, ownTranscript([call()]));
    const baseline = ledger.retainHistory(ownTranscript([call()]));
    const physical = ledger.startPhysical({
      runId: 'r',
      threadId: 't',
      transcript: baseline,
    });
    const next = ownTranscript([
      call(),
      tool('result', 'c', 'changed'),
      call('d', '{}', 'weather', 'b'),
    ]);
    ledger.observe(
      physical,
      event({ type: 'RUN_STARTED', runId: 'r', threadId: 't' }),
      baseline
    );
    ledger.observe(
      physical,
      event({ type: 'MESSAGES_SNAPSHOT', messages: next }),
      next
    );
    ledger.observe(physical, success(), next);
    expect(ledger.admitSuccess(physical)).toEqual([]);
    expect(ledger.snapshot().blocker?.reason).toBe('conflict');
    expect(ledger.snapshot().calls).toHaveLength(1);
  });
  it('refuses request capture with admitted incomplete calls', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    expect(() => ledger.captureRequest(ownTranscript([call()]))).toThrow();
  });
  it('does not publish a result if a result getter cancels its admitted call', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    expect(() =>
      ledger.complete(
        'c',
        'result',
        {
          get degrees() {
            ledger.cancelIncomplete('r');
            return 1;
          },
        },
        ownTranscript([call()])
      )
    ).toThrow();
    expect(ledger.snapshot().calls[0].status).toBe('cancelled');
    expect(ledger.retainHistory(ownTranscript([call()]))).toHaveLength(1);
  });
  it('captures the first command blocker without retaining caller mutations', () => {
    const { ledger } = fixture();
    const callIds = ['c'];
    ledger.installBlocker({ reason: 'uncertain', sourceRunId: 'r', callIds });
    callIds.push('other');
    ledger.installBlocker({
      reason: 'limit',
      sourceRunId: 'later',
      callIds: [],
    });
    expect(ledger.snapshot().blocker).toEqual({
      reason: 'uncertain',
      sourceRunId: 'r',
      callIds: ['c'],
    });
  });
  it.each([undefined, null, 1, ['c', 1]])(
    'blocks an explicitly present incompatible pending declaration %j',
    (pendingToolCallIds) => {
      const { ledger, physical } = fixture();
      ledger.observe(
        physical,
        event({ type: 'MESSAGES_SNAPSHOT', messages: [call()] }),
        ownTranscript([call()])
      );
      ledger.observe(
        physical,
        event({
          type: 'RUN_FINISHED',
          threadId: 't',
          runId: 'r',
          outcome: { type: 'success', pendingToolCallIds },
        }),
        ownTranscript([call()])
      );
      expect(ledger.admitSuccess(physical)).toEqual([]);
      expect(ledger.snapshot().blocker?.reason).toBe('conflict');
    }
  );
  it('does not conflate a decoded overflow number invocation with null', () => {
    const { ledger, finish } = fixture();
    finish([call('c', '{"city":1e400}')]);
    ledger.complete(
      'c',
      'result',
      { degrees: 1 },
      ownTranscript([call('c', '{"city":1e400}')])
    );
    ledger.retainHistory(ownTranscript([call('c', '{"city":null}')]));
    expect(ledger.snapshot().blocker?.reason).toBe('conflict');
  });
  it('keeps an omitted local owner and result before a later native answer and next human', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', { degrees: 1 }, ownTranscript([call()]));
    ledger.markFetchInvoked(ledger.captureRequest(ownTranscript([call()])));
    const answer: Message = {
      id: 'answer',
      role: 'assistant',
      content: 'done',
    };
    const human: Message = { id: 'next-human', role: 'user', content: 'next' };
    expect(
      ledger
        .reconcileNativeHistory(ownTranscript([answer]))
        .map((message) => message.id)
    ).toEqual(['a', 'result', 'answer']);
    expect(
      ledger
        .retainHistory(ownTranscript([answer, human]))
        .map((message) => message.id)
    ).toEqual(['a', 'result', 'answer', 'next-human']);
    expect(
      ledger
        .captureRequest(ownTranscript([answer, human]))
        .transcript.map((message) => message.id)
    ).toEqual(['a', 'result', 'answer', 'next-human']);
    expect(ledger.snapshot().calls[0].delivery).toBe('sent-unconfirmed');
    expect(ledger.snapshot().blocker).toBeUndefined();
  });
  it('retains multiple group owners and results between surviving earlier and later history anchors', () => {
    const earlier: Message = {
      id: 'earlier-human',
      role: 'user',
      content: 'first',
    };
    const middle: Message = {
      id: 'middle-answer',
      role: 'assistant',
      content: 'first answer',
    };
    const later: Message = {
      id: 'last-answer',
      role: 'assistant',
      content: 'second answer',
    };
    const nextHuman: Message = {
      id: 'next-human',
      role: 'user',
      content: 'next',
    };
    const { ledger, finish } = fixture([earlier]);
    finish([earlier, call()]);
    ledger.complete(
      'c',
      'first-result',
      { degrees: 1 },
      ownTranscript([earlier, call()])
    );
    const baseline = ledger.retainHistory(
      ownTranscript([earlier, call(), middle])
    );
    const physical = ledger.startPhysical({
      runId: 'r',
      threadId: 't',
      transcript: baseline,
    });
    const second = ownTranscript([
      ...baseline,
      call('d', '{}', 'weather', 'b'),
    ]);
    ledger.observe(
      physical,
      event({ type: 'RUN_STARTED', runId: 'r', threadId: 't' }),
      baseline
    );
    ledger.observe(
      physical,
      event({ type: 'MESSAGES_SNAPSHOT', messages: second }),
      second
    );
    ledger.observe(physical, success(), second);
    expect(ledger.admitSuccess(physical)).toEqual(['d']);
    ledger.complete('d', 'second-result', { degrees: 2 }, second);
    const expected = [
      'earlier-human',
      'a',
      'first-result',
      'middle-answer',
      'b',
      'second-result',
      'last-answer',
    ];
    expect(
      ledger
        .reconcileNativeHistory(ownTranscript([earlier, middle, later]))
        .map((message) => message.id)
    ).toEqual(expected);
    expect(
      ledger
        .retainHistory(ownTranscript([earlier, middle, later, nextHuman]))
        .map((message) => message.id)
    ).toEqual([...expected, 'next-human']);
    expect(
      ledger
        .reconcileNativeHistory(ownTranscript([later]))
        .map((message) => message.id)
    ).toEqual(['a', 'first-result', 'b', 'second-result', 'last-answer']);
    expect(
      ledger
        .reconcileNativeHistory(ownTranscript([]))
        .map((message) => message.id)
    ).toEqual(['a', 'first-result', 'b', 'second-result']);
    expect(
      ledger
        .retainHistory(
          ownTranscript([{ id: 'fresh-human', role: 'user', content: 'fresh' }])
        )
        .map((message) => message.id)
    ).toEqual(['a', 'first-result', 'b', 'second-result', 'fresh-human']);
    expect(ledger.snapshot().blocker).toBeUndefined();
  });
  it('captures history position independently of caller mutation and preserves owner rewrite conflicts', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', { degrees: 1 }, ownTranscript([call()]));
    const answer: Message = {
      id: 'answer',
      role: 'assistant',
      content: 'done',
    };
    const input: Message[] = [answer];
    const retained = ledger.reconcileNativeHistory(input);
    input.push({ id: 'injected-human', role: 'user', content: 'injected' });
    answer.id = 'changed';
    expect(retained.map((message) => message.id)).toEqual([
      'a',
      'result',
      'answer',
    ]);
    expect(
      ledger
        .retainHistory(
          ownTranscript([{ id: 'answer', role: 'assistant', content: 'done' }])
        )
        .map((message) => message.id)
    ).toEqual(['a', 'result', 'answer']);
    ledger.reconcileNativeHistory(
      ownTranscript([
        call('c', '{"city":"Rome"}'),
        { id: 'answer', role: 'assistant', content: 'done' },
      ])
    );
    expect(ledger.snapshot().blocker?.reason).toBe('conflict');
    expect(ledger.snapshot().calls[0].args).toEqual({ city: 'Paris' });
  });
  it('rejects authoring a local result under an omitted known native message identity', () => {
    const prior: Message = {
      id: 'prior-native',
      role: 'user',
      content: 'first',
    };
    const { ledger, finish } = fixture([prior]);
    finish([call()]);
    expect(() =>
      ledger.complete(
        'c',
        'prior-native',
        { degrees: 1 },
        ownTranscript([call()])
      )
    ).toThrow();
    expect(ledger.snapshot().blocker?.reason).toBe('conflict');
    expect(ledger.snapshot().calls[0].status).toBe('pending');
  });
  it('preserves current native row order while restoring only legitimate local rows', () => {
    const { ledger, finish } = fixture();
    finish([call()]);
    ledger.complete('c', 'result', { degrees: 1 }, ownTranscript([call()]));
    const left: Message = { id: 'left', role: 'assistant', content: 'left' };
    const right: Message = { id: 'right', role: 'assistant', content: 'right' };
    ledger.reconcileNativeHistory(ownTranscript([left, right]));
    expect(
      ledger
        .retainHistory(ownTranscript([right, left]))
        .map((message) => message.id)
    ).toEqual(['a', 'result', 'right', 'left']);
  });
});
