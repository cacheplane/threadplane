import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AGUIEvent } from '@ag-ui/client';
import { projectMessages, projectToolCalls } from './message-projection';
import { createReasoningClock } from './reasoning-clock';
import {
  initialObservation,
  type Observation,
} from './session-observation';
import { bindingFixture } from './testing/binding-fixture';

type Records = NonNullable<Parameters<typeof initialObservation>[0]>;
const observed = (
  messages: Records,
  extra: Partial<Observation> = {}
): Observation =>
  Object.freeze({ ...initialObservation(messages), ...extra });
const turn: Records = [
  { id: 'system', role: 'system', content: 'Policy' },
  { id: 'u', role: 'user', content: 'Ask' },
  { id: 'r1', role: 'reasoning', content: 'Plan the search.' },
  {
    id: 'a1',
    role: 'assistant',
    toolCalls: [
      {
        id: 'call',
        type: 'function',
        function: { name: 'search', arguments: '{}' },
      },
    ],
  },
  { id: 't', role: 'tool', content: 'Result', toolCallId: 'call' },
  { id: 'r2', role: 'reasoning', content: 'Compare.' },
  { id: 'r3', role: 'reasoning', content: 'Decide.' },
  { id: 'a2', role: 'assistant', content: 'The answer.' },
];

