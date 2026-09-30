export type ToolCallStatus = 'pending' | 'running' | 'complete' | 'error';

export interface ToolCall {
  id: string;
  name: string;
  /** Arguments. May be partial while streaming (`status !== 'complete'`). */
  args: unknown;
  status: ToolCallStatus;
  /** Present when status === 'complete' or 'error'. */
  result?: unknown;
  /** Optional error payload when status === 'error'. */
  error?: unknown;
  /**
   * Structured result parts when the runtime returned them (AG-UI 1.0
   * `ContentPart[]`). `result` then holds the concatenated text parts, which
   * may be empty for an all-media result. Runtime-specific shape.
   */
  parts?: readonly unknown[];
}
