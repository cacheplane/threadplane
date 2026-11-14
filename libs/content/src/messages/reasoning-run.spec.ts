import { describe, expect, it } from 'vitest';
import {
  completeDelivery,
  streamingDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMessageContent } from './index.js';

const message = (id: string, extra: Partial<Message> = {}): Message =>
  Object.freeze({
    id,
    role: 'assistant',
    content: '',
    delivery: completeDelivery(id, 'success'),
    ...extra,
  }) as Message;
const tool = (id: string) => message(id, { role: 'tool', content: 'result' });
const snapshot = (messages: readonly Message[]): AgentSnapshot =>
  Object.freeze({
    status: 'idle',
    messages: Object.freeze([...messages]),
    toolCalls: Object.freeze([]),
  }) as AgentSnapshot;

describe('reasoning runs', () => {
  it('gives a single reasoning step a run that borrows its own document', () => {
    const content = createMessageContent();
    const [row, plain] = content.project(
      snapshot([
        message('a', { reasoning: 'Why', reasoningDurationMs: 1200 }),
        message('b', { content: 'Answer' }),
      ])
    );
    expect(row.reasoningRun).toEqual({
      snapshot: row.reasoning,
      steps: 1,
      durationMs: 1200,
    });
    expect(row.reasoningRun?.snapshot).toBe(row.reasoning);
    expect(plain.reasoningRun).toBeUndefined();
    content.dispose();
  });

  it('joins the steps of one turn across tool messages onto the first step', () => {
    const content = createMessageContent();
    const rows = content.project(
      snapshot([
        message('u', { role: 'user', content: 'Ask' }),
        message('a', { reasoning: 'Plan', reasoningDurationMs: 1000 }),
        tool('t1'),
        message('b', { reasoning: 'Check' }),
        tool('t2'),
        message('c', { reasoning: 'Conclude', reasoningDurationMs: 2500 }),
        message('d', { content: 'Answer' }),
      ])
    );
    const run = rows[1].reasoningRun;
    expect(run?.steps).toBe(3);
    expect(run?.durationMs).toBe(3500);
    expect(run?.snapshot.document).toEqual({
      generation: 'a:reasoning-run',
      phase: 'complete',
      content: 'Plan\n\nCheck\n\nConclude',
    });
    // Every step keeps its own reasoning; only the first carries the run.
    expect(rows.map((row) => row.reasoning?.document.content)).toEqual([
      undefined,
      'Plan',
      undefined,
      'Check',
      undefined,
      'Conclude',
      undefined,
    ]);
    expect(rows.filter((row) => row.reasoningRun)).toHaveLength(1);
    content.dispose();
  });

  it('ends a run at a user message or an assistant step without reasoning', () => {
    const content = createMessageContent();
    const rows = content.project(
      snapshot([
        message('a', { reasoning: 'One' }),
        message('b', { content: 'Answer' }),
        message('c', { reasoning: 'Two' }),
        message('u', { role: 'user', content: 'Again' }),
        message('d', { reasoning: 'Three' }),
      ])
    );
    expect(rows.map((row) => row.reasoningRun?.steps)).toEqual([
      1,
      undefined,
      1,
      undefined,
      1,
    ]);
    expect(rows[0].reasoningRun?.durationMs).toBeUndefined();
    expect('durationMs' in (rows[0].reasoningRun ?? {})).toBe(false);
    content.dispose();
  });

  it('extends the same document as steps arrive and follows the last step phase', () => {
    const content = createMessageContent();
    const first = message('a', { reasoning: 'Plan' });
    const one = content.project(snapshot([first]));
    const streaming = message('b', {
      reasoning: 'Che',
      delivery: streamingDelivery('b'),
    });
    const two = content.project(snapshot([first, tool('t'), streaming]));
    expect(two[0].reasoningRun?.steps).toBe(2);
    expect(two[0].reasoningRun?.snapshot.document).toEqual({
      generation: 'a:reasoning-run',
      phase: 'streaming',
      content: 'Plan\n\nChe',
    });
    expect(two[0]).not.toBe(one[0]);
    expect(two[0].reasoning).toBe(one[0].reasoning);
    const done = message('b', { reasoning: 'Check' });
    const three = content.project(snapshot([first, tool('t'), done]));
    expect(three[0].reasoningRun?.snapshot.document).toEqual({
      generation: 'a:reasoning-run',
      phase: 'complete',
      content: 'Plan\n\nCheck',
    });
    content.dispose();
  });

  it('keeps row and run identity when nothing in the run changed', () => {
    const content = createMessageContent();
    const a = message('a', { reasoning: 'Plan' });
    const b = message('b', { reasoning: 'Check' });
    const before = content.project(snapshot([a, b]));
    const after = content.project(
      snapshot([a, b, message('c', { role: 'user', content: 'Next' })])
    );
    expect(after[0]).toBe(before[0]);
    expect(after[0].reasoningRun).toBe(before[0].reasoningRun);
    content.dispose();
  });

  it('returns to the step document when a run shrinks to one step', () => {
    const content = createMessageContent();
    const a = message('a', { reasoning: 'Plan' });
    content.project(snapshot([a, message('b', { reasoning: 'Check' })]));
    const [row] = content.project(snapshot([a]));
    expect(row.reasoningRun?.steps).toBe(1);
    expect(row.reasoningRun?.snapshot).toBe(row.reasoning);
    content.dispose();
  });

  it('ignores reasoning on other roles and durations that are not finite numbers', () => {
    const content = createMessageContent();
    const rows = content.project(
      snapshot([
        message('u', { role: 'user', content: 'Ask', reasoning: 'Hidden' }),
        message('a', { reasoning: 'Plan', reasoningDurationMs: Number.NaN }),
        message('b', { reasoning: 'Check', reasoningDurationMs: 400 }),
      ])
    );
    expect(rows[0].reasoningRun).toBeUndefined();
    expect(rows[1].reasoningRun?.durationMs).toBe(400);
    content.dispose();
  });
});
