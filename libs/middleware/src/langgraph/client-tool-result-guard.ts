import type { BaseMessage } from './types.js';
import type {
  ClientToolExecutionRecord,
  ClientToolExecutionStore,
  ClientToolResult,
} from './client-tool-execution-store.js';

export interface ClientToolResultMessage {
  readonly toolCallId: string;
  readonly result: ClientToolResult;
}

export interface RecordClientToolResultsInput {
  readonly threadId: string;
  readonly messages: readonly BaseMessage[];
  readonly store: ClientToolExecutionStore;
}

export interface RecordClientToolResultsResult {
  readonly recordedToolCallIds: string[];
  readonly duplicateToolCallIds: string[];
}

/** Extract serialized client-tool results from LangGraph ToolMessages. */
export function extractClientToolResultMessages(
  messages: readonly BaseMessage[],
): ClientToolResultMessage[] {
  const out: ClientToolResultMessage[] = [];
  for (const message of messages) {
    const toolCallId = toolCallIdFromMessage(message);
    if (!toolCallId) continue;
    out.push({ toolCallId, result: resultFromMessageContent(message.content) });
  }
  return out;
}

/** Record newly claimed receipts and identify already-done duplicates.
 * Await before graph continuation: existing executing/failed records reject
 * without being changed. A batch is not transactional; earlier receipts may
 * already be recorded when a later receipt rejects. */
export async function recordClientToolResults(
  input: RecordClientToolResultsInput,
): Promise<RecordClientToolResultsResult> {
  const recordedToolCallIds: string[] = [];
  const duplicateToolCallIds: string[] = [];

  for (const entry of extractClientToolResultMessages(input.messages)) {
    const key = { threadId: input.threadId, toolCallId: entry.toolCallId };
    const claim = await input.store.claim(key);
    if (claim === 'claimed') {
      await input.store.record(key, entry.result);
      recordedToolCallIds.push(entry.toolCallId);
      continue;
    }
    if (claim.status === 'done') {
      duplicateToolCallIds.push(entry.toolCallId);
      continue;
    }
    throw new Error(`Client tool result cannot settle an unowned execution: ${entry.toolCallId}`);
  }

  return { recordedToolCallIds, duplicateToolCallIds };
}

/** Remove duplicate client-tool result messages before server continuation logic sees them. */
export function filterDuplicateClientToolResultMessages(input: {
  readonly messages: readonly BaseMessage[];
  readonly duplicateToolCallIds: ReadonlySet<string>;
}): BaseMessage[] {
  return input.messages.filter((message) => {
    const toolCallId = toolCallIdFromMessage(message);
    return !toolCallId || !input.duplicateToolCallIds.has(toolCallId);
  });
}

/** Lookup prior client-tool executions for reload reconciliation. */
export function lookupClientToolExecutions(input: {
  readonly threadId: string;
  readonly toolCallIds: readonly string[];
  readonly store: ClientToolExecutionStore;
}): Promise<Record<string, ClientToolExecutionRecord>> {
  return input.store.lookup(input.threadId, input.toolCallIds);
}

function toolCallIdFromMessage(message: BaseMessage): string | undefined {
  const raw = message as unknown as Record<string, unknown>;
  const direct = raw['tool_call_id'] ?? raw['toolCallId'];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const kwargs = raw['additional_kwargs'];
  if (kwargs && typeof kwargs === 'object') {
    const nested = (kwargs as Record<string, unknown>)['tool_call_id'];
    if (typeof nested === 'string' && nested.length > 0) return nested;
  }
  const lcKwargs = raw['lc_kwargs'];
  if (lcKwargs && typeof lcKwargs === 'object') {
    const nested = (lcKwargs as Record<string, unknown>)['tool_call_id'];
    if (typeof nested === 'string' && nested.length > 0) return nested;
  }
  return undefined;
}

function resultFromMessageContent(content: unknown): ClientToolResult {
  const text = contentToText(content);
  if (text.startsWith('Error: ')) {
    return { ok: false, error: text.slice('Error: '.length) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: true, value: text };
  }
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(contentToText).join('');
  if (content == null) return '';
  return String(content);
}
