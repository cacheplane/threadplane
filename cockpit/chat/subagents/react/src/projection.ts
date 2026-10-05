import type { Message, ToolCall } from '@threadplane/core';
import { copyData, validToolArgs } from './authority';

export interface ToolCard {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly argumentsText: string;
  readonly resultText?: string;
}

/** Associate literal observations with their one requesting assistant, never a result row. */
export function projectToolObservations(
  observedMessages: readonly Message[],
  observedTools: readonly ToolCall[]
): ReadonlyMap<string, readonly ToolCard[]> {
  const cards = new Map<string, readonly ToolCard[]>();
  try {
    const messages = copyData(observedMessages) as readonly Message[];
    const tools = copyData(observedTools) as readonly ToolCall[];
    if (
      new Set(messages.map((message) => message.id)).size !== messages.length ||
      new Set(tools.map((tool) => tool.id)).size !== tools.length
    )
      return cards;
    for (const tool of tools) {
      if (
        !tool.id ||
        !validToolArgs(tool) ||
        !['pending', 'complete'].includes(tool.status)
      )
        continue;
      const owners = messages.flatMap((message, index) =>
        message.role === 'assistant'
          ? (message.toolCallIds ?? [])
              .filter((id) => id === tool.id)
              .map(() => ({ message, index }))
          : []
      );
      if (owners.length !== 1) continue;
      const owner = owners[0];
      const results = messages.flatMap((message, index) =>
        message.toolCallId === tool.id ? [{ message, index }] : []
      );
      let resultText: string | undefined;
      if (tool.status === 'complete') {
        if (results.length !== 1 || typeof tool.result !== 'string') continue;
        const result = results[0];
        if (
          result.index <= owner.index ||
          result.message.role !== 'tool' ||
          result.message.name !== tool.name ||
          result.message.content !== tool.result ||
          result.message.toolCallIds?.length ||
          messages
            .slice(owner.index + 1, result.index)
            .some((message) => message.role === 'user')
        )
          continue;
        resultText = tool.result;
      } else if (
        results.length ||
        ('result' in tool && tool.result !== undefined) ||
        messages
          .slice(owner.index + 1)
          .some((message) => message.role === 'user')
      )
        continue;
      const card = Object.freeze({
        id: tool.id,
        name: tool.name,
        role: (tool.args as { subagent_type: string }).subagent_type,
        argumentsText: JSON.stringify(tool.args, null, 2),
        ...(resultText === undefined ? {} : { resultText }),
      });
      cards.set(
        owner.message.id,
        Object.freeze([...(cards.get(owner.message.id) ?? []), card])
      );
    }
  } catch {
    return new Map();
  }
  return cards;
}
