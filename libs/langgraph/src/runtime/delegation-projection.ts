import type { ThreadState } from '@langchain/langgraph-sdk';
import type { ToolCall } from '@threadplane/core';
import type {
  LangGraphDelegation,
  LangGraphSubgraph,
} from './langgraph-snapshot.js';
import type { StreamEvent } from './transport.types.js';
import { record, roleOf } from './wire-message.js';

/** Tool names that start a child agent when the option is omitted. */
export const DEFAULT_SUBAGENT_TOOL_NAMES: readonly string[] = Object.freeze([
  'task',
]);

const validType = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 3 &&
  value.length <= 50 &&
  /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value);

interface DelegationCall {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly status: ToolCall['status'];
}

/** Root tool calls that start a child agent: a configured tool name whose
 * arguments carry a `subagent_type`. */
function delegationCalls(
  toolCalls: readonly ToolCall[],
  names: ReadonlySet<string>
): DelegationCall[] {
  const calls: DelegationCall[] = [];
  for (const call of toolCalls) {
    if (!names.has(call.name)) continue;
    const args = record(call.args);
    const type = args?.['subagent_type'];
    if (!validType(type)) continue;
    const description = args?.['description'];
    calls.push({
      id: call.id,
      name: type,
      ...(typeof description === 'string' && description
        ? { description }
        : {}),
      status: call.status,
    });
  }
  return calls;
}

/** The checkpoint namespace segment of a tool-started child: the one `tools:`
 * segment of a namespace, when it is the last. A namespace with several is a
 * nested delegation, which no root tool call started. */
function toolSegment(namespace: readonly string[]): string | undefined {
  const last = namespace[namespace.length - 1];
  if (!last?.startsWith('tools:')) return undefined;
  return namespace.filter((segment) => segment.startsWith('tools:')).length ===
    1
    ? last
    : undefined;
}

/**
 * The middleware's announcement that pairs a child's checkpoint namespace with
 * the tool call that started it. This is the only link the backend states;
 * everything else in this file infers one.
 */
export function captureDelegationBinding(
  event: StreamEvent
): { readonly segment: string; readonly toolCallId: string } | undefined {
  if (event.type.split('|')[0] !== 'custom') return undefined;
  let payload: Record<string, unknown> | undefined;
  try {
    payload = record(event['data']);
    if (payload?.['type'] !== 'threadplane.subagent_binding') return undefined;
    const segment = payload['namespace'];
    const toolCallId = payload['tool_call_id'];
    return typeof segment === 'string' &&
      segment.startsWith('tools:') &&
      typeof toolCallId === 'string' &&
      toolCallId
      ? { segment, toolCallId }
      : undefined;
  } catch {
    return undefined;
  }
}

const related = new WeakMap<
  LangGraphSubgraph,
  { readonly key: string; readonly subgraph: LangGraphSubgraph }
>();

/**
 * Relates child graphs to the root tool calls that started them. `bindings`
 * maps a `tools:<task id>` namespace segment to a tool call id; it is the
 * session's and is extended here, so a relation never changes once made.
 *
 * A child not yet bound is matched in this order:
 * 1. its first message is the task text of exactly one unbound call;
 * 2. that text contains, or is contained in, one unbound call's task text;
 * 3. exactly one unbound call is still pending or running.
 *
 * With several calls outstanding and nothing to tell them apart, the child is
 * left unrelated: arrival order is not dispatch order.
 */
export function relateSubgraphs(
  subgraphs: readonly LangGraphSubgraph[],
  toolCalls: readonly ToolCall[],
  names: ReadonlySet<string>,
  bindings: Map<string, string>
): readonly LangGraphSubgraph[] {
  if (!subgraphs.length || !names.size) return subgraphs;
  const calls = delegationCalls(toolCalls, names);
  if (!calls.length) return subgraphs;
  let changed = false;
  const result = subgraphs.map((subgraph) => {
    const segment = toolSegment(subgraph.namespace);
    if (!segment) return subgraph;
    let toolCallId = bindings.get(segment);
    if (toolCallId === undefined) {
      const bound = new Set(bindings.values());
      const open = calls.filter((call) => !bound.has(call.id));
      const first = subgraph.messages[0];
      const task = first?.role === 'user' ? first.content : '';
      const match =
        (task
          ? open.find((call) => call.description === task) ??
            open.find(
              (call) =>
                call.description &&
                (task.includes(call.description) ||
                  call.description.includes(task))
            )
          : undefined) ??
        (() => {
          const outstanding = open.filter(
            (call) => call.status === 'pending' || call.status === 'running'
          );
          return outstanding.length === 1 ? outstanding[0] : undefined;
        })();
      if (!match) return subgraph;
      toolCallId = match.id;
      bindings.set(segment, toolCallId);
    }
    const call = calls.find((entry) => entry.id === toolCallId);
    if (!call) return subgraph;
    const delegation: LangGraphDelegation = {
      toolCallId: call.id,
      name: call.name,
      ...(call.description ? { description: call.description } : {}),
      ...(call.status === 'complete' || call.status === 'error'
        ? { status: call.status }
        : subgraph.delegation?.status
        ? { status: subgraph.delegation.status }
        : {}),
    };
    const key = JSON.stringify(delegation);
    const known = related.get(subgraph);
    if (known?.key === key) {
      changed ||= known.subgraph !== subgraph;
      return known.subgraph;
    }
    const next = Object.freeze({ ...subgraph, delegation });
    related.set(subgraph, { key, subgraph: next });
    changed = true;
    return next;
  });
  return changed ? result : subgraphs;
}

