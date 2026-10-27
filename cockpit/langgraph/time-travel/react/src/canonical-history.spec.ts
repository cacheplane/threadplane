import { expect, it } from 'vitest';
import type { Message } from '@threadplane/core';
import { captureTurn, confirmCanonicalHistory } from './canonical-history';

const message = (
  id: string,
  role: Message['role'],
  generation = id
): Message => ({
  id,
  role,
  content: id,
  delivery: { generation, phase: 'complete', outcome: 'success' },
});
const a = [message('human-A', 'user'), message('answer-A', 'assistant')];
const b = [message('human-B', 'user'), message('answer-B', 'assistant')];
const human = message('human-C', 'user', 'generation-C');
const answer = message('answer-C', 'assistant', 'generation-C');
const values = (ids = [...a, human, answer].map((row) => row.id)) => ({
  completed_turn_id: human.id,
  completed_answer_id: answer.id,
  completed_message_ids: ids,
});

it('captures the SDK-adopted static source prefix instead of the preceding later tip', () => {
  const turn = captureTurn(
    [...a, human],
    new Set([...a, ...b].map((row) => row.delivery.generation)),
    true,
    [...a, ...b]
  )!;
  expect(turn.prefix.map((row) => row.id)).toEqual(a.map((row) => row.id));
  expect(
    confirmCanonicalHistory(
      [
        ...a,
        human,
        message('transient-chunk', 'assistant', 'generation-C'),
        answer,
      ],
      values(),
      turn
    )?.map((row) => row.id)
  ).toEqual(['human-A', 'answer-A', 'human-C', 'answer-C']);
});

it('ordinary Send uses only the preceding confirmed canonical prefix', () => {
  const turn = captureTurn(
    [...a, message('old-chunk', 'assistant'), human],
    new Set(a.map((row) => row.delivery.generation)),
    false,
    a
  )!;
  expect(
    confirmCanonicalHistory([...a, human, answer], values(), turn)?.map(
      (row) => row.id
    )
  ).toEqual(['human-A', 'answer-A', 'human-C', 'answer-C']);
});

it.each([
  [human.id, answer.id],
  [a[1].id, a[0].id, human.id, answer.id],
  [a[0].id, a[1].id, 'extra', human.id, answer.id],
  [a[0].id, a[0].id, human.id, answer.id],
])(
  'a valid current pair cannot authorize an incomplete or changed canonical prefix: %j',
  (...ids) => {
    const turn = captureTurn([...a, human], new Set(), true, b)!;
    expect(
      confirmCanonicalHistory([...a, human, answer], values(ids), turn)
    ).toBeUndefined();
  }
);

it('rejects inherited final bindings and mismatched current generations', () => {
  const turn = captureTurn([...a, human], new Set(), true, [])!;
  expect(
    confirmCanonicalHistory(
      [...a, human, answer],
      Object.create(values()),
      turn
    )
  ).toBeUndefined();
  expect(
    confirmCanonicalHistory(
      [
        ...a,
        human,
        { ...answer, delivery: { ...answer.delivery, generation: 'old' } },
      ],
      values(),
      turn
    )
  ).toBeUndefined();
});

it('rejects duplicate exact rows and all tool references', () => {
  const turn = captureTurn([...a, human], new Set(), true, [])!;
  expect(
    confirmCanonicalHistory([...a, human, answer, answer], values(), turn)
  ).toBeUndefined();
  expect(
    confirmCanonicalHistory(
      [...a, human, { ...answer, toolCallId: 'unexpected' }],
      values(),
      turn
    )
  ).toBeUndefined();
});

it('requires a newly admitted human and coherent static completed source rows', () => {
  expect(
    captureTurn([...a, human], new Set(['generation-C']), true, [])
  ).toBeUndefined();
  expect(
    captureTurn([...a, { ...human, role: 'assistant' }], new Set(), true, [])
  ).toBeUndefined();
  expect(
    captureTurn(
      [
        {
          ...a[0],
          delivery: {
            generation: 'prior-live',
            phase: 'complete',
            outcome: 'success',
          },
        },
        a[1],
        human,
      ],
      new Set(),
      true,
      []
    )
  ).toBeUndefined();
  expect(
    captureTurn([...a, { ...a[0] }, human], new Set(), true, [])
  ).toBeUndefined();
});

it('continued fork preserves the entire confirmed fork prefix', () => {
  const prefix = [...a, human, answer];
  const d = message('human-D', 'user', 'generation-D'),
    final = message('answer-D', 'assistant', 'generation-D');
  const turn = captureTurn(
    [...prefix, d],
    new Set(prefix.map((row) => row.delivery.generation)),
    false,
    prefix
  )!;
  const ids = [...prefix, d, final].map((row) => row.id);
  expect(
    confirmCanonicalHistory(
      [...prefix, d, final],
      {
        completed_turn_id: d.id,
        completed_answer_id: final.id,
        completed_message_ids: ids,
      },
      turn
    )?.map((row) => row.id)
  ).toEqual(ids);
});

it('reentrant final metadata getters cannot publish an obsolete canonical result', () => {
  const turn = captureTurn([...a, human], new Set(), true, [])!;
  let valid = true;
  const metadata = {
    ...values(),
    get completed_message_ids() {
      valid = false;
      return values().completed_message_ids;
    },
  };
  expect(
    confirmCanonicalHistory([...a, human, answer], metadata, turn, () => valid)
  ).toBeUndefined();
});
