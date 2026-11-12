import type { ToolActivityInfo } from './tool-activity.js';
import {
  resolveToolOutcome,
  type ToolActivityOutcome,
} from './tool-outcome.js';
import type { SubagentInfo, SubagentMessageInfo } from './subagent-card.js';

/** The fields of one observed child this projection reads; richer native records are accepted as-is. */
export interface SubagentEvidenceRecord {
  readonly started: {
    readonly subagentRunId: string;
    readonly name?: string;
    readonly description?: string;
    readonly parentToolCallId?: string;
  };
  readonly terminal?: { readonly type: string };
}

/** The fields of one transcript message this projection reads; richer native messages are accepted as-is. */
export interface SubagentEvidenceMessage {
  readonly id: string;
  readonly role: string;
  readonly content?: unknown;
  /** Present on messages a child produced. */
  readonly subagentRunId?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly function: { readonly name: string; readonly arguments: string };
  }[];
}

/** Borrowed child evidence and the transcript that carries each child's attributed messages. */
export interface SubagentEvidence<
  TMessage extends SubagentEvidenceMessage = SubagentEvidenceMessage
> {
  readonly subagents: readonly SubagentEvidenceRecord[];
  /**
   * Children that settled in earlier runs or were restored with the thread, such as a native session's
   * `earlierSubagents`. They come first, and a current child with the same run ID replaces its earlier record.
   */
  readonly earlierSubagents?: readonly SubagentEvidenceRecord[];
  readonly transcript: readonly TMessage[];
  /** True while the root run is active. Without it a child with no terminal evidence is `unknown`, not `running`. */
  readonly running?: boolean;
  /** App-authored human labels for the children's own tool calls. */
  readonly toolLabel?: (name: string) => string | undefined;
  /**
   * App-authored outcomes for the children's own completed calls, the same callback `MessageList` takes.
   * Sources an outcome declares are listed in the Sources panel of the message that started the child.
   */
  readonly toolOutcome?: (
    activity: ToolActivityInfo
  ) => ToolActivityOutcome | undefined;
}

/** Card data for each child, earlier children first and each list in start order, and the transcript without the children's messages. */
export interface SubagentProjection<
  TMessage extends SubagentEvidenceMessage = SubagentEvidenceMessage
> {
  readonly subagents: readonly SubagentInfo[];
  /** Root messages only, in their original order and identity. */
  readonly transcript: readonly TMessage[];
}

const text = (content: unknown): string =>
  typeof content === 'string' ? content : '';

/**
 * Group each child's attributed messages under its start evidence, and separate them from the root transcript.
 * Status follows evidence only: finished is complete, an error is error, and a child with no terminal evidence
 * is running while the root run is active and unknown afterwards. An earlier child is never running: `running`
 * describes the current run only. Messages attributed to a child with no start
 * evidence are still removed from the root transcript and belong to no card.
 */
export function subagentsFromEvidence<
  TMessage extends SubagentEvidenceMessage = SubagentEvidenceMessage
>({
  subagents,
  earlierSubagents = [],
  transcript,
  running = false,
  toolLabel,
  toolOutcome,
}: SubagentEvidence<TMessage>): SubagentProjection<TMessage> {
  const root: TMessage[] = [];
  const attributed = new Map<string, TMessage[]>();
  for (const message of transcript) {
    const owner = message.subagentRunId;
    if (typeof owner !== 'string') {
      root.push(message);
      continue;
    }
    const rows = attributed.get(owner);
    if (rows) rows.push(message);
    else attributed.set(owner, [message]);
  }
  const current = new Set(
    subagents.map((child) => child.started.subagentRunId)
  );
  const earlier = earlierSubagents.filter(
    (child) => !current.has(child.started.subagentRunId)
  );
  return {
    transcript: root,
    subagents: [...earlier, ...subagents].map(
      ({ started, terminal }, index) => {
        const status =
          terminal?.type === 'SUBAGENT_FINISHED'
            ? 'complete'
            : terminal?.type === 'SUBAGENT_ERROR'
            ? 'error'
            : running && index >= earlier.length
            ? 'running'
            : 'unknown';
        const rows = attributed.get(started.subagentRunId) ?? [];
        const results = new Map<string, string>();
        for (const row of rows)
          if (row.role === 'tool' && typeof row.toolCallId === 'string')
            results.set(row.toolCallId, text(row.content));
        const messages: SubagentMessageInfo[] = [];
        for (const row of rows) {
          if (row.role === 'reasoning') {
            if (text(row.content))
              messages.push({ id: row.id, reasoning: text(row.content) });
            continue;
          }
          if (row.role !== 'assistant') continue;
          const activities: ToolActivityInfo[] = (row.toolCalls ?? []).map(
            (call) => {
              const activity: ToolActivityInfo = {
                id: call.id,
                name: call.function.name,
                label: toolLabel?.(call.function.name),
                phase: results.has(call.id)
                  ? 'complete'
                  : status === 'running'
                  ? 'running'
                  : 'unknown',
                argumentsText: call.function.arguments,
                resultText: results.get(call.id),
              };
              if (!toolOutcome) return activity;
              let outcome: ToolActivityOutcome | undefined;
              try {
                outcome = toolOutcome(activity);
              } catch {
                // A throwing app hook must not break the card; the call keeps its core phase.
              }
              return outcome ? resolveToolOutcome(activity, outcome) : activity;
            }
          );
          messages.push({
            id: row.id,
            text: text(row.content) || undefined,
            activities: activities.length ? activities : undefined,
          });
        }
        return {
          id: started.subagentRunId,
          toolCallId: started.parentToolCallId,
          name: started.name,
          description: started.description,
          status,
          messages,
        };
      }
    ),
  };
}
