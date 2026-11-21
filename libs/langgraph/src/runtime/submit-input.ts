import type { ContentBlock, PlainValue } from '@threadplane/core';
import { captureInputBlocks } from './content-blocks.js';
import { ownValue } from './ownership.js';

/** Backend input is plain application data, independent of the observed values.
 * Project interface-typed records explicitly, e.g. itinerary.map(stop => ({ ...stop })).
 * Message assembly and the fixed tool catalog belong to the session. */
export type LangGraphInputState = Readonly<Record<string, PlainValue>> & {
  readonly messages?: never;
  readonly client_tools?: never;
};

/** Input state for a session: any plain record, or part of its declared state. */
export type LangGraphSubmitState<TState = unknown> = unknown extends TState
  ? LangGraphInputState
  : Partial<TState> & {
      readonly messages?: never;
      readonly client_tools?: never;
    };

/**
 * What `submit` accepts: the user's message as text, or an object carrying the
 * message, optional structured content and optional input state.
 */
export type LangGraphSubmitInput<TState = unknown> =
  | string
  | {
      readonly message: string;
      /**
       * The message as structured content: text and images. `message` is then
       * the text shown where blocks are not rendered.
       */
      readonly blocks?: readonly ContentBlock[];
      readonly state?: LangGraphSubmitState<TState>;
    };

/** A human message's wire content: text, or the content blocks LangGraph reads. */
export type WireContent =
  | string
  | readonly Readonly<Record<string, PlainValue>>[];

export interface CapturedSubmitInput {
  readonly message: string;
  /** The submitted blocks, owned, when the caller sent any. */
  readonly blocks?: readonly ContentBlock[];
  /** What the human message carries on the wire, when it is not `message`. */
  readonly content?: WireContent;
  readonly state?: LangGraphInputState;
}

/** Capture caller getters and nested data before any session effects. */
export function captureSubmitInput(
  input: LangGraphSubmitInput
): CapturedSubmitInput {
  if (typeof input === 'string') return { message: input };
  const message = input.message;
  const submitted = input.blocks;
  const state = input.state;
  const captured =
    submitted === undefined ? undefined : captureInputBlocks(submitted);
  const base = captured
    ? { message, blocks: captured.blocks, content: captured.content }
    : { message };
  if (state === undefined) return base;
  return { ...base, state: captureInputState(state) };
}

/** Owns a partial input state, without the keys the session itself sends. */
export function captureInputState(
  state: Readonly<Record<string, PlainValue>>
): LangGraphInputState {
  if (
    state === null ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    (Object.getPrototypeOf(state) !== Object.prototype &&
      Object.getPrototypeOf(state) !== null)
  )
    throw new TypeError('Application input requires a plain data record.');
  const ancestors = new Set<object>([state]);
  return Object.freeze(
    Object.fromEntries(
      Object.keys(state)
        .filter((key) => key !== 'messages' && key !== 'client_tools')
        .map((key) => [key, ownValue(state[key], ancestors)])
    )
  ) as LangGraphInputState;
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

/**
 * The payload of a run that adds no user message: the staged tool results it
 * hands back, a partial state, or both. Null when it carries neither, so the
 * graph continues from the thread's saved state.
 */
export function createContinuationPayload(
  messages: readonly unknown[],
  catalog: readonly unknown[],
  state?: LangGraphInputState
): Record<string, unknown> | null {
  if (!messages.length && !state) return null;
  return {
    ...state,
    ...(messages.length ? { messages } : {}),
    ...(catalog.length ? { client_tools: catalog } : {}),
  };
}