/** Where a tool-started child ran, as the saved thread history records it. */
export interface ChildExecution {
  readonly toolCallId: string;
  /** The child's checkpoint namespace, `<task name>:<task id>`. */
  readonly checkpointNs: string;
  /** The task has no result in the newest checkpoint. */
  readonly outstanding: boolean;
  /** That outstanding task carries an error. */
  readonly failed: boolean;
}

function pushTasks(saved: ThreadState | undefined) {
  const tasks = record(saved)?.['tasks'];
  if (!Array.isArray(tasks)) return [];
  return tasks.flatMap((value) => {
    const task = record(value);
    const path = task?.['path'];
    return task &&
      Array.isArray(path) &&
      path[0] === '__pregel_push' &&
      typeof task['id'] === 'string' &&
      typeof task['name'] === 'string'
      ? [task]
      : [];
  });
}

/**
 * Maps tool calls to the tasks that ran them, from a history page (newest
 * first). A finished task's result holds the tool message that names its call,
 * which is exact and is collected first. A task still outstanding in the newest
 * checkpoint is aligned by its send index with the tool calls of the newest
 * assistant message. A call neither rule resolves is left out.
 */
export function mapChildExecutions(
  history: readonly ThreadState[],
  toolCallIds: ReadonlySet<string>
): ReadonlyMap<string, ChildExecution> {
  const found = new Map<string, ChildExecution>();
  if (!toolCallIds.size || !history.length) return found;
  const execution = (
    toolCallId: string,
    task: Record<string, unknown>,
    outstanding: boolean
  ): ChildExecution => ({
    toolCallId,
    checkpointNs: `${task['name'] as string}:${task['id'] as string}`,
    outstanding,
    failed:
      outstanding && typeof task['error'] === 'string' && !!task['error'],
  });
  for (const saved of history)
    for (const task of pushTasks(saved)) {
      const messages = record(task['result'])?.['messages'];
      if (!Array.isArray(messages)) continue;
      for (const value of messages) {
        const message = record(value);
        const id = message?.['tool_call_id'];
        if (
          !message ||
          roleOf(message) !== 'tool' ||
          typeof id !== 'string' ||
          !toolCallIds.has(id) ||
          found.has(id)
        )
          continue;
        found.set(id, execution(id, task, false));
      }
    }
  const latest = history[0];
  const outstanding = pushTasks(latest).filter(
    (task) => task['result'] === undefined || task['result'] === null
  );
  if (!outstanding.length) return found;
  const messages = record(record(latest)?.['values'])?.['messages'];
  if (!Array.isArray(messages)) return found;
  let dispatched: unknown[] | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = record(messages[index]);
    if (!message || roleOf(message) !== 'assistant') continue;
    const calls = message['tool_calls'];
    dispatched = Array.isArray(calls) && calls.length ? calls : undefined;
    break;
  }
  if (!dispatched) return found;
  for (const task of outstanding) {
    const index = (task['path'] as unknown[])[1];
    if (typeof index !== 'number') continue;
    const id = record(dispatched[index])?.['id'];
    if (typeof id !== 'string' || !toolCallIds.has(id) || found.has(id))
      continue;
    found.set(id, execution(id, task, true));
  }
  return found;
}

/** The ids and task details of every root delegation call. */
export function delegationCallIds(
  toolCalls: readonly ToolCall[],
  names: ReadonlySet<string>
): ReadonlySet<string> {
  return new Set(delegationCalls(toolCalls, names).map((call) => call.id));
}

/** The delegation a restored child carries before any stream relates it. */
export function restoredDelegation(
  toolCalls: readonly ToolCall[],
  names: ReadonlySet<string>,
  toolCallId: string,
  execution?: ChildExecution
): LangGraphDelegation | undefined {
  const call = delegationCalls(toolCalls, names).find(
    (entry) => entry.id === toolCallId
  );
  if (!call) return undefined;
  const status =
    call.status === 'complete' || call.status === 'error'
      ? call.status
      : execution?.failed
      ? 'error'
      : execution?.outstanding
      ? 'running'
      : undefined;
  return {
    toolCallId: call.id,
    name: call.name,
    ...(call.description ? { description: call.description } : {}),
    ...(status ? { status } : {}),
  };
}
