import type { Message } from '@threadplane/core';
import { copyData, record, text } from './checkpoints';
export interface OwnedTurn {
  readonly id: string;
  readonly generation: string;
  readonly input: string;
  /** Supplied independently: confirmed current history for Send, preview for Fork. */
  readonly prefix: readonly Message[];
}
function complete(value: unknown): value is Message {
  if (
    !record(value) ||
    !text(value['id']) ||
    typeof value['content'] !== 'string' ||
    !['user', 'assistant'].includes(value['role'] as string) ||
    value['toolCallId'] !== undefined ||
    (value['toolCallIds'] !== undefined &&
      (!Array.isArray(value['toolCallIds']) || value['toolCallIds'].length))
  )
    return false;
  const delivery = value['delivery'];
  return (
    record(delivery) &&
    text(delivery['generation']) &&
    delivery['phase'] === 'complete' &&
    delivery['outcome'] === 'success'
  );
}
function validPrefix(value: unknown): value is readonly Message[] {
  return (
    Array.isArray(value) &&
    value.length % 2 === 0 &&
    value.every(
      (message, index) =>
        complete(message) && message.role === (index % 2 ? 'assistant' : 'user')
    ) &&
    new Set(value.map((message) => message.id)).size === value.length
  );
}
/** Admission never derives the expected prefix from the session being verified. */
export function captureTurn(
  inputMessages: readonly Message[],
  previousGenerations: ReadonlySet<string>,
  expectedPrefix: readonly Message[],
  submittedInput: string
): OwnedTurn | undefined {
  try {
    const messages = copyData(inputMessages),
      prefix = copyData(expectedPrefix);
    if (
      !Array.isArray(messages) ||
      !validPrefix(prefix) ||
      typeof submittedInput !== 'string'
    )
      return;
    const candidates = messages.filter(
      (message) =>
        record(message) &&
        message['role'] === 'user' &&
        record(message['delivery']) &&
        message['delivery']['generation'] !== message['id'] &&
        !previousGenerations.has(message['delivery']['generation'] as string)
    );
    if (candidates.length !== 1 || !complete(candidates[0])) return;
    const human = candidates[0];
    if (
      human.content !== submittedInput ||
      prefix.some((message) => message.id === human.id) ||
      messages.filter(
        (message) => record(message) && message['id'] === human.id
      ).length !== 1
    )
      return;
    return Object.freeze({
      id: human.id,
      generation: human.delivery.generation,
      input: submittedInput,
      prefix,
    });
  } catch {
    return;
  }
}
/** Call only after the controller proves idle, error-free terminal session state. */
export function confirmCanonicalHistory(
  inputMessages: readonly Message[],
  inputValues: unknown,
  inputTurn: OwnedTurn
): readonly Message[] | undefined {
  try {
    const messages = copyData(inputMessages),
      values = copyData(inputValues),
      turn = copyData(inputTurn) as OwnedTurn;
    if (
      !Array.isArray(messages) ||
      !record(values) ||
      !validPrefix(turn.prefix) ||
      !text(turn.id) ||
      !text(turn.generation) ||
      typeof turn.input !== 'string' ||
      values['completed_turn_id'] !== turn.id ||
      !text(values['completed_answer_id'])
    )
      return;
    const expected = [
      ...turn.prefix.map((message) => message.id),
      turn.id,
      values['completed_answer_id'],
    ];
    const ids = values['completed_message_ids'];
    if (
      !Array.isArray(ids) ||
      ids.length !== expected.length ||
      new Set(ids).size !== ids.length ||
      !ids.every((id, index) => id === expected[index])
    )
      return;
    const canonical: Message[] = [];
    for (const id of ids) {
      const matches = messages.filter(
        (message) => record(message) && message['id'] === id
      );
      if (matches.length !== 1 || !complete(matches[0])) return;
      canonical.push(matches[0]);
    }
    if (
      !turn.prefix.every(
        (message, index) =>
          message.id === canonical[index].id &&
          message.role === canonical[index].role &&
          message.content === canonical[index].content
      )
    )
      return;
    const human = canonical.at(-2)!,
      answer = canonical.at(-1)!;
    if (
      human.role !== 'user' ||
      answer.role !== 'assistant' ||
      human.content !== turn.input ||
      human.delivery.generation !== turn.generation ||
      answer.delivery.generation !== turn.generation
    )
      return;
    return Object.freeze(canonical);
  } catch {
    return;
  }
}
