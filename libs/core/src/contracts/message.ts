import type { MessageDelivery } from './delivery.js';
import type { Citation } from './citation.js';

export type Role = 'user' | 'assistant' | 'system' | 'tool';

/** Owned text and source metadata; rich content and SDK objects remain outside this slice. */
export interface Message {
  readonly id: string;
  readonly role: Role;
  readonly content: string;
  /** Backend-supplied reasoning display text. */
  readonly reasoning?: string;
  readonly citations?: readonly Citation[];
  readonly delivery: MessageDelivery;
  readonly toolCallId?: string;
  readonly toolCallIds?: readonly string[];
  readonly name?: string;
}
