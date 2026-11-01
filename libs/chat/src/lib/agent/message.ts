import type { ContentBlock } from './content-block';
import type { Citation } from './citation';
import type { MessageDelivery } from './message-delivery';

/** The author category of a provider-independent agent message. */
export type Role = 'user' | 'assistant' | 'system' | 'tool';

/** A provider-independent chat message with delivery state, content, and optional reasoning, tools, and citations. */
export interface Message {
  id: string;
  /** Adapter-owned authoritative delivery lifecycle state for this message. */
  delivery: MessageDelivery;
  role: Role;
  /** Plain text, or a list of structured content blocks. */
  content: string | ContentBlock[];
  /** Present when role === 'tool'. */
  toolCallId?: string;
  /** Optional display/author name. */
  name?: string;
  /**
   * Reasoning text emitted by the model before/alongside the visible
   * response. Populated by adapters from {type:'reasoning'} or
   * {type:'thinking'} content blocks (LangGraph) or REASONING_MESSAGE_*
   * events (AG-UI). Always a plain string — provider-specific shape
   * (encrypted blocks, multi-step summaries) is absorbed by the adapter
   * and not surfaced here.
   */
  reasoning?: string;
  /**
   * Wall-clock duration of the reasoning phase in milliseconds.
   * Populated by the adapter when both start (first reasoning chunk) and
   * end (first response-text chunk, or final canonical message) are
   * known. Undefined when reasoning timing isn't available.
   */
  reasoningDurationMs?: number;
  /** Runtime-specific extras; do not rely on shape in portable code. */
  extra?: Record<string, unknown>;
  /** Provider-agnostic citation list. Populated by adapters. */
  citations?: Citation[];
  /**
   * IDs of tool calls emitted BY this assistant message. Populated by
   * adapters from provider-native fields (LangGraph: `tool_calls[].id`;
   * Anthropic: `tool_use` content blocks). Used by `<chat-tool-calls>` to
   * scope its rendering to a single message — otherwise it falls back to
   * the agent's global toolCalls list, which renders duplicates across
   * every AI message in a thread.
   */
  toolCallIds?: string[];
}

/**
 * Type guard narrowing a {@link Message} to `role: 'user'`.
 *
 * @param m The message to test.
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
 * @param m The message to test.
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
 * @param m The message to test.
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
 * @param m The message to test.
 * @returns `true` (and narrows `m`) when the message is a system message.
 * @example
 * ```ts
 * const visible = agent.messages().filter((m) => !isSystemMessage(m));
 * ```
 */
export function isSystemMessage(m: Message): m is Message & { role: 'system' } {
  return m.role === 'system';
}
