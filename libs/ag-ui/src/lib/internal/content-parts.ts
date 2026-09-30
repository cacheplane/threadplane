import type { ContentBlock } from '@threadplane/chat';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safeParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

function textOf(parts: readonly unknown[]): string {
  return parts
    .filter((p): p is { text: string } => isRecord(p) && p['type'] === 'text' && typeof p['text'] === 'string')
    .map((p) => p.text)
    .join('');
}

/**
 * Normalize a TOOL_CALL_RESULT / ToolMessage `content` (string | ContentPart[]
 * in AG-UI 1.0) into the neutral ToolCall fields. Strings keep the pre-1.0
 * behavior (JSON parse with fallback). Part lists concatenate their text parts
 * into `result` and carry every part verbatim in `parts`; an all-media list
 * yields '' rather than an invented placeholder.
 */
export function toolResultFromContent(content: unknown): { result: unknown; parts?: readonly unknown[] } {
  if (typeof content === 'string') return { result: safeParseJson(content) };
  if (Array.isArray(content)) {
    const joined = textOf(content);
    return { result: joined.length > 0 ? safeParseJson(joined) : '', parts: content };
  }
  return { result: content };
}

/**
 * Map a tool message's part list to chat content blocks. Text and URL-sourced
 * images have neutral blocks; everything else is preserved under
 * `extra['ag-ui'].parts` so nothing the producer sent is dropped.
 */
export function messageContentFromParts(
  parts: readonly unknown[],
): { content: ContentBlock[]; extra?: Record<string, unknown> } {
  const content: ContentBlock[] = [];
  const rest: unknown[] = [];
  for (const part of parts) {
    if (!isRecord(part)) { rest.push(part); continue; }
    const source = isRecord(part['source']) ? part['source'] : undefined;
    if (part['type'] === 'text' && typeof part['text'] === 'string') {
      content.push({ type: 'text', text: part['text'] });
    } else if (part['type'] === 'image' && source?.['type'] === 'url' && typeof source['value'] === 'string') {
      content.push({ type: 'image', url: source['value'] });
    } else {
      rest.push(part);
    }
  }
  return rest.length > 0 ? { content, extra: { 'ag-ui': { parts: rest } } } : { content };
}
