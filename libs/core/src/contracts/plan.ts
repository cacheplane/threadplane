/** One step of the plan an agent declared for its work. */
export interface AgentPlanStep {
  /** The step in the agent's own words, such as "Compare the two drafts". */
  readonly label: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

const STATUSES = new Set<string>(['pending', 'in_progress', 'completed']);

/**
 * Reads a plan from agent state: the `todos` list a deep-agents style to-do
 * tool writes, `[{ content, status }]`. Entries without text or with an unknown
 * status are skipped. Undefined when the state holds no such list.
 */
export function agentPlanFromState(
  state: unknown
): readonly AgentPlanStep[] | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const todos = (state as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return undefined;
  return todos.flatMap((todo): AgentPlanStep[] => {
    if (!todo || typeof todo !== 'object') return [];
    const { content, status } = todo as { content?: unknown; status?: unknown };
    if (
      typeof content !== 'string' ||
      !content.trim() ||
      typeof status !== 'string' ||
      !STATUSES.has(status)
    )
      return [];
    return [
      { label: content.trim(), status: status as AgentPlanStep['status'] },
    ];
  });
}
