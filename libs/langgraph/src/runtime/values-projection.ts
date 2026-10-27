import type { ThreadState } from '@langchain/langgraph-sdk';
import type { PlainValue } from '@threadplane/core';
import type { LangGraphValues } from './langgraph-snapshot.js';
import { ownValue, ownValueWithSharing } from './ownership.js';
import type { StreamEvent } from './transport.types.js';
import { record } from './wire-message.js';

type Values = LangGraphValues | undefined;

function projectRecord(
  previous: Values,
  value: Record<string, unknown>
): LangGraphValues {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    // Reject SDK/class instances through the existing plain-data boundary,
    // before selecting fields could disguise them as ordinary records.
    ownValue(value as PlainValue);
  }
  const selected = Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== 'messages' && key !== '__interrupt__')
      .map((key) => [key, value[key]])
  );
  return ownValueWithSharing(
    selected as PlainValue,
    previous
  ) as LangGraphValues;
}

/** Only root full-state records replace application values. Node updates are
 * not root snapshots, and live interrupt envelopes carry control metadata only. */
export function projectValues(previous: Values, event: StreamEvent): Values {
  if ((event.namespace?.length ?? 0) > 0 || event.type.includes('|'))
    return previous;
  if (event.type !== 'values' && event.type !== 'checkpoints') return previous;
  const data = record(event['data']);
  if (event.type === 'values' && data && Object.hasOwn(data, '__interrupt__'))
    return previous;
  const value = event.type === 'checkpoints' ? record(data?.['values']) : data;
  return value ? projectRecord(previous, value) : previous;
}

/** A successful history replacement is authoritative, including absent values.
 * Checkpoint interrupt metadata does not turn the checkpoint into an envelope. */
export function projectHistoryValues(
  previous: Values,
  history: readonly ThreadState[]
): Values {
  const value = record(history[0]?.values);
  return value ? projectRecord(previous, value) : undefined;
}
