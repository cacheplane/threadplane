import { completeDelivery, type CompleteOutcome } from '@threadplane/core';
import type { LangGraphSubgraph } from './langgraph-snapshot.js';
import { observeInterrupts } from './interrupt-projection.js';
import {
  initialMessageState,
  reduceMessages,
  type MessageState,
} from './message-reducer.js';
import { ownMessage, ownSubgraph, ownSubgraphs } from './ownership.js';
import { rebaseRun } from './run-recovery.js';
import {
  failureProjection,
  finalizeProjection,
  projectStream,
  type StreamProjection,
} from './stream-projection.js';
import type { StreamEvent } from './transport.types.js';
import { projectValues } from './values-projection.js';
import { record, roleOf } from './wire-message.js';

interface ChildProjection {
  readonly state: MessageState;
  readonly projection: StreamProjection;
}

/** Private reducer state belongs to one physical observation, never the UI. */
export interface SubgraphObservation {
  readonly subgraphs: readonly LangGraphSubgraph[];
  readonly active: ReadonlyMap<string, ChildProjection>;
}

export function initialSubgraphs(
  subgraphs: readonly LangGraphSubgraph[] = ownSubgraphs([])
): SubgraphObservation {
  return { subgraphs, active: new Map() };
}

/** Capture routing once before any payload getter can mutate it. Encoded paths
 * are canonical; JSON tuple keys also distinguish custom segments containing |. */
export function captureStreamEvent(input: StreamEvent): StreamEvent {
  const type = input.type;
  const namespace = input.namespace;
  const event: StreamEvent = {
    type,
    namespace: Array.isArray(namespace) ? [...namespace] : namespace,
  };
  for (const key of [
    'data',
    'messages',
    'messageMetadata',
    'sseId',
    'interrupt',
    'interrupts',
  ] as const)
    if (Object.hasOwn(input, key)) event[key] = input[key] as never;
  if (type === 'error' && !namespace?.length && event['data'] == null) {
    event['status'] = input['status'];
    event['message'] = input['message'];
  }
  return event;
}

function route(
  event: StreamEvent
): { namespace: string[]; event: StreamEvent } | undefined {
  const parts = event.type.split('|');
  const encoded = parts.length > 1 ? parts.slice(1) : undefined;
  const supplied = event.namespace;
  const valid = (path: unknown): path is string[] =>
    Array.isArray(path) &&
    path.length > 0 &&
    path.every((segment) => typeof segment === 'string' && segment.length > 0);
  if (
    encoded &&
    (!valid(encoded) ||
      (supplied !== undefined &&
        (!valid(supplied) ||
          supplied.length !== encoded.length ||
          supplied.some((segment, index) => segment !== encoded[index]))))
  )
    return undefined;
  const namespace = encoded ?? supplied;
  if (!valid(namespace)) return undefined;
  return {
    namespace,
    event: {
      ...event,
      type: parts[0] as StreamEvent['type'],
      namespace: undefined,
    },
  };
}

function replace(
  previous: SubgraphObservation,
  namespace: readonly string[],
  child: ChildProjection,
  entry: LangGraphSubgraph
): SubgraphObservation {
  const key = JSON.stringify(namespace);
  const active = new Map(previous.active);
  active.set(key, child);
  const index = previous.subgraphs.findIndex(
    (value) => JSON.stringify(value.namespace) === key
  );
  const entries = [...previous.subgraphs];
  const projected = ownSubgraph(entry, previous.subgraphs[index]);
  if (index < 0) entries.push(projected);
  else entries[index] = projected;
  return { active, subgraphs: ownSubgraphs(entries, previous.subgraphs) };
}

