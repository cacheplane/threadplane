import type { MessageDelivery } from './delivery.js';

export type Role = 'user' | 'assistant' | 'system' | 'tool';

/** Owned text projection; rich content and arbitrary SDK extras are not in this slice. */
export interface Message {
  readonly id: string;
  readonly role: Role;
  readonly content: string;
  readonly delivery: MessageDelivery;
  readonly toolCallId?: string;
  readonly toolCallIds?: readonly string[];
  readonly name?: string;
}
