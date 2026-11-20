import type { AgentSubagent, ToolCall } from '@threadplane/core';
import type { SubagentInfo, SubagentMessageInfo } from './subagent-card.js';
import { toolActivityPhase, type ToolActivityInfo } from './tool-activity.js';
import {
  resolveToolOutcome,
  type ToolActivityOutcome,
} from './tool-outcome.js';

/** App-authored presentation for the children's own tool calls. */
export interface SessionSubagentOptions {
  readonly toolLabel?: (name: string, args?: unknown) => string | undefined;
  readonly toolOutcome?: (
    activity: ToolActivityInfo
  ) => ToolActivityOutcome | undefined;
}

/** Argument and result text, as `MessageList` shows it for root calls. */
const literal = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';

function card(
  child: AgentSubagent,
  { toolLabel, toolOutcome }: SessionSubagentOptions
): SubagentInfo {
  const calls = new Map<string, ToolCall>(
    child.toolCalls.map((call) => [call.id, call])
  );
  const running = child.status === 'running';
  const messages: SubagentMessageInfo[] = [];
  for (const message of child.messages) {
    if (message.role !== 'assistant') continue;
    const activities: ToolActivityInfo[] = [];
    for (const id of message.toolCallIds ?? []) {
      const call = calls.get(id);
      if (!call) continue;
      const activity: ToolActivityInfo = {
        id: call.id,
        name: call.name,
        label: toolLabel?.(call.name, call.args),
        phase: toolActivityPhase(call.status, message.delivery, running),
        argumentsText: literal(call.args),
        resultText:
          call.status === 'complete' ? literal(call.result) : undefined,
        errorText: call.status === 'error' ? call.error : undefined,
      };
      let outcome: ToolActivityOutcome | undefined;
      try {
        outcome = toolOutcome?.(activity);
      } catch {
        // A throwing app hook must not break the card; the call keeps its phase.
      }
      activities.push(
        outcome ? resolveToolOutcome(activity, outcome) : activity
      );
    }
    const text = message.content || undefined;
    const reasoning = message.reasoning || undefined;
    if (!text && !reasoning && !activities.length) continue;
    messages.push({
      id: message.id,
      ...(text && { text }),
      ...(reasoning && { reasoning }),
      ...(activities.length && { activities }),
    });
  }
  return {
    id: child.id,
    ...(child.toolCallId !== undefined && { toolCallId: child.toolCallId }),
    ...(child.name !== undefined && { name: child.name }),
    ...(child.description !== undefined && {
      description: child.description,
    }),
    status: child.status,
    messages,
    ...(child.error !== undefined && { errorSummary: child.error }),
  };
}

interface Known {
  readonly options: SessionSubagentOptions;
  readonly info: SubagentInfo;
}
const cards = new WeakMap<AgentSubagent, Known>();
const lists = new WeakMap<
  readonly AgentSubagent[],
  {
    readonly options: SessionSubagentOptions;
    readonly list: readonly SubagentInfo[];
  }
>();
const same = (a: SessionSubagentOptions, b: SessionSubagentOptions) =>
  a.toolLabel === b.toolLabel && a.toolOutcome === b.toolOutcome;

/**
 * Card data for the child agents a session reports in `snapshot.subagents`.
 * A child whose reference is unchanged keeps its card's reference, and an
 * unchanged list keeps its own, while the two callbacks stay the same.
 */
export function sessionSubagents(
  children: readonly AgentSubagent[],
  options: SessionSubagentOptions = {}
): readonly SubagentInfo[] {
  const known = lists.get(children);
  if (known && same(known.options, options)) return known.list;
  const list = children.map((child) => {
    const before = cards.get(child);
    if (before && same(before.options, options)) return before.info;
    const info = card(child, options);
    cards.set(child, { options, info });
    return info;
  });
  lists.set(children, { options, list });
  return list;
}
