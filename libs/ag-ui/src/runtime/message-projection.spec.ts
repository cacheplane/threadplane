import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AGUIEvent } from '@ag-ui/client';
import { projectMessages } from './message-projection';
import { createReasoningClock } from './reasoning-clock';
import {
  initialObservation,
  type SessionSnapshot,
} from './session-observation';
import { bindingFixture } from './testing/binding-fixture';

type Records = NonNullable<Parameters<typeof initialObservation>[0]>;
const observed = (
  messages: Records,
  extra: Partial<SessionSnapshot> = {}
): SessionSnapshot =>
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
        delivery: { generation: 'a1', phase: 'complete', outcome: 'success' },
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
    expect(projectMessages(observed(turn))[2]).not.toHaveProperty(
      'reasoningDurationMs'
    );
    expect(
      projectMessages(
        observed(turn, {
          reasoningDurations: { r3: 900, r2: Number.NaN, other: 5 },
        })
      ).map((message) => message.reasoningDurationMs)
    ).toEqual([undefined, undefined, 900]);
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
    const phases = (messages: Records, extra: Partial<SessionSnapshot>) =>
      projectMessages(observed(messages, extra)).map((message) =>
        message.delivery.phase === 'complete'
          ? message.delivery.outcome
          : 'streaming'
      );
    expect(phases(turn, { status: 'running' })).toEqual([
      'success',
      'success',
      'streaming',
    ]);
    // A tool result after the step means that step has finished.
    expect(phases(turn.slice(0, 5), { status: 'running' })).toEqual([
      'success',
      'success',
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
    ).toEqual(['success', 'success', 'aborted']);
    // The outcome belongs to the latest turn, not to an earlier answer.
    expect(
      phases([...turn, { id: 'u2', role: 'user', content: 'Again' }], {
        run: { id: 'run', outcome: 'error' },
      })
    ).toEqual(['success', 'success', 'success', 'success']);
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
    expect(done[2]).not.toBe(first[2]);
    expect(projectMessages(observed([]))).toEqual([]);
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
