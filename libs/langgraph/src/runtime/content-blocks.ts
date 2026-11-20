import type { ContentBlock, Message, PlainValue } from '@threadplane/core';
import { ownValue } from './ownership.js';
import { record } from './wire-message.js';

function plain(value: unknown): PlainValue {
  try {
    return ownValue(value as PlainValue);
  } catch {
    // Data that is not plain is not published; nothing else depends on it.
    return undefined;
  }
}

/** The address of an image block, in any of the shapes a LangChain message
 * carries one: an OpenAI `image_url`, a standard `image` block with a `url`,
 * or inline base64 data, which becomes a `data:` address. */
function imageUrl(
  block: Record<string, unknown>,
  type: unknown
): string | undefined {
  if (type === 'image_url') {
    const image = block['image_url'];
    if (typeof image === 'string') return image;
    const url = record(image)?.['url'];
    return typeof url === 'string' ? url : undefined;
  }
  if (type !== 'image') return undefined;
  if (typeof block['url'] === 'string') return block['url'];
  const source = record(block['source']);
  if (typeof source?.['url'] === 'string') return source['url'];
  const data = block['data'] ?? block['base64'] ?? source?.['data'];
  const mime =
    block['mime_type'] ?? block['mimeType'] ?? source?.['media_type'];
  return typeof data === 'string' && data
    ? `data:${
        typeof mime === 'string' && mime ? mime : 'image/png'
      };base64,${data}`
    : undefined;
}

function projectBlock(value: unknown): ContentBlock | undefined {
  if (typeof value === 'string') return { type: 'text', text: value };
  const block = record(value);
  if (!block) return undefined;
  // Block getters are transport effects; read each field once.
  const type = block['type'];
  if (type === 'text' || type === 'output_text' || type === undefined) {
    const text = block['text'];
    return typeof text === 'string' ? { type: 'text', text } : undefined;
  }
  if (type === 'image_url' || type === 'image') {
    const url = imageUrl(block, type);
    if (url === undefined) return undefined;
    const alt = block['alt'];
    return {
      type: 'image',
      url,
      ...(typeof alt === 'string' ? { alt } : {}),
    };
  }
  if (type === 'tool_use') {
    const id = block['id'];
    const name = block['name'];
    return typeof id === 'string' && typeof name === 'string'
      ? {
          type: 'tool_use',
          id,
          name,
          args: plain(block['input'] ?? block['args']),
        }
      : undefined;
  }
  if (type === 'tool_result') {
    const id = block['tool_use_id'] ?? block['tool_call_id'];
    return typeof id === 'string'
      ? {
          type: 'tool_result',
          toolCallId: id,
          result: plain(block['content'] ?? block['result']),
          ...(block['is_error'] === true ? { isError: true } : {}),
        }
      : undefined;
  }
  return undefined;
}

/** What one read of a wire message's content yields. */
export interface WireContentReading {
  /** The visible text: string content as is, or the text blocks joined. */
  readonly text: string;
  /** The content as core blocks, when it holds more than text. */
  readonly blocks?: readonly ContentBlock[];
  /** A tool message's structured content array, as owned plain data. */
  readonly parts?: readonly PlainValue[];
}

/**
 * Reads a wire message's content once. The text follows the shared visible
 * text rule: a string verbatim, and from an array its string entries and the
 * string `text` of `text`, `output_text` and untyped blocks, in order.
 *
 * `blocks` is present only when the content holds more than text: an image,
 * an inline tool invocation or a tool result. Blocks this runtime does not
 * recognize (such as reasoning, which is published as `Message.reasoning`)
 * are left out, so a text message keeps its shape. `parts` is a tool
 * message's content array, the structured parts of its result.
 */
export function readContent(value: unknown, tool = false): WireContentReading {
  if (typeof value === 'string') return { text: value };
  if (!Array.isArray(value)) return { text: '' };
  // A tool result's parts are published whole, so they are owned first and
  // the text is read from the owned copy: each wire field is read once.
  const parts = tool ? plain(value) : undefined;
  const source = Array.isArray(parts) ? parts : value;
  let text = '';
  const blocks: ContentBlock[] = [];
  let structured = false;
  for (const entry of source) {
    const block = projectBlock(entry);
    if (!block) continue;
    if (block.type === 'text') text += block.text;
    else structured = true;
    blocks.push(block);
  }
  return {
    text,
    ...(structured ? { blocks } : {}),
    ...(Array.isArray(parts) && parts.length ? { parts } : {}),
  };
}

/** Wire fields the transcript already publishes, or that only route a message. */
const projected = new Set([
  'id',
  'type',
  'role',
  'content',
  'name',
  'tool_call_id',
]);

/**
 * What a full wire message carried beside its identity and content, as owned
 * plain data: `additional_kwargs`, `response_metadata`, `usage_metadata`,
 * `tool_calls`, a tool message's `status` and `artifact`, and so on. Absent
 * when there is nothing, and for a message that is not plain data.
 */
export function projectExtra(
  raw: Record<string, unknown>
): Message['extra'] | undefined {
  const extra: Record<string, unknown> = {};
  let present = false;
  for (const key of Object.keys(raw)) {
    if (projected.has(key)) continue;
    const value = raw[key];
    if (value === undefined || value === null) continue;
    // LangChain serializes this flag on every message; false says nothing.
    if (key === 'example' && value === false) continue;
    if (Array.isArray(value) && !value.length) continue;
    const entries = record(value);
    if (entries && !Object.keys(entries).length) continue;
    extra[key] = value;
    present = true;
  }
  if (!present) return undefined;
  return record(plain(extra)) as Message['extra'] | undefined;
}

/**
 * Captures the blocks of a submission before any session effect and returns
 * them with the wire content LangGraph accepts for a human message. Text and
 * images can be sent; a `tool_use` or `tool_result` block cannot be part of a
 * user message and is rejected.
 */
export function captureInputBlocks(input: unknown): {
  readonly blocks: readonly ContentBlock[];
  readonly content: readonly Readonly<Record<string, PlainValue>>[];
} {
  if (!Array.isArray(input) || !input.length)
    throw new TypeError('Submitted blocks must be a non-empty list.');
  const blocks: ContentBlock[] = [];
  const content: Record<string, PlainValue>[] = [];
  const length = input.length;
  for (let index = 0; index < length; index += 1) {
    const block = record(input[index]);
    // Block getters are caller effects; read each field once.
    const type = block?.['type'];
    if (type === 'text') {
      const text = block?.['text'];
      if (typeof text !== 'string')
        throw new TypeError('A text block needs its text.');
      blocks.push({ type: 'text', text });
      content.push({ type: 'text', text });
    } else if (type === 'image') {
      const url = block?.['url'];
      const alt = block?.['alt'];
      if (typeof url !== 'string' || !url)
        throw new TypeError('An image block needs a url.');
      if (alt !== undefined && typeof alt !== 'string')
        throw new TypeError('An image block alt must be text.');
      blocks.push({
        type: 'image',
        url,
        ...(alt !== undefined ? { alt } : {}),
      });
      content.push({ type: 'image_url', image_url: { url } });
    } else
      throw new TypeError(
        'A submission can carry text and image blocks only; tool blocks belong to the agent.'
      );
  }
  return {
    blocks: ownValue(
      blocks as unknown as PlainValue
    ) as unknown as ContentBlock[],
    content: ownValue(content) as unknown as readonly Readonly<
      Record<string, PlainValue>
    >[],
  };
}
