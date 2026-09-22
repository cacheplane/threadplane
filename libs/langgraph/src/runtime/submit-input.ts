import type { PlainValue } from '@threadplane/core';
import { ownValue } from './ownership';

/** Backend input is plain application data, independent of the observed values.
 * Project interface-typed records explicitly, e.g. itinerary.map(stop => ({ ...stop })).
 * Message assembly and the fixed tool catalog belong to the session. */
export type LangGraphInputState = Readonly<Record<string, PlainValue>> & {
  readonly messages?: never;
  readonly client_tools?: never;
};

export type LangGraphSubmitInput =
  | string
  | { readonly message: string; readonly state?: LangGraphInputState };

/** Capture caller getters and nested data before any session effects. */
export function captureSubmitInput(input: LangGraphSubmitInput): {
  readonly message: string;
  readonly state?: LangGraphInputState;
} {
  if (typeof input === 'string') return { message: input };
  const message = input.message;
  const state = input.state;
  if (state === undefined) return { message };
  if (
    state === null ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    (Object.getPrototypeOf(state) !== Object.prototype &&
      Object.getPrototypeOf(state) !== null)
  )
    throw new TypeError('Application input requires a plain data record.');
  const ancestors = new Set<object>([state]);
  return {
    message,
    state: Object.freeze(
      Object.fromEntries(
        Object.keys(state)
          .filter((key) => key !== 'messages' && key !== 'client_tools')
          .map((key) => [key, ownValue(state[key], ancestors)])
      )
    ),
  };
}

/** Supply state only for the first creation POST of an independent submit. */
export function createSubmitPayload(
  messages: readonly unknown[],
  catalog: readonly unknown[],
  state?: LangGraphInputState
): Record<string, unknown> {
  return {
    ...state,
    messages,
    ...(catalog.length ? { client_tools: catalog } : {}),
  };
}
