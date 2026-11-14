import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completeDelivery,
  streamingDelivery,
  type Message,
} from '@threadplane/core';
import { createReasoningTimer } from './reasoning-timing';
import type { StreamEvent } from './transport.types';
import { controlledSession } from './testing/controlled-session';
import { saved } from './testing/checkpoint-fixture';

const step = (
  id: string,
  fields: Partial<Message> = {},
  done = false
): Message => ({
  id,
  role: 'assistant',
  content: '',
  delivery: done ? completeDelivery('g', 'success') : streamingDelivery('g'),
  ...fields,
});
function timer() {
  let at = 0;
  const reasoning = createReasoningTimer(() => at);
  return {
    observe: (time: number, messages: readonly Message[]) => {
      at = time;
      return reasoning.observe(messages);
    },
  };
}

describe('reasoning timer', () => {
  it('measures from the first reasoning to the first answer text', () => {
    const t = timer();
    const thinking = [step('a', { reasoning: 'Plan' })];
    expect(t.observe(1_000, thinking)).toBe(thinking);
    expect(t.observe(2_000, [step('a', { reasoning: 'Plan more' })])[0]).not.toHaveProperty(
      'reasoningDurationMs'
    );
    const answered = t.observe(3_500, [
      step('a', { reasoning: 'Plan more', content: 'A' }),
    ]);
    expect(answered[0].reasoningDurationMs).toBe(2_500);
    // Later text does not move the end.
    expect(
      t.observe(9_000, [
        step('a', { reasoning: 'Plan more', content: 'Answer' }, true),
      ])[0].reasoningDurationMs
    ).toBe(2_500);
  });

  it.each([
    ['a tool call', step('a', { reasoning: 'Plan', toolCallIds: ['call'] })],
    ['a completed delivery', step('a', { reasoning: 'Plan' }, true)],
  ])('ends a step without text at %s', (_name, ended) => {
    const t = timer();
    t.observe(1_000, [step('a', { reasoning: 'Plan' })]);
    expect(t.observe(1_800, [ended])[0].reasoningDurationMs).toBe(800);
  });

  it('leaves reasoning unmeasured when it was never seen arriving', () => {
    const t = timer();
    const whole = [
      step('saved', { reasoning: 'Saved', content: 'Answer' }, true),
      step('whole', { reasoning: 'Whole', content: 'Answer' }),
      step('plain', { content: 'Answer' }),
    ];
    expect(t.observe(1_000, whole)).toBe(whole);
    expect(t.observe(5_000, whole)).toBe(whole);
  });

  it('times each step of a turn on its own and ignores other roles', () => {
    const t = timer();
    const user: Message = {
      id: 'u',
      role: 'user',
      content: 'Go',
      reasoning: 'not a step',
      delivery: completeDelivery('g', 'success'),
    };
    t.observe(0, [user, step('a', { reasoning: 'One' })]);
    const first = step('a', { reasoning: 'One', toolCallIds: ['c'] }, true);
    t.observe(1_200, [user, first]);
    t.observe(2_000, [user, first, step('b', { reasoning: 'Two' })]);
    const done = t.observe(5_100, [
      user,
      first,
      step('b', { reasoning: 'Two', content: 'Answer' }),
    ]);
    expect(done.map((message) => message.reasoningDurationMs)).toEqual([
      undefined,
      1_200,
      3_100,
    ]);
    expect(done[0]).toBe(user);
  });

  it('follows an identifier replaced in place and drops the time with the reasoning', () => {
    const t = timer();
    t.observe(0, [step('provisional', { reasoning: 'Plan' })]);
    const renamed = t.observe(700, [
      step('final', { reasoning: 'Plan', content: 'A' }),
    ]);
    expect(renamed[0].reasoningDurationMs).toBe(700);
    const cleared = [step('final', { content: 'Answer' }, true)];
    expect(t.observe(900, cleared)).toBe(cleared);
    expect(
      t.observe(950, [
        step('final', { reasoning: 'Back', content: 'Answer' }, true),
      ])[0].reasoningDurationMs
    ).toBe(700);
  });

  it('never reports a negative time when the clock moves back', () => {
    const t = timer();
    t.observe(5_000, [step('a', { reasoning: 'Plan' })]);
    expect(
      t.observe(4_000, [step('a', { reasoning: 'Plan', content: 'A' })])[0]
        .reasoningDurationMs
    ).toBe(0);
  });
});

