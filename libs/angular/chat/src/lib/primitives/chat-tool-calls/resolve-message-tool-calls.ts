import { agentToolCalls, type Agent, type Message, type ToolCall } from '../../agent';

/**
 * Resolves the tool calls that belong to a specific message, mirroring the
 * per-message scoping the chat lib uses to avoid every assistant bubble
 * re-rendering the whole thread's tool-call list.
 *
 * The agent's list is `agent.toolCalls()` followed by the calls the model is
 * still writing (`agent.streamingToolCalls()`), each shown as a running call
 * with the arguments read so far.
 *
 * - No message context → the agent's global tool-call list.
 * - Assistant message with `toolCallIds` → those ids, in order.
 * - Assistant message with `tool_use` blocks in `blocks` → those ids.
 * - Assistant message with no linkage → [] (this message emitted no calls).
 * - Any non-assistant message → the global list (callers filter as needed).
 *
 * MUST be called inside a reactive context (computed/effect) so the
 * `agent.toolCalls()` and `agent.streamingToolCalls()` reads register.
 */
export function resolveMessageToolCalls(agent: Agent, message: Message | undefined): readonly ToolCall[] {
  const all = agentToolCalls(agent);
  if (message && message.role === 'assistant') {
    if (message.toolCallIds && message.toolCallIds.length > 0) {
      return message.toolCallIds
        .map((id) => all.find((tc) => tc.id === id))
        .filter((x): x is ToolCall => !!x);
    }
    if (message.blocks) {
      return message.blocks
        .flatMap((block) => (block.type === 'tool_use' ? [block.id] : []))
        .map((id) => all.find((tc) => tc.id === id))
        .filter((x): x is ToolCall => !!x);
    }
    return [];
  }
  return all;
}