describe('projectMessages', () => {
  it('attaches each reasoning record to the assistant record after it', () => {
    const messages = projectMessages(
      observed(turn, { reasoningDurations: { r1: 1_200, r2: 2_000, r3: 900 } })
    );
    expect(messages).toEqual([
      {
        id: 'u',
        role: 'user',
        content: 'Ask',
        delivery: { generation: 'u', phase: 'complete', outcome: 'success' },
      },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        reasoning: 'Plan the search.',
        reasoningDurationMs: 1_200,
        toolCallIds: ['call'],
        delivery: { generation: 'a1', phase: 'complete', outcome: 'success' },
      },
      {
        id: 't',
        role: 'tool',
        content: 'Result',
        toolCallId: 'call',
        delivery: { generation: 't', phase: 'complete', outcome: 'success' },
      },
      {
        id: 'a2',
        role: 'assistant',
        content: 'The answer.',
        reasoning: 'Compare.\n\nDecide.',
        reasoningDurationMs: 2_900,
        delivery: { generation: 'a2', phase: 'complete', outcome: 'success' },
      },
    ]);
    expect(Object.isFrozen(messages)).toBe(true);
    expect(messages.every(Object.isFrozen)).toBe(true);
  });

  it('reports no time for unmeasured reasoning and sums only measured records', () => {
    expect(projectMessages(observed(turn))[3]).not.toHaveProperty(
      'reasoningDurationMs'
    );
    expect(
      projectMessages(
        observed(turn, {
          reasoningDurations: { r3: 900, r2: Number.NaN, other: 5 },
        })
      ).map((message) => message.reasoningDurationMs)
    ).toEqual([undefined, undefined, undefined, 900]);
  });

  it('shows reasoning that has no answer record yet under its own identifier', () => {
    const thinking = projectMessages(
      observed(
        [
          { id: 'u', role: 'user', content: 'Ask' },
          { id: 'r1', role: 'reasoning', content: 'Plan' },
        ],
        { status: 'running' }
      )
    );
    expect(thinking[1]).toEqual({
      id: 'r1',
      role: 'assistant',
      content: '',
      reasoning: 'Plan',
      delivery: { generation: 'r1', phase: 'streaming' },
    });
    // Reasoning left before the next user message is not moved past it.
    expect(
      projectMessages(
        observed([
          { id: 'r0', role: 'reasoning', content: 'Earlier' },
          { id: 'u', role: 'user', content: 'Ask' },
          { id: 'a', role: 'assistant', content: 'Answer' },
        ])
      ).map((message) => [message.id, message.reasoning])
    ).toEqual([
      ['r0', 'Earlier'],
      ['u', undefined],
      ['a', undefined],
    ]);
  });

  it('leaves out records that are not root conversation text', () => {
    const messages = projectMessages(
      observed([
        { id: 'developer', role: 'developer', content: 'Rules' },
        {
          id: 'parts',
          role: 'user',
          content: [
            { type: 'text', text: 'First' },
            { type: 'text', text: 'Second' },
          ],
        },
        { id: 'empty-reasoning', role: 'reasoning', content: '' },
        { id: 'empty', role: 'assistant', content: '' },
        { id: 'child', role: 'assistant', content: 'Child', subagentRunId: 'w' },
        {
          id: 'child-reasoning',
          role: 'reasoning',
          content: 'Child plan',
          subagentRunId: 'w',
        } as Records[number],
        {
          id: 'activity',
          role: 'activity',
          activityType: 'progress',
          content: { step: 1 },
        },
        { id: 'a', role: 'assistant', content: 'Answer' },
      ])
    );
    expect(messages.map((message) => [message.id, message.content])).toEqual([
      ['parts', 'First\nSecond'],
      ['a', 'Answer'],
    ]);
    expect(messages[1]).not.toHaveProperty('reasoning');
  });

  it('streams only the message built from the last root record while running', () => {
    const phases = (messages: Records, extra: Partial<Observation>) =>
      projectMessages(observed(messages, extra)).map((message) =>
        message.delivery.phase === 'complete'
          ? message.delivery.outcome
          : 'streaming'
      );
    expect(phases(turn, { status: 'running' })).toEqual([
      'success',
      'success',
      'success',
      'streaming',
    ]);
    // A tool result after the step means that step has finished.
    expect(phases(turn.slice(0, 5), { status: 'running' })).toEqual([
      'success',
      'success',
      'success',
    ]);
    // A step that is still calling its tool is the one streaming.
    expect(phases(turn.slice(0, 4), { status: 'running' })).toEqual([
      'success',
      'streaming',
    ]);
    // Activity and child records after it do not end the step.
    expect(
      phases(
        [
          ...turn,
          {
            id: 'activity',
            role: 'activity',
            activityType: 'progress',
            content: {},
          },
        ],
        { status: 'running' }
      ).at(-1)
    ).toBe('streaming');
    expect(
      phases(turn, { run: { id: 'run', outcome: 'aborted' } })
    ).toEqual(['success', 'success', 'success', 'aborted']);
    // A tool record after the last step does not take the outcome from it.
    expect(
      phases(turn.slice(0, 5), { run: { id: 'run', outcome: 'interrupted' } })
    ).toEqual(['success', 'interrupted', 'success']);
    // The outcome belongs to the latest turn, not to an earlier answer.
    expect(
      phases([...turn, { id: 'u2', role: 'user', content: 'Again' }], {
        run: { id: 'run', outcome: 'error' },
      })
    ).toEqual(['success', 'success', 'success', 'success', 'success']);
  });

  it('keeps unchanged messages and an unchanged list', () => {
    const first = projectMessages(observed(turn, { status: 'running' }));
    expect(projectMessages(observed(turn, { status: 'running' }), first)).toBe(
      first
    );
    const done = projectMessages(observed(turn), first);
    expect(done).not.toBe(first);
    expect(done[0]).toBe(first[0]);
    expect(done[1]).toBe(first[1]);
    expect(done[2]).toBe(first[2]);
    expect(done[3]).not.toBe(first[3]);
    expect(projectMessages(observed([]))).toEqual([]);
  });
});