const ai = (id: string, reasoning?: string, content = '') => ({
  type: 'ai',
  id,
  content,
  reasoning,
});
const delta = (id: string, reasoning?: string, content = ''): StreamEvent => ({
  type: 'messages',
  messageMetadata: {},
  messages: [{ ...ai(id, reasoning, content), type: 'AIMessageChunk' }],
});
const frame = (...messages: unknown[]): StreamEvent => ({
  type: 'values',
  data: { messages },
});
const cleanups: (() => Promise<void>)[] = [];
function fixture() {
  const f = controlledSession();
  cleanups.push(() => f.session.dispose());
  const clock = vi.spyOn(Date, 'now');
  return {
    ...f,
    at: (time: number) => clock.mockReturnValue(time),
    last: () => f.session.getSnapshot().messages.at(-1)!,
  };
}
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.restoreAllMocks();
});

describe('reasoning time through the session', () => {
  it('publishes the measured time when the answer starts and keeps it after the run', async () => {
    const f = fixture();
    f.at(10_000);
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(delta('answer', 'Plan'));
    expect(f.last()).not.toHaveProperty('reasoningDurationMs');
    f.at(11_000);
    await f.emit(delta('answer', ' more'));
    f.at(12_500);
    await f.emit(delta('answer', undefined, 'The'));
    expect(f.last()).toMatchObject({
      reasoning: 'Plan more',
      reasoningDurationMs: 2_500,
      delivery: { phase: 'streaming' },
    });
    const streaming = f.last();
    f.at(20_000);
    await f.emit(frame(ai('answer', 'Plan more', 'The answer')));
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.last()).toMatchObject({
      content: 'The answer',
      reasoningDurationMs: 2_500,
      delivery: { phase: 'complete', outcome: 'success' },
    });
    expect(Object.isFrozen(f.last())).toBe(true);
    expect(streaming.reasoningDurationMs).toBe(2_500);
  });

  it('ends a step that never writes text when the run completes', async () => {
    const f = fixture();
    f.at(0);
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(delta('answer', 'Plan'));
    f.at(1_400);
    await f.emit(frame(ai('answer', 'Plan')));
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.last().reasoningDurationMs).toBe(1_400);
  });

  it('reports no time for saved reasoning or reasoning delivered with its answer', async () => {
    const f = fixture();
    f.at(0);
    f.getHistory.mockResolvedValueOnce([
      saved('history', [ai('old', 'Saved', 'Earlier')]),
    ]);
    await f.session.load!();
    expect(f.last()).not.toHaveProperty('reasoningDurationMs');
    const run = f.session.submit('Go');
    await f.started();
    f.at(3_000);
    await f.emit(delta('answer', 'Whole', 'Answer'));
    f.at(6_000);
    await f.emit(delta('answer', undefined, ' more'));
    f.streams[0].finish();
    await run;
    for (const message of f.session.getSnapshot().messages)
      expect(message).not.toHaveProperty('reasoningDurationMs');
  });

  it('removes the time when the final message carries no reasoning', async () => {
    const f = fixture();
    f.at(0);
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(delta('answer', 'Interim'));
    f.at(500);
    await f.emit(frame(ai('answer', undefined, 'Final')));
    expect(f.last().reasoningDurationMs).toBe(500);
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.last().reasoning).toBeUndefined();
    expect(f.last()).not.toHaveProperty('reasoningDurationMs');
  });
});
