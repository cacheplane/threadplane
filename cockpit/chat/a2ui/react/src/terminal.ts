import type { Message } from '@threadplane/core';
// Keep the terminal proof transport-only: the private leaf avoids the React view barrel.
// eslint-disable-next-line @nx/enforce-module-boundaries -- Same-layout copied private data leaf.
import { copyData, equalData, plainRecord, closedFields } from '../../../../../libs/cockpit-a2ui-react/src/data.js';

export interface Checkpoint {
  readonly thread_id: string;
  readonly checkpoint_ns: '';
  readonly checkpoint_id: string;
  readonly checkpoint_map?: Readonly<Record<string, string>>;
}
interface Semantic {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly name: string | undefined;
  readonly reasoning: string | undefined;
}
export interface Owned {
  readonly threadId: string;
  readonly previous: readonly Semantic[];
  readonly human: Semantic;
  readonly generation: string;
}
export interface Confirmation {
  readonly checkpoint: Checkpoint;
  readonly messages: readonly Message[];
}
const empty = (value: unknown) =>
  value === undefined ||
  value === null ||
  (Array.isArray(value) && value.length === 0);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
function clean(value: Record<string, unknown>): boolean {
  return (
    (value.error === undefined || value.error === null) &&
    (value.pause === undefined || value.pause === null) &&
    (value.paused === undefined || value.paused === false) &&
    ['interrupts', '__interrupt__', 'subgraphs', 'tasks', 'next'].every((k) =>
      empty(value[k])
    )
  );
}
function semantic(input: unknown): Semantic | undefined {
  if (
    !plainRecord(input) ||
    !closedFields(input, [
      'id',
      'role',
      'content',
      'delivery',
      'name',
      'reasoning',
      'citations',
      'toolCallId',
      'toolCallIds',
    ]) ||
    !text(input.id) ||
    !['user', 'assistant'].includes(input.role as string) ||
    typeof input.content !== 'string' ||
    !empty(input.toolCallId) ||
    !empty(input.toolCallIds) ||
    !empty(input.citations) ||
    (input.name !== undefined && typeof input.name !== 'string') ||
    (input.reasoning !== undefined && typeof input.reasoning !== 'string')
  )
    return;
  return Object.freeze({
    id: input.id,
    role: input.role as 'user' | 'assistant',
    content: input.content,
    name: input.name as string | undefined,
    reasoning: input.reasoning as string | undefined,
  });
}
function canonical(input: unknown): readonly Message[] | undefined {
  if (!Array.isArray(input)) return;
  const seen = new Set<string>();
  for (const m of input) {
    const s = semantic(m);
    if (
      !s ||
      seen.has(s.id) ||
      !plainRecord(m.delivery) ||
      !closedFields(m.delivery, ['generation', 'phase', 'outcome']) ||
      !text(m.delivery.generation) ||
      m.delivery.phase !== 'complete' ||
      m.delivery.outcome !== 'success'
    )
      return;
    seen.add(s.id);
  }
  return input as readonly Message[];
}
export function checkpointSource(
  input: unknown,
  threadId: string
): Checkpoint | undefined {
  try {
    const cp = copyData(input);
    if (
      !plainRecord(cp) ||
      !closedFields(cp, [
        'thread_id',
        'checkpoint_ns',
        'checkpoint_id',
        'checkpoint_map',
      ]) ||
      cp.thread_id !== threadId ||
      cp.checkpoint_ns !== '' ||
      !text(cp.checkpoint_id)
    )
      return;
    if (
      cp.checkpoint_map !== undefined &&
      (!plainRecord(cp.checkpoint_map) ||
        !Object.hasOwn(cp.checkpoint_map, '') ||
        Object.entries(cp.checkpoint_map).some(
          ([key, value]) => key !== '' || value !== cp.checkpoint_id
        ))
    )
      return;
    return cp as unknown as Checkpoint;
  } catch {
    return;
  }
}

