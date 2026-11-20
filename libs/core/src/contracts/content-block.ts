import type { PlainValue } from './tool.js';

/**
 * One structured segment of a message: text, an image, a tool invocation the
 * model wrote inline, or a tool result. Plain data, like everything a snapshot
 * holds.
 */
export type ContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly url: string; readonly alt?: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly args: PlainValue;
    }
  | {
      readonly type: 'tool_result';
      readonly toolCallId: string;
      readonly result: PlainValue;
      readonly isError?: boolean;
    };

/** The text of a block list: its `text` blocks joined in order, and nothing else. */
export function contentBlocksText(blocks: readonly ContentBlock[]): string {
  let text = '';
  for (const block of blocks) if (block.type === 'text') text += block.text;
  return text;
}
