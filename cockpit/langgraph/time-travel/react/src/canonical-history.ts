import type { Message } from '@threadplane/core';

export interface OwnedTurn {
  readonly id: string;
  readonly generation: string;
  readonly prefix: readonly Message[];
}

function complete(message: Message) {
  return (
    typeof message.id === 'string' &&
    message.id.length > 0 &&
    (message.role === 'user' || message.role === 'assistant') &&
    message.toolCallId === undefined &&
    !message.toolCallIds?.length &&
    message.delivery.phase === 'complete' &&
    message.delivery.outcome === 'success'
  );
}

/** Fork source history is adopted by the SDK before the new human is published. */
export function captureTurn(
  messages: readonly Message[],
  previousGenerations: ReadonlySet<string>,
  fork: boolean,
  confirmed: readonly Message[],
  valid: () => boolean = () => true
): OwnedTurn | undefined {
  if (!valid()) return;
  const reverseIndex = [...messages]
    .reverse()
    .findIndex(
      (message) =>
        message.role === 'user' &&
        !previousGenerations.has(message.delivery.generation) &&
        message.delivery.generation !== message.id
    );
  if (!valid() || reverseIndex < 0) return;
  const index = messages.length - 1 - reverseIndex;
  const human = messages[index];
  if (!complete(human) || !valid()) return;
  const prefix = fork ? messages.slice(0, index) : [...confirmed];
  if (
    prefix.some(
      (message) =>
        !complete(message) ||
        (fork && message.delivery.generation !== message.id)
    ) ||
    new Set(prefix.map((message) => message.id)).size !== prefix.length ||
    prefix.some((message) => message.id === human.id) ||
    !valid()
  )
    return;
  return Object.freeze({
    id: human.id,
    generation: human.delivery.generation,
    prefix: Object.freeze(prefix),
  });
}

/** Exact prefix equality prevents a valid current pair from hiding missing history. */
export function confirmCanonicalHistory(
  messages: readonly Message[],
  values: Readonly<Record<string, unknown>> | undefined,
  turn: OwnedTurn,
  valid: () => boolean = () => true
): readonly Message[] | undefined {
  const read = (key: string) => {
    if (!valid()) return;
    return values && Object.hasOwn(values, key) ? values[key] : undefined;
  };
  const humanId = read('completed_turn_id');
  if (!valid()) return;
  const answerId = read('completed_answer_id');
  if (!valid()) return;
  const rawIds = read('completed_message_ids');
  if (
    !valid() ||
    humanId !== turn.id ||
    typeof answerId !== 'string' ||
    !answerId ||
    answerId === turn.id ||
    !Array.isArray(rawIds)
  )
    return;
  const ids = [...rawIds];
  const expected = [
    ...turn.prefix.map((message) => message.id),
    turn.id,
    answerId,
  ];
  if (
    ids.length !== expected.length ||
    !ids.every(
      (id, index) =>
        typeof id === 'string' && id.length > 0 && id === expected[index]
    ) ||
    new Set(ids).size !== ids.length ||
    !valid()
  )
    return;
  const canonical: Message[] = [];
  for (const id of ids) {
    const rows = messages.filter((message) => message.id === id);
    if (!valid() || rows.length !== 1 || !complete(rows[0])) return;
    canonical.push(rows[0]);
  }
  const human = canonical.at(-2)!,
    answer = canonical.at(-1)!;
  if (
    human.role !== 'user' ||
    answer.role !== 'assistant' ||
    human.delivery.generation !== turn.generation ||
    answer.delivery.generation !== turn.generation ||
    !valid()
  )
    return;
  return Object.freeze(canonical);
}
