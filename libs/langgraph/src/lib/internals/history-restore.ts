import type { BaseMessage } from '@langchain/core/messages';
import type { ThreadState } from '@langchain/langgraph-sdk';

/**
 * Where a delegation child ran, recovered from the parent thread's checkpoint
 * history rather than from live stream events.
 */
export interface ChildExecution {
  /** Parent tool-call id that spawned the child. */
  toolCallId: string;
  /** Name of the parent node task that ran the call (normally `tools`). */
  taskName: string;
  /** Id of that task; the child's checkpoint namespace is `<taskName>:<taskId>`. */
  taskId: string;
  /** The child's checkpoint namespace, e.g. `tools:<taskId>`. */
  checkpointNs: string;
  /** True when the task is still outstanding in the latest checkpoint. */
  outstanding: boolean;
  /** True when that outstanding task carries an error. */
  failed: boolean;
}

interface HistoryTask {
  id?: unknown;
  name?: unknown;
  path?: unknown;
  result?: unknown;
  error?: unknown;
}

/**
 * Map delegation tool calls to the task that executed them, from history.
 *
 * Each tool call a model dispatches runs as its own pushed task
 * (`path[0] === '__pregel_push'`), and a child graph run inside that task
 * checkpoints under the namespace `<task name>:<task id>` — the same
 * `tools:<uuid>` segment live child stream events carry. History links the two
 * ways, tried in this order:
 *
 * 1. **Result.** A finished task's `result.messages` holds the ToolMessage it
 *    produced, whose `tool_call_id` names the call exactly. This is the
 *    authoritative link and is collected across every checkpoint first, so a
 *    positional guess can never override it.
 * 2. **Send index.** A task still outstanding in the latest checkpoint has no
 *    result yet. Its `path[1]` indexes the `tool_calls` of the assistant
 *    message that dispatched it, so it is aligned with that message only —
 *    the newest assistant message in the latest checkpoint's state.
 *
 * Tool calls neither rule resolves are omitted rather than guessed.
 */
export function mapChildExecutionsFromHistory(
  history: ReadonlyArray<ThreadState<unknown>>,
  toolCallIds: ReadonlySet<string>,
): Map<string, ChildExecution> {
  const out = new Map<string, ChildExecution>();
  if (toolCallIds.size === 0 || history.length === 0) return out;

  for (const checkpoint of history) {
    for (const task of pushTasks(checkpoint)) {
      const resultMessages = isRecord(task.result) ? task.result['messages'] : undefined;
      if (!Array.isArray(resultMessages)) continue;
      for (const message of resultMessages) {
        if (!isRecord(message) || message['type'] !== 'tool') continue;
        const toolCallId = message['tool_call_id'];
        if (typeof toolCallId !== 'string' || !toolCallIds.has(toolCallId) || out.has(toolCallId)) continue;
        out.set(toolCallId, execution(toolCallId, task, false));
      }
    }
  }

  const latest = history[0];
  const outstanding = pushTasks(latest).filter(task => task.result === undefined || task.result === null);
  if (outstanding.length === 0) return out;
  const toolCalls = latestDispatchedToolCalls(latest);
  if (!toolCalls) return out;
  for (const task of outstanding) {
    const index = Array.isArray(task.path) ? task.path[1] : undefined;
    if (typeof index !== 'number') continue;
    const toolCall = toolCalls[index];
    const toolCallId = isRecord(toolCall) ? toolCall['id'] : undefined;
    if (typeof toolCallId !== 'string' || !toolCallIds.has(toolCallId) || out.has(toolCallId)) continue;
    out.set(toolCallId, execution(toolCallId, task, true));
  }
  return out;
}

/**
 * Restore the `reasoning` field a live merge attaches to assistant messages.
 *
 * The live merge derives `reasoning` from `reasoning`/`thinking` content blocks
 * as they stream; a history read hands back the raw checkpoint messages, which
 * carry the blocks but not the derived field. Derive it the same way here, and
 * when the persisted message has no reasoning blocks at all (some providers
 * only stream it), keep what is already on screen for that id rather than
 * dropping it.
 */
export function restoreReasoning(
  previous: ReadonlyArray<BaseMessage>,
  restored: BaseMessage[],
  extractReasoning: (content: unknown) => string,
): BaseMessage[] {
  const previousReasoning = new Map<string, string>();
  for (const message of previous) {
    const raw = message as unknown as Record<string, unknown>;
    if (typeof raw['id'] === 'string' && typeof raw['reasoning'] === 'string' && raw['reasoning']) {
      previousReasoning.set(raw['id'], raw['reasoning']);
    }
  }
  return restored.map(message => {
    const raw = message as unknown as Record<string, unknown>;
    if (typeof raw['reasoning'] === 'string' && raw['reasoning']) return message;
    const derived = extractReasoning(raw['content']);
    const reasoning = derived || (typeof raw['id'] === 'string' ? previousReasoning.get(raw['id']) : undefined);
    if (!reasoning) return message;
    return { ...(message as object), reasoning } as unknown as BaseMessage;
  });
}

function execution(toolCallId: string, task: HistoryTask, outstanding: boolean): ChildExecution {
  const taskName = task.name as string;
  const taskId = task.id as string;
  return {
    toolCallId,
    taskName,
    taskId,
    checkpointNs: `${taskName}:${taskId}`,
    outstanding,
    failed: outstanding && typeof task.error === 'string' && task.error.length > 0,
  };
}

function pushTasks(checkpoint: ThreadState<unknown> | undefined): HistoryTask[] {
  const tasks = (checkpoint as { tasks?: unknown } | undefined)?.tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.filter((task): task is HistoryTask =>
    isRecord(task)
    && Array.isArray(task['path'])
    && task['path'][0] === '__pregel_push'
    && typeof task['id'] === 'string'
    && typeof task['name'] === 'string',
  );
}

function latestDispatchedToolCalls(checkpoint: ThreadState<unknown>): unknown[] | undefined {
  const values = (checkpoint as { values?: unknown }).values;
  const messages = isRecord(values) ? values['messages'] : undefined;
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isRecord(message) || (message['type'] !== 'ai' && message['type'] !== 'assistant')) continue;
    const toolCalls = message['tool_calls'];
    return Array.isArray(toolCalls) && toolCalls.length > 0 ? toolCalls : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