describe('projectToolCalls', () => {
  const call = (id: string, name: string, args: string) => ({
    id,
    type: 'function' as const,
    function: { name, arguments: args },
  });
  const step = (...calls: ReturnType<typeof call>[]): Records => [
    { id: 'u', role: 'user', content: 'Ask' },
    { id: 'a', role: 'assistant', toolCalls: calls },
  ];

  it('completes a call from its tool record and links it to both messages', () => {
    const snapshot = observed([
      ...step(call('c1', 'search', '{"q":"tea"}'), call('c2', 'clock', '')),
      { id: 't1', role: 'tool', toolCallId: 'c1', content: '{"hits":2}' },
      { id: 't2', role: 'tool', toolCallId: 'c2', content: 'Noon' },
    ]);
    const calls = projectToolCalls(snapshot);
    expect(calls).toEqual([
      {
        id: 'c1',
        name: 'search',
        args: { q: 'tea' },
        status: 'complete',
        result: { hits: 2 },
      },
      {
        id: 'c2',
        name: 'clock',
        args: undefined,
        status: 'complete',
        result: 'Noon',
      },
    ]);
    expect(Object.isFrozen(calls)).toBe(true);
    expect(Object.isFrozen(calls[0])).toBe(true);
    expect(Object.isFrozen(calls[0].args)).toBe(true);
    const messages = projectMessages(snapshot);
    expect(
      messages.map(({ id, role, content, toolCallId, toolCallIds }) => ({
        id,
        role,
        content,
        toolCallId,
        toolCallIds,
      }))
    ).toEqual([
      { id: 'u', role: 'user', content: 'Ask' },
      { id: 'a', role: 'assistant', content: '', toolCallIds: ['c1', 'c2'] },
      { id: 't1', role: 'tool', content: '{"hits":2}', toolCallId: 'c1' },
      { id: 't2', role: 'tool', content: 'Noon', toolCallId: 'c2' },
    ]);
    expect(Object.isFrozen(messages[1].toolCallIds)).toBe(true);
  });

  it('reports a failed tool record and final arguments that are not JSON as errors', () => {
    expect(
      projectToolCalls(
        observed([
          ...step(call('c1', 'search', '{}'), call('c2', 'clock', '{"zone"')),
          {
            id: 't1',
            role: 'tool',
            toolCallId: 'c1',
            content: 'partial',
            error: 'Timed out',
          },
        ])
      )
    ).toEqual([
      { id: 'c1', name: 'search', args: {}, status: 'error', error: 'Timed out' },
      {
        id: 'c2',
        name: 'clock',
        args: undefined,
        status: 'error',
        error: 'Invalid JSON arguments',
      },
    ]);
  });

  it('withholds a call while its arguments may still be arriving', () => {
    const shown = (records: Records, status: 'running' | 'idle' = 'running') => {
      const snapshot = observed(records, { status });
      const calls = projectToolCalls(snapshot);
      // The messages never name a call the tool calls leave out.
      expect(
        projectMessages(snapshot).flatMap((message) => message.toolCallIds ?? [])
      ).toEqual(calls.map((item) => item.id));
      return calls.map((item) => [item.id, item.status]);
    };
    // Half an argument object, and empty arguments that may be about to start.
    expect(shown(step(call('c1', 'search', '{"q":"te')))).toEqual([]);
    expect(shown(step(call('c1', 'clock', '')))).toEqual([]);
    // A scalar could still grow; an object that parses cannot.
    expect(shown(step(call('c1', 'count', '1')))).toEqual([]);
    expect(shown(step(call('c1', 'search', '{"q":"tea"}')))).toEqual([
      ['c1', 'running'],
    ]);
    // A later call, a later record or a result means the earlier one ended.
    expect(
      shown(step(call('c1', 'clock', ''), call('c2', 'search', '{"q')))
    ).toEqual([['c1', 'running']]);
    expect(
      shown([
        ...step(call('c1', 'clock', '')),
        { id: 'a2', role: 'assistant', content: 'Checking' },
      ])
    ).toEqual([['c1', 'running']]);
    expect(
      shown([
        ...step(call('c1', 'clock', '')),
        { id: 't', role: 'tool', toolCallId: 'c1', content: 'Noon' },
      ])
    ).toEqual([['c1', 'complete']]);
    // Child and activity records after the call say nothing about it.
    expect(
      shown([
        ...step(call('c1', 'clock', '')),
        { id: 'child', role: 'assistant', content: 'Child', subagentRunId: 'w' },
      ])
    ).toEqual([]);
    // Once the session stops, a call without a result is waiting.
    expect(shown(step(call('c1', 'clock', '')), 'idle')).toEqual([
      ['c1', 'pending'],
    ]);
  });

  it('leaves out calls owned by a child record', () => {
    const snapshot = observed([
      { id: 'u', role: 'user', content: 'Ask' },
      {
        id: 'child',
        role: 'assistant',
        subagentRunId: 'w',
        toolCalls: [call('c1', 'search', '{}')],
      },
      {
        id: 'child-result',
        role: 'tool',
        toolCallId: 'c1',
        content: 'Hit',
        subagentRunId: 'w',
      } as Records[number],
    ]);
    expect(projectToolCalls(snapshot)).toEqual([]);
    expect(projectMessages(snapshot).map((message) => message.id)).toEqual([
      'u',
    ]);
  });

  it('keeps unchanged calls and an unchanged list', () => {
    const records = step(
      call('c1', 'search', '{"q":"tea"}'),
      call('c2', 'clock', '{}')
    );
    const waiting = observed(records, { status: 'running' });
    const first = projectToolCalls(waiting);
    expect(projectToolCalls(waiting, first)).toBe(first);
    const answered = Object.freeze({
      ...waiting,
      transcript: Object.freeze([
        ...waiting.transcript,
        Object.freeze({
          id: 't',
          role: 'tool' as const,
          toolCallId: 'c2',
          content: 'Noon',
        }),
      ]),
    });
    const next = projectToolCalls(answered, first);
    expect(next[0]).toBe(first[0]);
    expect(next[1]).toMatchObject({ status: 'complete', result: 'Noon' });
    // Stopping changes a call that is still waiting, not one that finished.
    const stopped = projectToolCalls({ ...answered, status: 'idle' }, next);
    expect(stopped[0]).toMatchObject({ status: 'pending' });
    expect(stopped[1]).toBe(next[1]);
    expect(projectToolCalls(observed([]))).toEqual([]);
  });
});

