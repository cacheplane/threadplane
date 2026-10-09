import type { Message, ToolCall } from '@threadplane/core';
import type { RenderSpecData } from '@threadplane/react/render';
import {
  copyData,
  dataKey,
  dashboardState,
  plainRecord,
  type DashboardState,
} from './dashboard-data';
import { dashboardSpec } from './dashboard-spec';
import { renderResult, toolData } from './tool-evidence';
import type { GenerativeUiState, createObservation } from './observation';
export interface Checkpoint {
  readonly thread_id: string;
  readonly checkpoint_ns: '';
  readonly checkpoint_id: string;
  readonly checkpoint_map?: Readonly<Record<string, string>>;
}
export interface Surface {
  readonly messageId: string;
  readonly spec: RenderSpecData;
}
export interface Notice {
  readonly messageId: string;
  readonly text: string;
}
export interface Confirmation {
  readonly messages: readonly Message[];
  readonly tools: readonly ToolCall[];
  readonly dashboard: DashboardState;
  readonly surfaces: readonly Surface[];
  readonly notices: readonly Notice[];
}
export function checkpointSource(
  input: unknown,
  threadId: string
): Checkpoint | undefined {
  const value = copyData(input);
  if (
    !plainRecord(value) ||
    value.thread_id !== threadId ||
    value.checkpoint_ns !== '' ||
    typeof value.checkpoint_id !== 'string' ||
    !value.checkpoint_id ||
    Object.keys(value).some(
      (k) =>
        ![
          'thread_id',
          'checkpoint_ns',
          'checkpoint_id',
          'checkpoint_map',
        ].includes(k)
    )
  )
    return;
  if (
    value.checkpoint_map !== undefined &&
    (!plainRecord(value.checkpoint_map) ||
      Object.values(value.checkpoint_map).some((v) => typeof v !== 'string'))
  )
    return;
  if (
    plainRecord(value.checkpoint_map) &&
    Object.entries(value.checkpoint_map).some(
      ([k, v]) => k !== '' || v !== value.checkpoint_id
    )
  )
    return;
  return value as unknown as Checkpoint;
}
const empty = (value: unknown) =>
  value === undefined || (Array.isArray(value) && !value.length);
