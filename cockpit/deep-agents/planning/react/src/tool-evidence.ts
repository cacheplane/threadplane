import { copyJson, plainRecord, planState, type PlanItem } from './plan-state';

export type WriteEvidence =
  | { readonly kind: 'none' | 'rejected' | 'invalid' }
  | {
      readonly kind: 'replacement';
      readonly items: readonly PlanItem[];
      readonly callId: string;
    };

/** Inspect actual canonical wire messages. Core ToolCall.complete cannot
 * establish success: history projection also completes raw error results. */
export function writeEvidence(input: unknown, humanId: string): WriteEvidence {
  const invalid: WriteEvidence = Object.freeze({ kind: 'invalid' });
  try {
    const messages = copyJson(input);
    if (!Array.isArray(messages) || !humanId) return invalid;
    const messageIds = new Set<string>();
    for (const message of messages) {
      if (
        !plainRecord(message) ||
        typeof message.id !== 'string' ||
        !message.id ||
        messageIds.has(message.id)
      )
        return invalid;
      messageIds.add(message.id);
    }
    const start = messages.findIndex(
      (m) => m.id === humanId && m.type === 'human'
    );
    if (start < 0) return invalid;
    const pending = new Map<
      string,
      { name: string; args: unknown; parallel: boolean }
    >();
    // Prior IDs cannot be reused in the current turn.
    const seen = new Set<string>();
    for (const message of messages.slice(0, start)) {
      if (Array.isArray(message.tool_calls))
        for (const call of message.tool_calls) {
          if (
            !plainRecord(call) ||
            typeof call.id !== 'string' ||
            seen.has(call.id)
          )
            return invalid;
          seen.add(call.id);
        }
    }
    let result: WriteEvidence = Object.freeze({ kind: 'none' });
    for (const [index, message] of messages.slice(start).entries()) {
      if (
        typeof message.content !== 'string' ||
        !empty(message.invalid_tool_calls)
      )
        return invalid;
      const extra = message.additional_kwargs;
      if (
        extra !== undefined &&
        (!plainRecord(extra) ||
          extra.function_call !== undefined ||
          !empty(extra.tool_calls))
      )
        return invalid;
      if (message.type === 'human') {
        if (
          index !== 0 ||
          pending.size ||
          !empty(message.tool_calls) ||
          message.tool_call_id !== undefined
        )
          return invalid;
      } else if (message.type === 'ai') {
        if (pending.size || message.tool_call_id !== undefined) return invalid;
        const calls = message.tool_calls ?? [];
        if (!Array.isArray(calls)) return invalid;
        const parallel =
          calls.filter(
            (call) => plainRecord(call) && call.name === 'write_todos'
          ).length > 1;
        for (const call of calls) {
          if (
            !plainRecord(call) ||
            typeof call.id !== 'string' ||
            !call.id ||
            seen.has(call.id) ||
            typeof call.name !== 'string' ||
            !call.name ||
            !plainRecord(call.args) ||
            (call.type !== undefined && call.type !== 'tool_call')
          )
            return invalid;
          pending.set(call.id, { name: call.name, args: call.args, parallel });
          seen.add(call.id);
        }
      } else if (message.type === 'tool') {
        if (
          typeof message.tool_call_id !== 'string' ||
          !empty(message.tool_calls)
        )
          return invalid;
        const call = pending.get(message.tool_call_id);
        if (!call || !['success', 'error'].includes(message.status as string))
          return invalid;
        if (
          message.name !== call.name &&
          !(
            message.status === 'error' &&
            (message.name === null || message.name === undefined)
          )
        )
          return invalid;
        pending.delete(message.tool_call_id);
        if (call.name === 'write_todos') {
          if (message.status === 'error')
            result = Object.freeze({ kind: 'rejected' });
          else {
            const plan = planState(call.args);
            if (
              call.parallel ||
              plan.kind !== 'valid' ||
              Object.keys(call.args as object).length !== 1
            )
              return invalid;
            result = Object.freeze({
              kind: 'replacement',
              items: plan.items,
              callId: message.tool_call_id,
            });
          }
        }
      } else return invalid;
    }
    return pending.size ? invalid : result;
  } catch {
    return invalid;
  }
}

function empty(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}