export interface Observation {
  observe(snapshot: unknown): void;
  capture(outcome: unknown, snapshot: unknown): Owned | undefined;
}
/** Created before submit. Only matching human rows observed during that run can be confirmed. */
export function createObservation(input: {
  threadId: string;
  input: string;
  previous: unknown;
}): Observation {
  const { threadId, input: humanInput } = input;
  let previous: readonly Semantic[] = [],
    priorGenerations: readonly string[] = [],
    human: Semantic | undefined,
    generation: string | undefined,
    invalid = false;
  try {
    const rows = canonical(copyData(input.previous));
    if (!rows || !text(threadId) || typeof humanInput !== 'string')
      invalid = true;
    else {
      previous = Object.freeze(rows.map((m) => semantic(m)!));
      priorGenerations = rows.map((m) => m.delivery.generation);
    }
  } catch {
    invalid = true;
  }
  function matching(snapshot: unknown, mayCapture: boolean) {
    const state = copyData(snapshot);
    if (!plainRecord(state) || !Array.isArray(state.messages)) return false;
    const rows = state.messages;
    if (
      rows.length < previous.length ||
      !equalData(rows.slice(0, previous.length).map(semantic), previous)
    )
      return false;
    const suffix = rows.slice(previous.length);
    // Before the admitted human appears, ordinary subscription updates retain just the prefix.
    if (!suffix.length) return mayCapture && !human;
    const first = suffix[0],
      candidate = semantic(first);
    if (
      !candidate ||
      candidate.role !== 'user' ||
      candidate.content !== humanInput ||
      previous.some((m) => m.id === candidate.id) ||
      suffix.slice(1).some((m) => plainRecord(m) && m.role === 'user') ||
      !plainRecord(first) ||
      !plainRecord(first.delivery) ||
      !text(first.delivery.generation) ||
      priorGenerations.includes(first.delivery.generation)
    )
      return false;
    if (human)
      return (
        equalData(human, candidate) && generation === first.delivery.generation
      );
    if (!mayCapture) return false;
    human = candidate;
    generation = first.delivery.generation;
    return true;
  }
  return Object.freeze({
    observe(snapshot: unknown) {
      if (!invalid)
        try {
          if (!matching(snapshot, true)) invalid = true;
        } catch {
          invalid = true;
        }
    },
    capture(outcome: unknown, snapshot: unknown): Owned | undefined {
      try {
        const state = copyData(snapshot);
        if (
          invalid ||
          !human ||
          !generation ||
          outcome !== 'success' ||
          !plainRecord(state) ||
          state.status !== 'idle' ||
          !clean(state) ||
          !empty(state.toolCalls) ||
          !matching(state, false) ||
          !Array.isArray(state.messages) ||
          !canonical([state.messages[previous.length]])
        )
          return;
        return Object.freeze({ threadId, previous, human, generation });
      } catch {
        return;
      }
    },
  });
}
export function captureOwned(input: {
  observation: Observation;
  outcome: unknown;
  snapshot: unknown;
}): Owned | undefined {
  return input.observation.capture(input.outcome, input.snapshot);
}
function rawMatches(wire: unknown, message: Message): boolean {
  if (
    !plainRecord(wire) ||
    !clean(wire) ||
    wire.id !== message.id ||
    wire.content !== message.content ||
    wire.type !== (message.role === 'user' ? 'human' : 'ai') ||
    !empty(wire.tool_calls) ||
    !empty(wire.invalid_tool_calls) ||
    !empty(wire.tool_call_chunks) ||
    !empty(wire.tool_call_id)
  )
    return false;
  const extra = wire.additional_kwargs ?? {};
  if (
    !plainRecord(extra) ||
    !empty(extra.function_call) ||
    !empty(extra.tool_calls) ||
    !empty(extra.tool_call_chunks) ||
    !empty(extra.citations) ||
    !empty(extra.sources)
  )
    return false;
  const name = wire.name === null ? undefined : wire.name;
  const reasoning = wire.reasoning ?? extra.reasoning_content;
  return name === message.name && reasoning === message.reasoning;
}
/** Raw graph messages and the exact saved root tuple are the only canonical authority. */
export function captureTerminal(
  owned: Owned | undefined,
  input: unknown,
  checkpoint: unknown
): Confirmation | undefined {
  try {
    if (!owned) return;
    const state = copyData(input),
      raw = copyData(checkpoint);
    if (
      !plainRecord(state) ||
      !plainRecord(raw) ||
      state.status !== 'idle' ||
      !clean(state) ||
      !empty(state.toolCalls) ||
      !Array.isArray(state.interrupts) ||
      !Array.isArray(state.subgraphs) ||
      !Array.isArray(raw.next) ||
      raw.next.length ||
      !Array.isArray(raw.tasks) ||
      raw.tasks.length ||
      !clean(raw) ||
      !Array.isArray(state.history) ||
      !plainRecord(state.history[0]) ||
      !clean(state.history[0]) ||
      !Array.isArray(state.history[0].next)
    )
      return;
    const cp = checkpointSource(state.history[0].checkpoint, owned.threadId);
    if (!cp || !equalData(cp, checkpointSource(raw.checkpoint, owned.threadId)))
      return;
    const messages = canonical(state.messages),
      values = raw.values;
    if (
      !messages ||
      messages.length !== owned.previous.length + 2 ||
      !plainRecord(values) ||
      !clean(values) ||
      !Array.isArray(values.messages) ||
      values.messages.length !== messages.length ||
      !equalData(
        messages.slice(0, owned.previous.length).map(semantic),
        owned.previous
      ) ||
      !equalData(semantic(messages.at(-2)), owned.human) ||
      messages.at(-1)?.role !== 'assistant' ||
      !messages.at(-1)?.content.trim()
    )
      return;
    const wireMessages = values.messages;
    if (!messages.every((m, i) => rawMatches(wireMessages[i], m))) return;
    return Object.freeze({ checkpoint: cp, messages });
  } catch {
    return;
  }
}
const unavailable = Object.freeze({ kind: 'unavailable' as const });
export type Prepared =
  | typeof unavailable
  | { readonly kind: 'prepared'; readonly confirmation: Confirmation };
