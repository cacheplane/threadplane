import type { MessageDelivery } from './delivery.js';
import type { Citation } from './citation.js';
import type { ContentBlock } from './content-block.js';
import type { PlainValue } from './tool.js';

/** Identifies whether a message comes from the user, assistant, system, or a tool result. */
export type Role = 'user' | 'assistant' | 'system' | 'tool';

/** Owned text, optional structured content and source metadata. SDK objects remain outside. */
export interface Message {
  readonly id: string;
  readonly role: Role;
  /** The message as text. Always present, also when `blocks` is. */
  readonly content: string;
  /**
   * The message as structured blocks, when the backend sent or the caller
   * submitted more than text. `content` then holds the text of its `text`
   * blocks, so a view that renders text only needs no second path.
   */
  readonly blocks?: readonly ContentBlock[];
  /** Backend-supplied reasoning display text. */
  readonly reasoning?: string;
  /**
   * How long the reasoning took, in milliseconds, when the backend or runtime
   * measured it. Absent means unknown, not zero.
   */
  readonly reasoningDurationMs?: number;
  readonly citations?: readonly Citation[];
  readonly delivery: MessageDelivery;
  readonly toolCallId?: string;
  readonly toolCallIds?: readonly string[];
  readonly name?: string;
  /**
   * Backend-specific extras as frozen plain data, such as a raw tool-call list
   * or a response format. Portable code does not rely on its shape.
   */
  readonly extra?: Readonly<Record<string, PlainValue>>;
}