export function projectSubgraphs(
  previous: SubgraphObservation,
  input: StreamEvent,
  generation: string,
  messageIdPrefix = generation
): SubgraphObservation {
  const routed = route(input);
  if (!routed) return previous;
  const { namespace, event } = routed;
  const key = JSON.stringify(namespace);
  const entry = previous.subgraphs.find(
    (value) => JSON.stringify(value.namespace) === key
  );
  const active = previous.active.get(key);
  let state = active?.state ?? {
    ...initialMessageState(),
    messages: entry?.messages ?? [],
  };
  let projection = active?.projection ?? {
    generation,
    messageIdPrefix,
    baselineIds: state.messages.map((message) => message.id),
    resume: { turnIds: state.messages.map((message) => message.id) },
    sawAssistant: false,
    terminal: false,
    paused: false,
    canonical: [],
  };
  if (event.type === 'error') {
    state = reduceMessages(state, {
      type: 'complete',
      generation: projection.generation,
      outcome: 'error',
    });
    return replace(
      previous,
      namespace,
      { state, projection },
      {
        namespace: entry?.namespace ?? namespace,
        messages: state.messages,
        values: entry?.values,
        interrupts: entry?.interrupts ?? [],
        error: failureProjection(undefined, true, true, false),
      }
    );
  }
  // A new child frame can reopen this generation after an observed child error.
  // Retained values and controls alone are not evidence of new message activity.
  const data = record(event['data']);
  const wireMessages =
    event.messages ??
    (event.type === 'checkpoints' ? record(data?.['values']) : data)?.[
      'messages'
    ];
  const messageActivity =
    (event.type === 'messages' ||
      event.type.startsWith('messages/') ||
      event.type === 'values' ||
      event.type === 'checkpoints') &&
    Array.isArray(wireMessages) &&
    wireMessages.some((message) => {
      const raw = record(message);
      return raw && roleOf(raw);
    });
  if (entry?.error && active && messageActivity) {
    const rebased = rebaseRun(state, projection, projection.generation);
    state = rebased.state;
    projection = rebased.projection;
  }
  const projected = projectStream(state, projection, event);
  const values = projectValues(entry?.values, event);
  const priorInterrupts = entry?.interrupts ?? [];
  const observedInterrupts = observeInterrupts(
    active ? priorInterrupts : [],
    event
  );
  const activity =
    projected.state.messages !== state.messages || values !== entry?.values;
  // A new physical projection retains old controls until fresh data or a valid
  // new control batch supplies evidence, including an authoritative empty batch.
  const interrupts =
    observedInterrupts ?? (!active && activity ? [] : priorInterrupts);
  if (
    !entry &&
    projected.state.messages.length === 0 &&
    values === undefined &&
    interrupts.length === 0
  )
    return previous;
  if (
    !activity &&
    interrupts === priorInterrupts &&
    projected.projection === projection &&
    (active || observedInterrupts === undefined)
  )
    return previous;
  return replace(previous, namespace, projected, {
    namespace: entry?.namespace ?? namespace,
    messages: projected.state.messages,
    values,
    interrupts,
    ...(!messageActivity && entry?.error ? { error: entry.error } : {}),
  });
}

/** Close only active physical projections. Older handoff observations retain
 * their identity/outcome. Child errors cannot be upgraded by parent success. */
export function settleSubgraphs(
  previous: SubgraphObservation,
  outcome: CompleteOutcome,
  canonical = false,
  recovered = false
): SubgraphObservation {
  let next = previous;
  for (const entry of previous.subgraphs) {
    const child = previous.active.get(JSON.stringify(entry.namespace));
    if (!child) continue;
    let state = canonical
      ? finalizeProjection(child.state, child.projection)
      : child.state;
    const result = entry.error ? 'error' : outcome;
    state = reduceMessages(state, {
      type: 'complete',
      generation: child.projection.generation,
      outcome: result,
    });
    if (recovered && !entry.error)
      state = {
        ...state,
        messages: state.messages.map((message) =>
          message.delivery.generation === child.projection.generation &&
          message.delivery.phase === 'complete' &&
          message.delivery.outcome === 'interrupted'
            ? ownMessage({
                ...message,
                delivery: completeDelivery(
                  child.projection.generation,
                  outcome
                ),
              })
            : message
        ),
      };
    next = replace(
      next,
      entry.namespace,
      { ...child, state },
      { ...entry, messages: state.messages }
    );
  }
  return next;
}

export function rebaseSubgraphs(
  previous: SubgraphObservation,
  generation: string
): SubgraphObservation {
  let next = previous;
  for (const entry of previous.subgraphs) {
    const child = previous.active.get(JSON.stringify(entry.namespace));
    if (!child) continue;
    const rebased = rebaseRun(child.state, child.projection, generation);
    next = replace(next, entry.namespace, rebased, {
      ...entry,
      messages: rebased.state.messages,
    });
  }
  return next;
}
