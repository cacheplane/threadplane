import type { AgentStatus, AgentSubagent } from '@threadplane/core';
import type { LangGraphSubgraph } from './langgraph-snapshot.js';

/**
 * A child graph as a core child agent. `id` is the child's namespace path as
 * JSON, which stays unique whatever a segment contains, and `name` is the node
 * that started it. LangGraph does not
 * relate a child graph to a tool call, so `toolCallId` and `description` are
 * never set.
 */
export type LangGraphSubagent = AgentSubagent & {
  /** The child graph's full namespace path, as in `subgraphs`. */
  readonly namespace: readonly string[];
};

/** A namespace segment is `node:task`; a node name may itself hold no colon. */
function nodeOf(segment: string): string {
  const at = segment.indexOf(':');
  return at < 0 ? segment : segment.slice(0, at);
}

/**
 * - A child that failed is `error`.
 * - While the root run is going, a child is `running`.
 * - After it, the child's last message decides: a successful one is
 *   `complete`, and one a pause stopped is still `running`, because a resume
 *   continues it. Anything else, and a child with no messages, is `unknown`.
 */
function statusOf(
  child: LangGraphSubgraph,
  running: boolean
): AgentSubagent['status'] {
  if (child.error) return 'error';
  if (running) return 'running';
  const last = child.messages.at(-1)?.delivery;
  if (last?.phase !== 'complete') return 'unknown';
  if (last.outcome === 'success') return 'complete';
  return last.outcome === 'paused' ? 'running' : 'unknown';
}

const projected = new WeakMap<
  LangGraphSubgraph,
  Partial<Record<AgentSubagent['status'], LangGraphSubagent>>
>();
const none: readonly LangGraphSubagent[] = Object.freeze([]);

/**
 * The session's child graphs as core child agents, in the order they were
 * first observed. A child keeps its reference while its child graph and status
 * are unchanged, and the list keeps its own while every child does.
 */
export function projectSubagents(
  subgraphs: readonly LangGraphSubgraph[],
  status: AgentStatus,
  previous: readonly LangGraphSubagent[] = none
): readonly LangGraphSubagent[] {
  if (!subgraphs.length) return previous.length ? none : previous;
  const running = status === 'running';
  let changed = previous.length !== subgraphs.length;
  const children = subgraphs.map((child, index) => {
    const state = statusOf(child, running);
    let known = projected.get(child);
    if (!known) projected.set(child, (known = {}));
    let subagent = known[state];
    if (!subagent) {
      const { namespace } = child;
      const message = child.error?.message;
      subagent = Object.freeze({
        id: JSON.stringify(namespace),
        name: nodeOf(namespace[namespace.length - 1] ?? ''),
        ...(namespace.length > 1 && {
          parentId: JSON.stringify(namespace.slice(0, -1)),
        }),
        status: state,
        messages: child.messages,
        toolCalls: child.toolCalls,
        ...(state === 'error' && message && { error: message }),
        namespace,
      });
      known[state] = subagent;
    }
    if (previous[index] !== subagent) changed = true;
    return subagent;
  });
  return changed ? Object.freeze(children) : previous;
}
