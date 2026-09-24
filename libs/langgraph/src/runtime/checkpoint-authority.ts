import type { ThreadState } from '@langchain/langgraph-sdk';
import type { PlainValue } from '@threadplane/core';
import { ownValue, sameOwnedValue, sameToolInvocation } from './ownership';
import { record, roleOf } from './wire-message';
import type { ToolInvocation } from './tool-invocations';
import type { StreamEvent } from './transport.types';

import {
  captureCheckpoint,
  type OwnedCheckpointPosition,
} from '../lib/transport/checkpoint-position';
export {
  captureCheckpoint,
  type OwnedCheckpointPosition,
  type CheckpointReference,
} from '../lib/transport/checkpoint-position';

const unavailable = () =>
  new Error('Checkpoint execution authority is unavailable.');
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

type CapturedCheckpointState = ThreadState & {
  readonly interrupts?: readonly unknown[];
};

/** Select and own once before any projection can traverse transport getters. */
export function captureCheckpointState(
  value: unknown,
  position: OwnedCheckpointPosition
): CapturedCheckpointState {
  const raw = record(value);
  if (!raw) throw unavailable();
  const state = ownValue({
    checkpoint: raw['checkpoint'],
    values: raw['values'],
    next: raw['next'],
    tasks: raw['tasks'],
    metadata: raw['metadata'],
    interrupts: raw['interrupts'],
  } as PlainValue) as unknown as CapturedCheckpointState;
  if (
    !sameOwnedValue(
      captureCheckpoint(state.checkpoint, position.thread_id),
      position
    ) ||
    !record(state.values) ||
    !Array.isArray(state.next) ||
    !state.next.every((next) => typeof next === 'string') ||
    !Array.isArray(state.tasks) ||
    (state.interrupts !== undefined && !Array.isArray(state.interrupts))
  )
    throw unavailable();
  return state;
}

export function captureCompletedCheckpoint(
  value: unknown,
  position: OwnedCheckpointPosition
) {
  const state = captureCheckpointState(value, position);
  const values = record(state.values)!;
  if (
    state.next.length ||
    state.tasks.length ||
    Object.hasOwn(values, '__interrupt__') ||
    state.interrupts?.length
  )
    throw unavailable();
  const messages = values['messages'];
  if (messages !== undefined && !Array.isArray(messages)) throw unavailable();
  const calls = new Map<string, ToolInvocation>();
  const results = new Set<string>();
  for (const raw of (messages as unknown[] | undefined) ?? []) {
    const message = record(raw);
    if (!message) throw unavailable();
    if (roleOf(message) === 'tool') {
      if (!nonempty(message['tool_call_id'])) throw unavailable();
      results.add(message['tool_call_id']);
    }
    if (roleOf(message) !== 'assistant') continue;
    const entries = message['tool_calls'];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || message['type'] === 'AIMessageChunk')
      throw unavailable();
    for (const rawCall of entries) {
      const entry = record(rawCall);
      const id = entry?.['id'];
      const name = entry?.['name'];
      if (!nonempty(id) || !nonempty(name)) throw unavailable();
      const call = Object.freeze({
        id,
        name,
        args: entry?.['args'] as PlainValue,
      });
      const previous = calls.get(id);
      if (previous && !sameToolInvocation(previous, call)) throw unavailable();
      calls.set(id, call);
    }
  }
  if ([...calls.keys()].some((id) => !results.has(id))) throw unavailable();
  return { state, calls: Object.freeze([...calls.values()]) };
}

export interface CheckpointCandidate {
  readonly position: OwnedCheckpointPosition;
  readonly runId: string;
  readonly values: PlainValue;
  readonly next: readonly string[];
  readonly tasks: readonly { readonly id: string; readonly name: string }[];
}
export interface ConfirmedCheckpoint {
  readonly position: OwnedCheckpointPosition;
  readonly state: ThreadState;
  readonly paused: boolean;
}

export function captureCheckpointEvent(
  event: StreamEvent,
  threadId: string
): CheckpointCandidate | undefined {
  if (event.type !== 'checkpoints' || event.namespace?.length) return undefined;
  const raw = record(event['data']);
  const config = record(record(raw?.['config'])?.['configurable']);
  const position = captureCheckpoint(config, threadId);
  const runId = config?.['run_id'];
  const values = ownValue(raw?.['values'] as PlainValue);
  const next = ownValue(raw?.['next'] as PlainValue);
  const tasks = ownValue(raw?.['tasks'] as PlainValue);
  if (
    !nonempty(runId) ||
    !record(values) ||
    !Array.isArray(next) ||
    !next.every((entry) => typeof entry === 'string') ||
    !Array.isArray(tasks)
  )
    throw unavailable();
  const identities = tasks.map((value) => {
    const task = record(value);
    if (!nonempty(task?.['id']) || !nonempty(task?.['name']))
      throw unavailable();
    return Object.freeze({ id: task['id'], name: task['name'] });
  });
  return Object.freeze({
    position,
    runId,
    values,
    next: next as readonly string[],
    tasks: Object.freeze(identities),
  });
}

function pauseEvidence(state: ThreadState) {
  if (!state.next.length || !state.tasks.length) throw unavailable();
  const ids = new Set<string>();
  return state.tasks.map((raw) => {
    const task = record(raw);
    if (
      !task ||
      !nonempty(task['id']) ||
      !nonempty(task['name']) ||
      task['result'] !== null ||
      task['error'] != null ||
      task['state'] != null ||
      !state.next.includes(task['name']) ||
      ids.has(task['id'])
    )
      throw unavailable();
    ids.add(task['id']);
    const interrupts = task['interrupts'];
    if (
      !Array.isArray(interrupts) ||
      !interrupts.length ||
      interrupts.some(
        (entry) =>
          !nonempty(record(entry)?.['id']) || !Object.hasOwn(entry, 'value')
      )
    )
      throw unavailable();
    return { id: task['id'], name: task['name'], interrupts };
  });
}

export function confirmCheckpoint(
  candidate: CheckpointCandidate | undefined,
  value: unknown,
  runId: string
): ConfirmedCheckpoint {
  if (!candidate || candidate.runId !== runId) throw unavailable();
  const state = captureCheckpointState(value, candidate.position);
  if (
    state.metadata?.['run_id'] !== runId ||
    !sameOwnedValue(state.values as PlainValue, candidate.values) ||
    !sameOwnedValue(state.next, candidate.next) ||
    !sameOwnedValue(
      state.tasks.map((task) => ({ id: task.id, name: task.name })),
      candidate.tasks
    )
  )
    throw unavailable();
  const paused = !!(state.next.length || state.tasks.length);
  if (paused) pauseEvidence(state);
  else if (
    Object.hasOwn(record(state.values)!, '__interrupt__') ||
    state.interrupts?.length
  )
    throw unavailable();
  return Object.freeze({ position: candidate.position, state, paused });
}

export function assertResumeCheckpoint(
  previous: ConfirmedCheckpoint,
  value: unknown
) {
  if (!previous.paused) throw unavailable();
  const state = captureCheckpointState(value, previous.position);
  if (
    !sameOwnedValue(pauseEvidence(previous.state), pauseEvidence(state)) ||
    !sameOwnedValue(previous.state.next, state.next) ||
    !sameOwnedValue(
      previous.state.values as PlainValue,
      state.values as PlainValue
    )
  )
    throw unavailable();
}
