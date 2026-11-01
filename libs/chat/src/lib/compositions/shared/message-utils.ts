/**
 * Extracts a human-readable string from a message's content.
 *
 * Message content is either a plain string or an array of typed blocks.
 * Reasoning-capable models (OpenAI gpt-5/o-series, Anthropic) emit complex
 * arrays: `{type:'text',text}`, `{type:'reasoning',...}`, tool-use blocks, etc.
 * Only the visible text portions are rendered and anything else is skipped.
 * Stringifying the whole array would dump raw JSON like `[{"type":"text",...}]`
 * into the chat bubble.
 *
 * The parameter is structural on purpose. This function reads nothing but
 * `.content`, and callers hold either the runtime-neutral `Message` from
 * `agent.messages()` or a LangChain `BaseMessage` depending on where the
 * message came from. Both satisfy `{ content: unknown }`, so neither has to
 * cast.
 *
 * @param message - Any object carrying a `content` field.
 * @returns The concatenated visible text, or `''` when there is none.
 */
export function messageContent(message: { content: unknown }): string {
  return extractText(message.content);
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (typeof block === 'string') {
      out += block;
      continue;
    }
    if (!isRecord(block)) continue;
    const t = block['type'];
    if (t === 'text' || t === 'output_text' || t === undefined) {
      const text = block['text'];
      if (typeof text === 'string') out += text;
    }
    // Skip reasoning, tool_use, image, etc. — not chat-bubble content.
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