describe('tool calls through the session', () => {
  it('shows a streamed call when its arguments close and completes it with the result', async () => {
    const fixture = bindingFixture();
    const calls = () => projectToolCalls(fixture.session.getSnapshot());
    const owner = () =>
      fixture.session
        .getSnapshot()
        .transcript.find((record) => record.id === 'a1');
    const args = () =>
      owner()?.role === 'assistant'
        ? (owner() as { toolCalls?: { function: { arguments: string } }[] })
            .toolCalls?.[0]?.function.arguments
        : undefined;
    try {
      const run = fixture.session.submit('Go');
      const exchange = await fixture.started();
      exchange.emit({
        type: 'TOOL_CALL_START',
        toolCallId: 'c1',
        toolCallName: 'search',
        parentMessageId: 'a1',
      });
      exchange.emit({ type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{"q":' });
      await fixture.changed(() => args() === '{"q":');
      expect(calls()).toEqual([]);
      expect(projectMessages(fixture.session.getSnapshot())).toHaveLength(1);
      exchange.emit({ type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '"tea"}' });
      await fixture.changed(() => args() === '{"q":"tea"}');
      expect(calls()).toEqual([
        { id: 'c1', name: 'search', args: { q: 'tea' }, status: 'running' },
      ]);
      expect(projectMessages(fixture.session.getSnapshot()).at(-1)).toEqual({
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCallIds: ['c1'],
        delivery: { generation: 'a1', phase: 'streaming' },
      });
      exchange.emit({ type: 'TOOL_CALL_END', toolCallId: 'c1' });
      exchange.emit({
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'c1',
        messageId: 't1',
        content: '{"hits":2}',
      });
      await fixture.changed((snapshot) =>
        snapshot.transcript.some((record) => record.id === 't1')
      );
      expect(calls()).toEqual([
        {
          id: 'c1',
          name: 'search',
          args: { q: 'tea' },
          status: 'complete',
          result: { hits: 2 },
        },
      ]);
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
      });
      expect(await run).toBe('success');
      expect(
        projectMessages(fixture.session.getSnapshot()).map((message) => [
          message.role,
          message.delivery.phase,
        ])
      ).toEqual([
        ['user', 'complete'],
        ['assistant', 'complete'],
        ['tool', 'complete'],
      ]);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('reasoning clock', () => {
  const event = (type: string, messageId: string, extra = {}) =>
    ({ type, messageId, ...extra } as unknown as AGUIEvent);
  it('measures root reasoning from its start event to its end event', () => {
    let at = 1_000;
    const clock = createReasoningClock(() => at);
    const base = observed([]);
    expect(clock.observe(event('REASONING_MESSAGE_START', 'r'), base)).toBe(
      base
    );
    expect(clock.observe(event('TEXT_MESSAGE_END', 'r'), base)).toBe(base);
    at = 3_500;
    const ended = clock.observe(event('REASONING_MESSAGE_END', 'r'), base);
    expect(ended.reasoningDurations).toEqual({ r: 2_500 });
    expect(Object.isFrozen(ended.reasoningDurations)).toBe(true);
    // A second end, an end without a start and child reasoning add nothing.
    expect(clock.observe(event('REASONING_MESSAGE_END', 'r'), ended)).toBe(
      ended
    );
    expect(clock.observe(event('REASONING_MESSAGE_END', 'x'), ended)).toBe(
      ended
    );
    const child = { subagentRunId: 'worker' };
    clock.observe(event('REASONING_MESSAGE_START', 'c', child), ended);
    expect(
      clock.observe(event('REASONING_MESSAGE_END', 'c', child), ended)
    ).toBe(ended);
    at = 100;
    clock.observe(event('REASONING_MESSAGE_START', 'back'), ended);
    at = 50;
    expect(
      clock.observe(event('REASONING_MESSAGE_END', 'back'), ended)
        .reasoningDurations
    ).toEqual({ r: 2_500, back: 0 });
  });
});

describe('reasoning through the session', () => {
  afterEach(() => vi.restoreAllMocks());

  it('times reasoning, attaches it to the answer and keeps it across runs', async () => {
    const clock = vi.spyOn(Date, 'now');
    const fixture = bindingFixture();
    const view = () => projectMessages(fixture.session.getSnapshot());
    const reasoning = (id: string) =>
      fixture.session
        .getSnapshot()
        .transcript.find((record) => record.id === id);
    try {
      clock.mockReturnValue(10_000);
      const run = fixture.session.submit('Go');
      const exchange = await fixture.started();
      exchange.emit({
        type: 'REASONING_MESSAGE_START',
        messageId: 'r1',
        role: 'reasoning',
      });
      exchange.emit({
        type: 'REASONING_MESSAGE_CONTENT',
        messageId: 'r1',
        delta: 'Plan',
      });
      await fixture.changed(() => reasoning('r1')?.content === 'Plan');
      expect(view().at(-1)).toEqual({
        id: 'r1',
        role: 'assistant',
        content: '',
        reasoning: 'Plan',
        delivery: { generation: 'r1', phase: 'streaming' },
      });
      clock.mockReturnValue(12_500);
      exchange.emit({ type: 'REASONING_MESSAGE_END', messageId: 'r1' });
      await fixture.changed(
        (snapshot) => snapshot.reasoningDurations?.['r1'] !== undefined
      );
      clock.mockReturnValue(20_000);
      exchange.emit({
        type: 'TEXT_MESSAGE_START',
        messageId: 'a1',
        role: 'assistant',
      });
      exchange.emit({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'a1',
        delta: 'Answer',
      });
      await fixture.changed(() => reasoning('a1')?.content === 'Answer');
      expect(view().at(-1)).toEqual({
        id: 'a1',
        role: 'assistant',
        content: 'Answer',
        reasoning: 'Plan',
        reasoningDurationMs: 2_500,
        delivery: { generation: 'a1', phase: 'streaming' },
      });
      exchange.emit({ type: 'TEXT_MESSAGE_END', messageId: 'a1' });
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
      });
      expect(await run).toBe('success');
      const finished = view();
      expect(finished.at(-1)).toMatchObject({
        id: 'a1',
        reasoningDurationMs: 2_500,
        delivery: { phase: 'complete', outcome: 'success' },
      });
      // The reasoning record is still sent back as history, untouched.
      const again = fixture.session.submit('Again');
      const second = await fixture.started(1);
      expect(second.body.messages.map((message) => message.id)).toEqual([
        exchange.body.messages[0].id,
        'r1',
        'a1',
        second.body.messages.at(-1)?.id,
      ]);
      expect(fixture.session.getSnapshot().reasoningDurations).toEqual({
        r1: 2_500,
      });
      expect(view().slice(0, 2)).toEqual(finished.slice(0, 2));
      await fixture.session.stop();
      expect(await again).toBe('aborted');
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('citations from application state', () => {
  const answered: Records = [
    { id: 'u', role: 'user', content: 'Ask' },
    { id: 'a', role: 'assistant', content: 'Signals are reactive.[^doc]' },
  ];
  const withState = (state: unknown, records: Records = answered) =>
    Object.freeze({ ...initialObservation(records, state) });

  it('attaches the sources listed for an assistant message as core citations', () => {
    const snapshot = withState({
      citations: {
        a: [
          { id: 'doc', index: 4, title: 'Signals', url: 'https://x.test/s', snippet: 'Text', extra: { rank: 1 } },
          { refId: 'other', name: 'Named', href: 'https://x.test/n', excerpt: 'Part', publishedAt: 2024, ignored: true },
          'https://x.test/plain',
          { content: 'Only a snippet', index: 'two', publishedAt: {} },
        ],
        u: [{ id: 'on-user' }],
      },
    });
    const messages = projectMessages(snapshot);
    expect(messages[1].citations).toEqual([
      { id: 'doc', index: 4, title: 'Signals', url: 'https://x.test/s', snippet: 'Text', extra: { rank: 1 } },
      { id: 'other', index: 2, title: 'Named', url: 'https://x.test/n', snippet: 'Part', publishedAt: 2024 },
      { id: 'c3', index: 3, url: 'https://x.test/plain' },
      { id: 'c4', index: 4, snippet: 'Only a snippet' },
    ]);
    expect(Object.isFrozen(messages[1].citations)).toBe(true);
    expect(Object.isFrozen(messages[1].citations?.[0].extra)).toBe(true);
    expect('citations' in messages[0]).toBe(false);
  });

  it('adds nothing for an empty, missing or malformed listing', () => {
    for (const state of [
      {},
      null,
      { citations: null },
      { citations: [] },
      { citations: { a: [] } },
      { citations: { a: 'https://x.test' } },
      { citations: { other: [{ id: 'x' }] } },
      { citations: { constructor: [{ id: 'x' }] } },
    ]) {
      const [, assistant] = projectMessages(withState(state));
      expect('citations' in assistant).toBe(false);
    }
  });

  it('keeps the message when the list is unchanged or replaced by an equal one', () => {
    const first = withState({ citations: { a: [{ id: 'doc', title: 'Signals' }] } });
    const before = projectMessages(first);
    const sameList = Object.freeze({ ...first, status: 'idle' as const });
    expect(projectMessages(sameList, before)).toBe(before);
    const equal = withState({ citations: { a: [{ id: 'doc', title: 'Signals' }] }, model: 'small' });
    expect(projectMessages(equal, before)).toBe(before);
    const changed = withState({ citations: { a: [{ id: 'doc', title: 'Signals 2' }] } });
    const after = projectMessages(changed, before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1].citations?.[0].title).toBe('Signals 2');
    const removed = projectMessages(withState({}), after);
    expect('citations' in removed[1]).toBe(false);
  });

  it('follows a state delta from a real session to the saved message', async () => {
    const fixture = bindingFixture();
    const view = () => projectMessages(fixture.session.getSnapshot());
    try {
      const run = fixture.session.submit('Go');
      const exchange = await fixture.started();
      exchange.emit({ type: 'TEXT_MESSAGE_START', messageId: 'stream', role: 'assistant' });
      exchange.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'stream', delta: 'Cited.[^doc]' });
      exchange.emit({ type: 'TEXT_MESSAGE_END', messageId: 'stream' });
      exchange.emit({
        type: 'STATE_DELTA',
        delta: [{ op: 'add', path: '/citations', value: { saved: [{ id: 'doc', title: 'Doc' }] } }],
      });
      await fixture.changed(
        (snapshot) => 'citations' in ((snapshot.state ?? {}) as object)
      );
      // The listing is keyed by the saved identifier, which the stream has not used yet.
      expect('citations' in view().at(-1)!).toBe(false);
      exchange.emit({
        type: 'MESSAGES_SNAPSHOT',
        messages: [
          { ...exchange.body.messages[0] },
          { id: 'saved', role: 'assistant', content: 'Cited.[^doc]' },
        ],
      });
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
      });
      expect(await run).toBe('success');
      expect(view().at(-1)).toMatchObject({
        id: 'saved',
        citations: [{ id: 'doc', index: 1, title: 'Doc' }],
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
