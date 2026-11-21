import type { Message } from '@threadplane/core';

export type { Message, Role } from '@threadplane/core';

/**
 * Type guard narrowing a {@link Message} to `role: 'user'`.
 *
 * @param m - The message to test.
 * @returns `true` (and narrows `m`) when the message was sent by the user.
 * @example
 * ```ts
 * const userTurns = agent.messages().filter(isUserMessage);
 * ```
 */
export function isUserMessage(m: Message): m is Message & { role: 'user' } {
  return m.role === 'user';
}

/**
 * Type guard narrowing a {@link Message} to `role: 'assistant'`.
 *
 * @param m - The message to test.
 * @returns `true` (and narrows `m`) when the message came from the assistant.
 * @example
 * ```ts
 * const reply = agent.messages().findLast(isAssistantMessage);
 * ```
 */
export function isAssistantMessage(m: Message): m is Message & { role: 'assistant' } {
  return m.role === 'assistant';
}

/**
 * Type guard narrowing a {@link Message} to `role: 'tool'` (a tool result turn).
 *
 * @param m - The message to test.
 * @returns `true` (and narrows `m`) when the message is a tool result.
 * @example
 * ```ts
 * if (isToolMessage(m)) console.log(m.toolCallId);
 * ```
 */
export function isToolMessage(m: Message): m is Message & { role: 'tool' } {
  return m.role === 'tool';
}

/**
 * Type guard narrowing a {@link Message} to `role: 'system'`.
 *
 * @param m - The message to test.
 * @returns `true` (and narrows `m`) when the message is a system message.
 * @example
 * ```ts
 * const visible = agent.messages().filter((m) => !isSystemMessage(m));
 * ```
 */
export function isSystemMessage(m: Message): m is Message & { role: 'system' } {
  return m.role === 'system';
}
