import type { ContentBlock, PlainValue } from '@threadplane/core';
import { ownState } from './state.js';

/** A state document as plain data: a frozen record of plain values. */
export type ApplicationState = Readonly<Record<string, PlainValue>>;
/**
 * The patch a submission merges into the state document. A session with a
 * declared state type accepts that type's keys; any other accepts a plain record.
 */
export type SubmitState<TState = unknown> = unknown extends TState
  ? ApplicationState
  : Partial<TState>;
/**
 * What `submit` accepts: the user's message as text, or an object carrying the
 * message, optional structured content and an optional state patch.
 */
export type SubmitInput<TState = unknown> =
  | string
  | {
      readonly message: string;
      /**
       * The message as structured content. Text and image blocks are sent as
       * the protocol's text and image parts; `message` is then not sent. A
       * `tool_use` or `tool_result` block is not something a user message
       * can carry, and is refused without sending.
       */
      readonly blocks?: readonly ContentBlock[];
      readonly state?: SubmitState<TState>;
    };
/** A user message's content as a request carries it: text, or the protocol's parts. */
export type UserContent =
  | string
  | readonly (
      | { readonly type: 'text'; readonly text: string }
      | {
          readonly type: 'image';
          readonly source: { readonly type: 'url'; readonly value: string };
        }
    )[];
export interface CapturedSubmit {
  readonly message: string;
  /** Present when blocks were given: what the user record holds in place of `message`. */
  readonly content?: UserContent;
  readonly state?: ApplicationState;
}

function isRecord(value: unknown): value is ApplicationState {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Core blocks as the protocol's content parts. An empty list is no content. */
export function captureBlocks(blocks: unknown): UserContent | undefined {
  if (blocks === undefined) return undefined;
  if (!Array.isArray(blocks)) throw new TypeError('Blocks must be an array');
  const parts = [];
  const length = blocks.length;
  for (let index = 0; index < length; index++) {
    const block = (blocks[index] ?? {}) as ContentBlock;
    const kind = block.type;
    if (kind === 'text') {
      const text = block.text;
      if (typeof text !== 'string')
        throw new TypeError('A text block needs its text');
      parts.push(Object.freeze({ type: 'text' as const, text }));
    } else if (kind === 'image') {
      const url = block.url;
      if (typeof url !== 'string' || !url)
        throw new TypeError('An image block needs its url');
      parts.push(
        Object.freeze({
          type: 'image' as const,
          source: Object.freeze({ type: 'url' as const, value: url }),
        })
      );
    } else
      throw new TypeError('A user message carries text and image blocks only');
  }
  return parts.length ? Object.freeze(parts) : undefined;
}

function captureState(state: unknown): ApplicationState | undefined {
  if (state === undefined) return undefined;
  if (!isRecord(state))
    throw new TypeError('Application state must be a plain record');
  return ownState(state) as ApplicationState;
}

/** Read only the selected input fields and own their data before deferral. */
export function captureSubmit<TState = unknown>(
  input: SubmitInput<TState>
): CapturedSubmit {
  if (typeof input === 'string') return Object.freeze({ message: input });
  const message = input.message;
  if (typeof message !== 'string')
    throw new TypeError('A string message is required');
  const content = captureBlocks(input.blocks);
  const state = captureState(input.state);
  return Object.freeze({
    message,
    ...(content && { content }),
    ...(state && { state }),
  });
}

/** What a command sends beside its own input: a user message, a state patch, or neither. */
export interface CapturedExtras {
  /** The user message to append, when a message or blocks were given. */
  readonly content?: UserContent;
  readonly state?: ApplicationState;
}
const NO_EXTRAS: CapturedExtras = Object.freeze({});

/**
 * Reads what `resume` and `runWithoutMessage` may send in the same request:
 * `message` or `blocks` for a user message, and `state` for a patch. Blocks
 * win over the message, as in `submit`.
 */
export function captureExtras(
  options:
    | {
        readonly message?: unknown;
        readonly blocks?: unknown;
        readonly state?: unknown;
      }
    | undefined
): CapturedExtras {
  if (options === undefined || options === null) return NO_EXTRAS;
  const message = options.message;
  if (message !== undefined && typeof message !== 'string')
    throw new TypeError('A message must be a string');
  const content = captureBlocks(options.blocks) ?? message;
  const state = captureState(options.state);
  if (content === undefined && state === undefined) return NO_EXTRAS;
  return Object.freeze({
    ...(content !== undefined && { content }),
    ...(state && { state }),
  });
}

/** Merge an already captured patch with the latest owned state at admission. */
export function mergeSubmitState(
  previous: PlainValue,
  patch?: ApplicationState
): PlainValue {
  if (patch === undefined) return previous;
  if (!isRecord(previous))
    throw new TypeError(
      'Current state must be a plain record to apply a patch'
    );
  if (
    Object.keys(patch).every(
      (key) =>
        Object.hasOwn(previous, key) && Object.is(previous[key], patch[key])
    )
  )
    return previous;
  return Object.freeze({ ...previous, ...patch });
}
