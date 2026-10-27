import {
  ConversationBudget,
  copyData,
  displayUnits,
  LIMITS,
  literal,
  record,
  text,
  validMessageMetadata,
} from './authority';

export interface ToolCard {
  readonly id: string;
  readonly name: string;
  readonly kind: 'task' | 'tool';
  readonly description?: string;
  readonly subagentType?: string;
  readonly fields: 'available' | 'unavailable';
  readonly argumentsText: string;
  readonly resultText?: string;
  readonly resultStatus?: 'success' | 'error';
  /** Native complete describes resolved delivery, not raw execution success. */
  readonly status: string;
}
export interface ParentProjection {
  readonly status: 'available' | 'incomplete';
  readonly reason?: string;
  readonly taskCount: number;
  readonly cards: ReadonlyMap<string, readonly ToolCard[]>;
}

/** Literal parent observations ordered by the one declaring assistant's call IDs.
 * Use one conversation ledger and one stable parent scope across followups. */
export function projectParentObservations(
  observedMessages: unknown,
  observedTools: unknown,
  budget: ConversationBudget,
  scope = 'parents',
  rawStatuses?: unknown
): ParentProjection {
  const cards = new Map<string, readonly ToolCard[]>();
  let taskCount = 0;
  try {
    const data = copyData({
      messages: observedMessages,
      tools: observedTools,
      rawStatuses,
    }) as { messages: unknown; tools: unknown; rawStatuses: unknown };
    if (
      !Array.isArray(data.messages) ||
      !Array.isArray(data.tools) ||
      (data.rawStatuses !== undefined && !record(data.rawStatuses))
    )
      throw new Error('Unavailable parent data');
    const messages = data.messages,
      tools = data.tools,
      ids = new Set<string>(),
      catalog = new Map<string, Record<string, unknown>>(),
      owners = new Map<string, { id: string; index: number }>(),
      results = new Map<
        string,
        { message: Record<string, unknown>; index: number }
      >();
    let units = 0;
    for (const [index, m] of messages.entries()) {
      if (
        !record(m) ||
        !text(m.id) ||
        ids.has(m.id) ||
        typeof m.content !== 'string' ||
        !validMessageMetadata(m) ||
        !['user', 'assistant', 'tool', 'system'].includes(m.role as string)
      )
        throw new Error('Invalid parent message identity');
      ids.add(m.id);
      if (
        !record(m.delivery) ||
        !text(m.delivery.generation) ||
        !['streaming', 'complete'].includes(m.delivery.phase as string) ||
        (m.delivery.phase === 'streaming' &&
          m.delivery.outcome !== undefined) ||
        (m.delivery.phase === 'complete' &&
          !['success', 'error', 'aborted', 'interrupted', 'paused'].includes(
            m.delivery.outcome as string
          ))
      )
        throw new Error('Unavailable parent delivery');
      units += displayUnits([
        m.id,
        m.role as string,
        m.content,
        typeof m.name === 'string' ? m.name : '',
        typeof m.reasoning === 'string' ? m.reasoning : '',
        ...(m.citations === undefined ? [] : [literal(m.citations)]),
      ]);
      if (m.role === 'assistant') {
        const calls = m.toolCallIds ?? [];
        if (!Array.isArray(calls)) throw new Error('Unavailable declaration');
        for (const id of calls) {
          if (!text(id) || owners.has(id))
            throw new Error('Ambiguous tool ownership');
          owners.set(id, { id: m.id, index });
        }
      } else if (
        m.toolCallIds !== undefined &&
        (!Array.isArray(m.toolCallIds) || m.toolCallIds.length)
      )
        throw new Error('Unexpected declaration');
      if (m.role === 'tool' || m.toolCallId !== undefined) {
        if (
          m.role !== 'tool' ||
          !text(m.toolCallId) ||
          results.has(m.toolCallId)
        )
          throw new Error('Ambiguous result');
        results.set(m.toolCallId, { message: m, index });
      }
    }
    for (const t of tools) {
      if (
        !record(t) ||
        !text(t.id) ||
        !text(t.name) ||
        catalog.has(t.id) ||
        !Object.hasOwn(t, 'args') ||
        !['pending', 'running', 'complete', 'error'].includes(
          t.status as string
        )
      )
        throw new Error('Invalid tool catalog');
      catalog.set(t.id, t);
    }
    if (
      catalog.size !== owners.size ||
      [...owners.keys()].some((id) => !catalog.has(id))
    )
      throw new Error('Incomplete tool ownership');
    for (const m of messages) {
      if (!record(m) || m.role !== 'assistant') continue;
      const list: ToolCard[] = [];
      for (const id of (m.toolCallIds ?? []) as string[]) {
        const t = catalog.get(id),
          owner = owners.get(id),
          result = results.get(id);
        if (!t || !owner) throw new Error('Incomplete tool ownership');
        const rawStatus = record(data.rawStatuses)
          ? data.rawStatuses[id]
          : undefined;
        if (
          result &&
          (result.index <= owner.index ||
            messages
              .slice(owner.index + 1, result.index)
              .some(
                (v) =>
                  record(v) && (v.role === 'user' || v.role === 'assistant')
              ) ||
            (result.message.name !== t.name &&
              !(rawStatus === 'error' && result.message.name === undefined)))
        )
          throw new Error('Result crossed declaration batch');
        let resultText: string | undefined;
        if (t.status === 'complete') {
          if (
            !result ||
            typeof t.result !== 'string' ||
            result.message.content !== t.result
          )
            throw new Error('Unavailable resolved result');
          resultText = t.result;
        } else if (t.status === 'error') {
          if (typeof t.error !== 'string' || result)
            throw new Error('Unavailable tool error');
          resultText = t.error;
        } else if (
          result ||
          (Object.hasOwn(t, 'result') && t.result !== undefined)
        )
          throw new Error('Contradictory unresolved result');
        const kind = t.name === 'task' ? 'task' : 'tool';
        if (kind === 'task') taskCount++;
        const args = t.args,
          description =
            record(args) && typeof args.description === 'string'
              ? args.description
              : undefined,
          subagentType =
            record(args) && typeof args.subagent_type === 'string'
              ? args.subagent_type
              : undefined;
        const fields =
          kind === 'task' &&
          record(args) &&
          Object.keys(args).length === 2 &&
          text(description) &&
          ['field-researcher', 'weather-analyst', 'general-purpose'].includes(
            subagentType ?? ''
          )
            ? 'available'
            : 'unavailable';
        // Arguments can contain multiple individually bounded fields. The whole
        // literal representation remains subject to the conversation budget.
        const argumentsText = literal(args, LIMITS.displayText);
        if (argumentsText.length > LIMITS.displayText)
          throw new Error('Arguments display limit');
        if (
          rawStatus !== undefined &&
          rawStatus !== 'success' &&
          rawStatus !== 'error'
        )
          throw new Error('Unavailable raw result status');
        const card: ToolCard = Object.freeze({
          id,
          name: t.name as string,
          kind,
          fields,
          argumentsText,
          status: t.status as string,
          ...(description === undefined ? {} : { description }),
          ...(subagentType === undefined ? {} : { subagentType }),
          ...(resultText === undefined
            ? {}
            : { resultText: literal(resultText) }),
          ...(rawStatus === undefined ? {} : { resultStatus: rawStatus }),
        });
        units +=
          argumentsText.length +
          displayUnits([
            id,
            t.name as string,
            description ?? '',
            subagentType ?? '',
            resultText ?? '',
            card.fields,
            card.status,
            card.kind,
            (rawStatus as string) ?? '',
          ]);
        list.push(card);
      }
      if (list.length) {
        units += displayUnits([m.id as string]);
        cards.set(m.id as string, Object.freeze(list));
      }
    }
    if (
      [...results.keys()].some((id) => !catalog.has(id)) ||
      !budget.replace(scope, taskCount, 0, units)
    )
      throw new Error('Conversation observation limit');
    return Object.freeze({ status: 'available', taskCount, cards });
  } catch (e) {
    // A count from a partial or ambiguous catalog must not appear complete.
    return Object.freeze({
      status: 'incomplete',
      reason: e instanceof Error ? e.message : 'Unavailable parent data',
      taskCount: 0,
      cards: new Map<string, readonly ToolCard[]>(),
    });
  }
}