/** App owner fencing: never load after failed submit, never rescue a failed exact read. */
export async function prepareTerminal(input: {
  readonly operation: object;
  readonly observation: Observation;
  readonly outcome: unknown;
  readonly getOperation: () => object | undefined;
  readonly getSnapshot: () => unknown;
  readonly load: () => Promise<unknown>;
  readonly read: (checkpoint: Checkpoint) => Promise<unknown>;
}): Promise<Prepared> {
  const operation = input.operation;
  try {
    if (input.getOperation() !== operation) return unavailable;
    const owned = captureOwned({
      observation: input.observation,
      outcome: input.outcome,
      snapshot: input.getSnapshot(),
    });
    if (!owned) return unavailable;
    await input.load();
    if (input.getOperation() !== operation) return unavailable;
    const reference = input.getSnapshot(),
      snapshot = copyData(reference);
    if (
      !plainRecord(snapshot) ||
      !Array.isArray(snapshot.history) ||
      !plainRecord(snapshot.history[0])
    )
      return unavailable;
    const cp = checkpointSource(snapshot.history[0].checkpoint, owned.threadId);
    if (!cp) return unavailable;
    const exact = await input.read(cp);
    if (
      input.getOperation() !== operation ||
      input.getSnapshot() !== reference ||
      !equalData(input.getSnapshot(), snapshot)
    )
      return unavailable;
    const confirmation = captureTerminal(owned, snapshot, exact);
    return confirmation
      ? Object.freeze({ kind: 'prepared', confirmation })
      : unavailable;
  } catch {
    return unavailable;
  }
}