function clean(record: Record<string, unknown>) {
  return (
    (record.error === undefined || record.error === null) &&
    ['interrupts', '__interrupt__', 'subgraphs'].every((k) => empty(record[k]))
  );
}
/** Confirm raw task-free checkpoint against the loaded projection and tool-derived data. */
export function captureTerminal(
  input: GenerativeUiState,
  checkpoint: unknown,
  threadId: string,
  observation: ReturnType<typeof createObservation>,
  previous: DashboardState,
  surfaces: readonly Surface[],
  knownRunId?: string
): Confirmation | undefined {
  try {
    const state = copyData(input) as GenerativeUiState,
      raw = copyData(checkpoint);
    const requested = checkpointSource(
      state.history?.[0]?.checkpoint,
      threadId
    );
    if (
      !requested ||
      !plainRecord(raw) ||
      dataKey(checkpointSource(raw.checkpoint, threadId)) !==
        dataKey(requested) ||
      !Array.isArray(raw.next) ||
      raw.next.length ||
      !Array.isArray(raw.tasks) ||
      raw.tasks.length ||
      !clean(raw) ||
      state.status !== 'idle' ||
      state.error ||
      state.interrupts.length ||
      state.subgraphs.length ||
      state.history?.[0].next.length
    )
      return;
    if (
      knownRunId &&
      ((raw.run_id !== undefined && raw.run_id !== knownRunId) ||
        (plainRecord(raw.metadata) &&
          raw.metadata.run_id !== undefined &&
          raw.metadata.run_id !== knownRunId))
    )
      return;
    const values = raw.values;
    if (
      !plainRecord(values) ||
      !clean(values) ||
      !Array.isArray(values.messages)
    )
      return;
    const projected = Object.fromEntries(
      Object.entries(values).filter(
        ([k]) => k !== 'messages' && k !== '__interrupt__'
      )
    );
    if (dataKey(projected) !== dataKey(state.values)) return;
    const ms = state.messages,
      ts = state.toolCalls;
    if (
      !observation.human ||
      !ms.length ||
      ms.at(-1)?.role !== 'assistant' ||
      !ms.at(-1)?.content.trim() ||
      values.completed_turn_id !== observation.human.id ||
      values.completed_answer_id !== ms.at(-1)?.id ||
      dataKey(values.completed_message_ids) !== dataKey(ms.map((m) => m.id)) ||
      values.messages.length !== ms.length
    )
      return;
    if (
      ms.some(
        (m) =>
          m.delivery.phase !== 'complete' ||
          m.delivery.outcome !== 'success' ||
          m.delivery.generation !== m.id
      ) ||
      ts.some((t) => t.status !== 'complete' || typeof t.result !== 'string')
    )
      return;
    const calls = new Map(ts.map((t) => [t.id, t])),
      pending = new Set<string>(),
      seen = new Set<string>();
    let dashboard: DashboardState = dashboardState(previous) ?? {};
    const accepted = [...surfaces];
    const notices: Notice[] = [];
    for (const [index, m] of ms.entries()) {
      const wire = values.messages[index];
      if (
        !plainRecord(wire) ||
        !clean(wire) ||
        wire.id !== m.id ||
        wire.content !== m.content ||
        wire.type !==
          (m.role === 'user'
            ? 'human'
            : m.role === 'assistant'
            ? 'ai'
            : 'tool') ||
        !empty(wire.invalid_tool_calls)
      )
        return;
      if (
        wire.additional_kwargs !== undefined &&
        (!plainRecord(wire.additional_kwargs) ||
          wire.additional_kwargs.function_call !== undefined ||
          !empty(wire.additional_kwargs.tool_calls))
      )
        return;
      const extra = plainRecord(wire.additional_kwargs)
        ? wire.additional_kwargs
        : {};
      const reasoning =
        typeof wire.reasoning === 'string'
          ? wire.reasoning
          : typeof extra.reasoning_content === 'string'
          ? extra.reasoning_content
          : undefined;
      if (
        m.name !== (typeof wire.name === 'string' ? wire.name : undefined) ||
        m.reasoning !== reasoning ||
        m.citations?.length ||
        [extra.citations, extra.sources].some(
          (value) => Array.isArray(value) && value.length > 0
        )
      )
        return;
      if (m.role === 'assistant') {
        const ids = m.toolCallIds ?? [],
          rawCalls = wire.tool_calls ?? [];
        if (
          !Array.isArray(rawCalls) ||
          rawCalls.length !== ids.length ||
          pending.size
        )
          return;
        for (const [i, id] of ids.entries()) {
          const t = calls.get(id),
            r = rawCalls[i];
          if (
            !t ||
            seen.has(id) ||
            !plainRecord(r) ||
            r.id !== id ||
            r.name !== t.name ||
            dataKey(r.args) !== dataKey(t.args)
          )
            return;
          pending.add(id);
          seen.add(id);
        }
      } else if (m.role === 'tool') {
        const id = m.toolCallId ?? '',
          t = calls.get(id);
        if (
          !t ||
          t.status !== 'complete' ||
          !pending.delete(id) ||
          m.name !== t.name ||
          m.content !== t.result ||
          wire.tool_call_id !== id ||
          wire.name !== t.name ||
          (wire.status !== undefined && wire.status !== 'success')
        )
          return;
        if (index < observation.prefixLength) continue;
        const parent = ms
          .slice(0, index)
          .find((p) => p.toolCallIds?.includes(id));
        if (!parent) return;
        if (t.name === 'render_spec') {
          const spec = dashboardSpec(t.args);
          if (!spec) return;
          if (t.result === 'rendered') {
            const wrap = observation.wraps.find((w) => w.callId === id);
            if (
              !wrap ||
              wrap.parentId !== parent.id ||
              wrap.resultId !== m.id ||
              parent.content !== wrap.text
            )
              return;
            accepted.push(Object.freeze({ messageId: parent.id, spec }));
          } else {
            if (!parent.content.trim() || !renderResult(t)) return;
            notices.push(
              Object.freeze({
                messageId: parent.id,
                text: 'This layout was not applied because the assistant already supplied prose. The tool result is available for inspection.',
              })
            );
          }
        } else {
          const patch = toolData(t);
          if (!patch) return;
          dashboard = Object.freeze({ ...dashboard, ...patch });
        }
      } else if (
        m.role !== 'user' ||
        pending.size ||
        !empty(wire.tool_calls) ||
        wire.tool_call_id !== undefined
      )
        return;
    }
    const savedDashboard = dashboardState(values.dashboard);
    if (
      pending.size ||
      seen.size !== ts.length ||
      !savedDashboard ||
      dataKey(savedDashboard) !== dataKey(dashboard)
    )
      return;
    return Object.freeze({
      messages: ms,
      tools: ts,
      dashboard: savedDashboard,
      surfaces: Object.freeze(accepted),
      notices: Object.freeze(notices),
    });
  } catch {
    return undefined;
  }
}
