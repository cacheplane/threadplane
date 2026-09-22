import type { ThreadState } from '@langchain/langgraph-sdk';
import type { PlainValue } from '@threadplane/core';
import type { LangGraphInterrupt } from './langgraph-snapshot';
import { ownValue, ownValueWithSharing } from './ownership';
import type { StreamEvent } from './transport.types';
import { record } from './wire-message';

type Interrupts = readonly LangGraphInterrupt[];

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
