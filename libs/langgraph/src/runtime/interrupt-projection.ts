import type { ThreadState } from '@langchain/langgraph-sdk';
import type { PlainValue } from '@threadplane/core';
import type {
  LangGraphInterrupt,
  LangGraphWireInterrupt,
} from './langgraph-snapshot.js';
import { ownValue, ownValueWithSharing } from './ownership.js';
import type { StreamEvent } from './transport.types.js';
import { record } from './wire-message.js';

type Interrupts = readonly LangGraphWireInterrupt[];

const breakpoint: Interrupts = ownValue([{ when: 'breakpoint' }]) as Interrupts;

function assertPlainRecord(value: Record<string, unknown>): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    // Check before extracting fields could disguise an SDK/class instance.
    ownValue(value as PlainValue);
  }
}

function batch(value: unknown): Interrupts | undefined {
  if (!Array.isArray(value) || !value.every((item) => record(item)))
    return undefined;
  return ownValue(value) as Interrupts;
}

function valuesControl(value: unknown): Interrupts | undefined {
  const values = record(value);
  if (!values || !Object.hasOwn(values, '__interrupt__')) return undefined;
  assertPlainRecord(values);
  const interrupts = batch(values['__interrupt__']);
  return interrupts?.length === 0 ? breakpoint : interrupts;
}

function isBreakpoint(interrupts: Interrupts): boolean {
  return (
    interrupts.length === 1 &&
    interrupts[0].when === 'breakpoint' &&
    Object.keys(interrupts[0]).length === 1
  );
}

function replace(previous: Interrupts, interrupts: Interrupts): Interrupts {
  const ids = new Set<string>();
  const unique = interrupts.filter((interrupt) => {
    if (typeof interrupt.id !== 'string') return true;
    if (ids.has(interrupt.id)) return false;
    ids.add(interrupt.id);
    return true;
  });
  return ownValueWithSharing(unique, previous) as Interrupts;
}

function merge(previous: Interrupts, interrupts: Interrupts): Interrupts {
  if (interrupts.length === 0 || isBreakpoint(interrupts))
    return replace(previous, interrupts);
  return replace(
    previous,
    isBreakpoint(previous) ? interrupts : [...previous, ...interrupts]
  );
}

function checkpointInterrupts(checkpoint: Record<string, unknown>): Interrupts {
  assertPlainRecord(checkpoint);
  const control = valuesControl(checkpoint['values']);
  if (control !== undefined) return control;
  const tasks = checkpoint['tasks'];
  if (!Array.isArray(tasks)) return [];
  return tasks.flatMap((input) => {
    const task = record(input);
    if (!task || !Object.hasOwn(task, 'interrupts')) return [];
    assertPlainRecord(task);
    return batch(task['interrupts']) ?? [];
  });
}

/** Root controls accumulate during an attempt; authoritative checkpoints replace
 * the batch. Unrelated events never traverse interrupt payloads. */
export function projectInterrupts(
  previous: Interrupts,
  event: StreamEvent
): Interrupts {
  return observeInterrupts(previous, event) ?? previous;
}

/** Distinguish an unobserved control channel from an authoritative empty batch.
 * Child physical projections use this without reading transport data twice. */
export function observeInterrupts(
  previous: Interrupts,
  event: StreamEvent
): Interrupts | undefined {
  if ((event.namespace?.length ?? 0) > 0 || event.type.includes('|'))
    return undefined;
  if (event.type === 'values' || event.type === 'updates') {
    const control = valuesControl(event['data']);
    return control === undefined ? undefined : merge(previous, control);
  }
  if (event.type === 'checkpoints') {
    const checkpoint = record(event['data']);
    return checkpoint
      ? replace(previous, checkpointInterrupts(checkpoint))
      : undefined;
  }
  if (event.type !== 'interrupt' && event.type !== 'interrupts')
    return undefined;
  // Explicit malformed data is not permission to consume a different outer
  // payload. Custom transports without data use the existing wrapper fields.
  const payload = Object.hasOwn(event, 'data') ? record(event['data']) : event;
  if (!payload || !Object.hasOwn(payload, event.type)) return undefined;
  assertPlainRecord(payload);
  const input = payload[event.type];
  const interrupts =
    event.type === 'interrupt'
      ? batch(record(input) ? [input] : undefined)
      : batch(input);
  return interrupts === undefined ? undefined : merge(previous, interrupts);
}

/** Only the latest checkpoint restores interrupts; next and nested child task
 * state are not evidence of a root pause. */
export function projectHistoryInterrupts(
  previous: Interrupts,
  history: readonly ThreadState[]
): Interrupts {
  const latest = record(history[0]);
  return replace(previous, latest ? checkpointInterrupts(latest) : []);
}

const identified = new WeakMap<Interrupts, readonly LangGraphInterrupt[]>();

/** The published form of a pending batch: every interrupt has the id a
 * response names. A backend id is kept; a static breakpoint is `breakpoint`;
 * anything else is named by position. One wire batch maps to one list. */
export function identifyInterrupts(
  interrupts: Interrupts
): readonly LangGraphInterrupt[] {
  const known = identified.get(interrupts);
  if (known) return known;
  const taken = new Set(
    interrupts.flatMap(({ id }) => (typeof id === 'string' ? [id] : []))
  );
  const published = ownValue(
    interrupts.map((interrupt, index) => {
      if (typeof interrupt.id === 'string') return interrupt;
      let id =
        interrupt.when === 'breakpoint' ? 'breakpoint' : `interrupt-${index}`;
      while (taken.has(id)) id = `${id}-${index}`;
      taken.add(id);
      return { ...interrupt, id };
    }) as PlainValue
  ) as unknown as readonly LangGraphInterrupt[];
  identified.set(interrupts, published);
  return published;
}

/**
 * The value a resume command carries for these responses. One pending
 * interrupt takes its response's value as is. Several are answered by backend
 * id, so each answered interrupt needs an id the backend sent and a value.
 */
export function resumeValue(
  responses: unknown,
  pending: Interrupts
): PlainValue | undefined {
  if (!Array.isArray(responses) || responses.length === 0)
    throw new TypeError('Resume requires at least one interrupt response.');
  const published = identifyInterrupts(pending);
  const answers = new Map<string, PlainValue | undefined>();
  const length = responses.length;
  for (let index = 0; index < length; index++) {
    const response = record(responses[index]);
    // Response getters are caller effects; read each field once.
    const interruptId = response?.['interruptId'];
    const status = response?.['status'];
    const value = response?.['value'] as PlainValue | undefined;
    if (typeof interruptId !== 'string')
      throw new TypeError('An interrupt response names its interrupt by id.');
    const position = published.findIndex(({ id }) => id === interruptId);
    if (position < 0)
      throw new TypeError(`No pending interrupt has the id "${interruptId}".`);
    if (answers.has(interruptId))
      throw new TypeError(`The interrupt "${interruptId}" is answered twice.`);
    if (status === 'cancelled')
      throw new TypeError(
        'LangGraph cannot cancel an interrupt. Resolve it with a value the graph reads as a refusal.'
      );
    if (status !== 'resolved')
      throw new TypeError('An interrupt response has the status "resolved".');
    if (pending.length > 1) {
      if (pending[position].id !== interruptId)
        throw new TypeError(
          `The interrupt "${interruptId}" has no backend id, so it cannot be answered while others are pending.`
        );
      if (value === undefined)
        throw new TypeError(
          `The response to "${interruptId}" needs a value while several interrupts are pending.`
        );
    }
    answers.set(interruptId, value);
  }
  if (pending.length === 1) return answers.values().next().value;
  return Object.fromEntries(answers);
}
