import { expect, it } from 'vitest';
import type { Message } from '@threadplane/core';
import { captureTurn, confirmCanonicalHistory } from './canonical-history';

async function subject() {
  return { captureTurn, confirmCanonicalHistory };
}
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
const prefix = [message('human-A', 'user'), message('answer-A', 'assistant')];
const human = message('human-B', 'user', 'turn-B');
const answer = message('answer-B', 'assistant', 'turn-B');
const rows = [...prefix, human, answer];
const values = (ids: unknown = rows.map((row) => row.id)) => ({
  completed_turn_id: human.id,
  completed_answer_id: answer.id,
  completed_message_ids: ids,
});
const prior = new Set(prefix.map((row) => row.delivery.generation));

it('captures only the confirmed prefix and excludes transient aliases from the exact final history', async () => {
  const { captureTurn, confirmCanonicalHistory } = await subject();
  const turn = captureTurn(
    [...prefix, message('old-chunk', 'assistant'), human],
    prior,
    prefix
  );
  expect(turn).toMatchObject({ id: human.id, generation: 'turn-B', prefix });
  expect(
    confirmCanonicalHistory(
      [...rows, message('chunk-B', 'assistant', 'turn-B')],
      values(),
      turn
    )
  ).toEqual(rows);
});
it('confirms the first current pair with an empty previous canonical prefix', async () => {
  const { captureTurn, confirmCanonicalHistory } = await subject();
  const turn = captureTurn([human], new Set(), []);
  expect(
    confirmCanonicalHistory(
      [human, answer],
      values([human.id, answer.id]),
      turn
    )
  ).toEqual([human, answer]);
});
it.each(
  [
    [human.id, answer.id],
    [prefix[1].id, prefix[0].id, human.id, answer.id],
    [prefix[0].id, prefix[1].id, 'extra', human.id, answer.id],
    [prefix[0].id, prefix[0].id, human.id, answer.id],
    null,
    'not-an-array',
  ].map((ids) => ({ ids }))
)(
  'rejects missing, changed or malformed canonical history: %j',
  async ({ ids }) => {
    const { captureTurn, confirmCanonicalHistory } = await subject();
    const turn = captureTurn([...prefix, human], prior, prefix);
    expect(confirmCanonicalHistory(rows, values(ids), turn)).toBeUndefined();
  }
);
it.each([
  { completed_turn_id: 'old-human' },
  { completed_answer_id: '' },
  { completed_answer_id: human.id },
  { completed_answer_id: 'other-answer' },
])('rejects a stale or invalid final current pair: %j', async (change) => {
  const { captureTurn, confirmCanonicalHistory } = await subject();
  const turn = captureTurn([...prefix, human], prior, prefix);
  expect(
    confirmCanonicalHistory(rows, { ...values(), ...change }, turn)
  ).toBeUndefined();
});
it.each([
  { role: 'tool' as const },
  { toolCallId: '' },
  { toolCallId: 'unbound' },
  { toolCallIds: ['unbound'] },
  { delivery: { ...answer.delivery, generation: 'old' } },
  { delivery: { ...answer.delivery, outcome: 'interrupted' as const } },
  { delivery: { ...answer.delivery, phase: 'streaming' as const } },
])(
  'rejects unsafe or mismatched final canonical delivery: %j',
  async (change) => {
    const { captureTurn, confirmCanonicalHistory } = await subject();
    const turn = captureTurn([...prefix, human], prior, prefix);
    expect(
      confirmCanonicalHistory(
        [...prefix, human, { ...answer, ...change }],
        values(),
        turn
      )
    ).toBeUndefined();
  }
);
it('rejects duplicate exact rows and inherited metadata', async () => {
  const { captureTurn, confirmCanonicalHistory } = await subject();
  const turn = captureTurn([...prefix, human], prior, prefix);
  expect(
    confirmCanonicalHistory([...rows, answer], values(), turn)
  ).toBeUndefined();
  expect(
    confirmCanonicalHistory(rows, Object.create(values()), turn)
  ).toBeUndefined();
});
it('requires a fresh human and a unique safe confirmed prefix', async () => {
  const { captureTurn } = await subject();
  expect(
    captureTurn([...prefix, human], new Set(['turn-B']), prefix)
  ).toBeUndefined();
  expect(captureTurn([...prefix, answer], prior, prefix)).toBeUndefined();
  expect(
    captureTurn([...prefix, human], prior, [...prefix, prefix[0]])
  ).toBeUndefined();
  expect(
    captureTurn([...prefix, human], prior, [
      { ...prefix[0], toolCallId: '' },
      prefix[1],
    ])
  ).toBeUndefined();
});
it('preserves the full confirmed conversation on the next ordinary turn', async () => {
  const { captureTurn, confirmCanonicalHistory } = await subject();
  const next = message('human-C', 'user', 'turn-C'),
    final = message('answer-C', 'assistant', 'turn-C');
  const turn = captureTurn(
    [...rows, next],
    new Set(rows.map((row) => row.delivery.generation)),
    rows
  );
  const complete = [...rows, next, final];
  expect(
    confirmCanonicalHistory(
      complete,
      {
        completed_turn_id: next.id,
        completed_answer_id: final.id,
        completed_message_ids: complete.map((row) => row.id),
      },
      turn
    )
  ).toEqual(complete);
});
it('a reentrant metadata getter cannot confirm a revoked operation', async () => {
  const { captureTurn, confirmCanonicalHistory } = await subject();
  const turn = captureTurn([...prefix, human], prior, prefix);
  let valid = true;
  const metadata = {
    ...values(),
    get completed_message_ids() {
      valid = false;
      return values().completed_message_ids;
    },
  };
  expect(
    confirmCanonicalHistory(rows, metadata, turn, () => valid)
  ).toBeUndefined();
});
