import type { Message } from '@threadplane/core';

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function roleOf(
  raw: Record<string, unknown>
): Message['role'] | undefined {
  switch (raw['type'] ?? raw['role']) {
    case 'human':
    case 'HumanMessage':
    case 'user':
      return 'user';
    case 'ai':
    case 'AIMessage':
    case 'AIMessageChunk':
    case 'assistant':
      return 'assistant';
    case 'system':
    case 'SystemMessage':
      return 'system';
    case 'tool':
    case 'ToolMessage':
      return 'tool';
    default:
      return undefined;
  }
}

export function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .flatMap((block) => {
      if (typeof block === 'string') return [block];
      const content = record(block);
      const type = content?.['type'];
      if (type !== 'text' && type !== 'output_text' && type !== undefined)
        return [];
      const text = content?.['text'];
      return typeof text === 'string' ? [text] : [];
    })
    .join('');
}
