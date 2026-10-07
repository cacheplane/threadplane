import type { Message } from '@threadplane/core';
import { describe, expect, it } from 'vitest';
import { captureTurn, confirmCanonicalHistory } from './authority';
const msg = (
  id: string,
  role: 'user' | 'assistant',
  content: string,
  generation = id
): Message => ({
  id,
  role,
  content,
  delivery: { generation, phase: 'complete', outcome: 'success' },
});
const prefix = () => [
  msg('p', 'user', 'old input'),
  msg('q', 'assistant', 'old answer'),
];
const pair = () => [
  msg('h', 'user', ' literal ', 'g'),
  msg('a', 'assistant', 'new answer', 'g'),
];
const turn = () => captureTurn(pair(), new Set(), prefix(), ' literal ')!;
const values = () => ({
  completed_turn_id: 'h',
  completed_answer_id: 'a',
  completed_message_ids: ['p', 'q', 'h', 'a'],
});
describe('turn admission', () => {
  it('captures independent prefix and submitted literal input', () => {
    expect(turn()).toMatchObject({
      id: 'h',
      generation: 'g',
      input: ' literal ',
      prefix: prefix(),
    });
  });
  it('rejects old generation, wrong input, duplicate and invalid delivery', () => {
    expect(
      captureTurn(pair(), new Set(['g']), prefix(), ' literal ')
    ).toBeUndefined();
    expect(captureTurn(pair(), new Set(), prefix(), 'literal')).toBeUndefined();
    expect(
      captureTurn([pair()[0], pair()[0]], new Set(), prefix(), ' literal ')
    ).toBeUndefined();
    expect(
      captureTurn(
        [{ ...pair()[0], delivery: { generation: 'g', phase: 'streaming' } }],
        new Set(),
        prefix(),
        ' literal '
      )
    ).toBeUndefined();
  });
});
describe('terminal canonical projection', () => {
  it('projects only proven IDs despite retained later-tip and transient messages', () => {
    const result = confirmCanonicalHistory(
      [
        ...prefix(),
        msg('later', 'assistant', 'tip'),
        ...pair(),
        msg('stream', 'assistant', 'temporary', 'g'),
      ],
      values(),
      turn()
    );
    expect(result?.map((m) => m.id)).toEqual(['p', 'q', 'h', 'a']);
    expect(Object.isFrozen(result?.[0])).toBe(true);
  });
  it.each([
    'missing',
    'content',
    'role',
    'duplicate',
    'delivery',
    'generation',
    'input',
  ])('rejects malformed actual messages: %s', (mode) => {
    const messages = [...prefix(), ...pair()];
    if (mode === 'missing') messages.shift();
    if (mode === 'content')
      messages[0] = { ...messages[0], content: 'changed' };
    if (mode === 'role') messages[0] = { ...messages[0], role: 'assistant' };
    if (mode === 'duplicate') messages.push(messages[0]);
    if (mode === 'delivery')
      messages[3] = {
        ...messages[3],
        delivery: { generation: 'g', phase: 'complete', outcome: 'error' },
      };
    if (mode === 'generation')
      messages[3] = {
        ...messages[3],
        delivery: {
          generation: 'stale',
          phase: 'complete',
          outcome: 'success',
        },
      };
    if (mode === 'input') messages[2] = { ...messages[2], content: 'literal' };
    expect(confirmCanonicalHistory(messages, values(), turn())).toBeUndefined();
  });
  it.each([
    { completed_turn_id: 'stale' },
    { completed_answer_id: 'q' },
    { completed_message_ids: ['h', 'a'] },
    { completed_message_ids: ['q', 'p', 'h', 'a'] },
    { completed_message_ids: ['p', 'q', 'h', 'a', 'later'] },
  ])('rejects stale or wrong final IDs %s', (patch) =>
    expect(
      confirmCanonicalHistory(
        [...prefix(), ...pair()],
        { ...values(), ...patch },
        turn()
      )
    ).toBeUndefined()
  );
  it('rejects accessor completion evidence without invoking it', () => {
    let reads = 0;
    expect(
      confirmCanonicalHistory(
        [...prefix(), ...pair()],
        {
          ...values(),
          get completed_turn_id() {
            reads++;
            return 'h';
          },
        },
        turn()
      )
    ).toBeUndefined();
    expect(reads).toBe(0);
  });
});
