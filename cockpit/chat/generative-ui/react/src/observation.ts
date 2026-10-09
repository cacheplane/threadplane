import type { AgentSnapshot, Message, ToolCall } from '@threadplane/core';
import { copyData, dataKey } from './dashboard-data';
import { renderResult, validToolArgs } from './tool-evidence';
export type GenerativeUiState = AgentSnapshot & {
  readonly values?: Readonly<Record<string, unknown>>;
  readonly history?: readonly {
    readonly checkpoint: unknown;
    readonly next: readonly string[];
  }[];
  readonly interrupts: readonly unknown[];
  readonly subgraphs: readonly unknown[];
};
export function messageKey(message: Message): string {
  return dataKey(
    Object.fromEntries(
      Object.entries(message).filter(([key]) => key !== 'delivery')
    )
  );
}
export interface WrapEvidence {
  readonly callId: string;
  readonly parentId: string;
  readonly resultId: string;
  readonly text: string;
}
/** A turn owns only append-only evidence plus one correlated render transfer. */
export function createObservation(
  text: string,
  messages: readonly Message[] = [],
  tools: readonly ToolCall[] = [],
  previousGenerations: readonly string[] = []
) {
  const base = copyData(messages) as readonly Message[],
    baseTools = copyData(tools) as readonly ToolCall[];
  let previous = base,
    previousTools = baseTools,
    generation: string | undefined,
    human: Message | undefined;
  let live: GenerativeUiState | undefined;
  const wraps = new Map<string, WrapEvidence>();
  const fail = (): never => {
    throw new Error('Unconfirmed turn evidence');
  };
  function observe(input: GenerativeUiState, saved = false): GenerativeUiState {
    const state = copyData(input) as GenerativeUiState;
    if (
      !state ||
      state.error ||
      state.status === 'error' ||
      !Array.isArray(state.messages) ||
      !Array.isArray(state.toolCalls) ||
      !Array.isArray(state.interrupts) ||
      !Array.isArray(state.subgraphs) ||
      state.interrupts.length ||
      state.subgraphs.length
    )
      fail();
    const ms = state.messages,
      ts = state.toolCalls;
    if (
      new Set(ms.map((m) => m.id)).size !== ms.length ||
      new Set(ts.map((t) => t.id)).size !== ts.length ||
      ms.length < previous.length ||
      ts.length < previousTools.length
    )
      fail();
    if (
      base.some((m, i) => !ms[i] || dataKey(m) !== dataKey(ms[i])) ||
      baseTools.some((t, i) => dataKey(t) !== dataKey(ts[i]))
    )
      fail();
    if (
      previous.some((m, i) => m.id !== ms[i].id) ||
      previousTools.some((t, i) => t.id !== ts[i].id)
    )
      fail();
    const suffix = ms.slice(base.length);
    if (suffix.length) {
      const first = suffix[0];
      if (
        first.role !== 'user' ||
        first.content !== text ||
        first.delivery.phase !== 'complete' ||
        suffix.slice(1).some((m) => m.role === 'user')
      )
        fail();
      if (human && messageKey(first) !== messageKey(human)) fail();
      human ??= first;
      generation ??= first.delivery.generation;
      if (
        !generation ||
        previousGenerations.includes(generation) ||
        base.some((m) => m.delivery.generation === generation)
      )
        fail();
    }
    for (const m of ms) {
      if (
        !m.id ||
        typeof m.content !== 'string' ||
        !['user', 'assistant', 'tool'].includes(m.role) ||
        !m.delivery ||
        !['streaming', 'complete'].includes(m.delivery.phase) ||
        (m.delivery.phase === 'complete' && m.delivery.outcome !== 'success') ||
        (m.role !== 'assistant' && m.toolCallIds?.length) ||
        (m.role !== 'tool' && m.toolCallId !== undefined) ||
        (m.role === 'tool' && !m.toolCallId)
      )
        fail();
    }
    if (
      suffix.some((m) => m.delivery.generation !== (saved ? m.id : generation))
    )
      fail();
    for (const t of ts)
      if (
        !t.id ||
        !validToolArgs(t) ||
        !['pending', 'complete'].includes(t.status)
      )
        fail();
    // Capture raw result and the empty owning assistant before either wrapped projection arrives.
    for (const t of ts.slice(baseTools.length)) {
      if (
        t.name !== 'render_spec' ||
        t.status !== 'complete' ||
        wraps.has(t.id)
      )
        continue;
      const parent = ms.find(
        (m) => m.role === 'assistant' && m.toolCallIds?.includes(t.id)
      );
      const result = ms.find((m) => m.role === 'tool' && m.toolCallId === t.id);
      const raw = renderResult(t);
      if (
        parent &&
        result &&
        !parent.content.trim() &&
        raw &&
        result.content === t.result &&
        result.name === t.name
      )
        wraps.set(
          t.id,
          Object.freeze({
            callId: t.id,
            parentId: parent.id,
            resultId: result.id,
            text: raw,
          })
        );
    }
    for (const [i, old] of previous.entries()) {
      const m = ms[i];
      const wrap = [...wraps.values()].find(
        (w) => w.parentId === m.id || w.resultId === m.id
      );
      // Raw tool completion grants one content transfer even when its parent
      // still streams. That grant cannot survive intervening prose or regress.
      if (old.delivery.phase !== 'complete' && wrap?.parentId !== m.id)
        continue;
      if (old.delivery.phase === 'complete' && m.delivery.phase !== 'complete')
        fail();
      if (messageKey(old) === messageKey(m)) continue;
      if (!wrap || messageKey({ ...old, content: m.content }) !== messageKey(m))
        return fail();
      if (
        m.id === wrap.parentId
          ? old.content.trim() !== '' || m.content !== wrap.text
          : renderResult({
              id: wrap.callId,
              name: 'render_spec',
              args: ts.find((t) => t.id === wrap.callId)?.args,
              status: 'complete',
              result: old.content,
            }) !== wrap.text || m.content !== 'rendered'
      )
        fail();
    }
    for (const [i, old] of previousTools.entries()) {
      const t = ts[i];
      if (
        old.name !== t.name ||
        (old.status === 'complete' && dataKey(old.args) !== dataKey(t.args))
      )
        fail();
      if (old.status !== 'complete' || dataKey(old) === dataKey(t)) continue;
      const wrap = wraps.get(t.id);
      if (
        !wrap ||
        renderResult(old) !== wrap.text ||
        t.status !== 'complete' ||
        t.result !== 'rendered' ||
        dataKey({ ...old, result: 'rendered' }) !== dataKey(t)
      )
        fail();
    }
    for (const m of suffix) {
      if (
        m.role === 'tool' &&
        m.content === 'rendered' &&
        m.name === 'render_spec' &&
        !wraps.has(m.toolCallId ?? '')
      )
        fail();
    }
    if (
      saved &&
      (!live ||
        dataKey(live.values) !== dataKey(state.values) ||
        live.messages.length !== ms.length ||
        live.messages.some((m, i) => messageKey(m) !== messageKey(ms[i])))
    )
      fail();
    previous = ms;
    previousTools = ts;
    if (!saved) live = state;
    return state;
  }
  return {
    observe,
    get human() {
      return human;
    },
    get wraps(): readonly WrapEvidence[] {
      return Object.freeze([...wraps.values()]);
    },
    get prefixLength() {
      return base.length;
    },
  };
}
