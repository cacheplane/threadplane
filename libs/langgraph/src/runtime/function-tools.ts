import type { PlainValue, ToolCall } from '@threadplane/core';
import type {
  FunctionToolDefinition,
  ToolExecutionKey,
  ToolExecutionResult,
  ToolExecutionStore,
} from '@threadplane/core/tools';
import { ownToolCall, ownValue } from './ownership';

export interface ToolMessage {
  readonly id: string;
  readonly role: 'tool';
  readonly type: 'tool';
  readonly tool_call_id: string;
  readonly content: string;
}

export function captureTools(
  tools: Readonly<Record<string, FunctionToolDefinition>> = {}
) {
  const definitions = new Map(
    Object.entries(tools).map(
      ([name, def]) =>
        [
          name,
          {
            description: def.description,
            parameters:
              def.parameters === undefined
                ? undefined
                : ownValue(def.parameters),
            handler: def.handler,
            followUp: def.followUp !== false,
            idempotent: def.idempotent === true,
          },
        ] as const
    )
  );
  const catalog = Object.freeze(
    [...definitions].map(([name, def]) =>
      Object.freeze({
        name,
        description: def.description,
        ...(def.parameters !== undefined ? { parameters: def.parameters } : {}),
      })
    )
  );
  return { definitions, catalog };
}

export function cancelledResult(id: string): ToolExecutionResult {
  return {
    ok: false,
    error: `Client tool execution cancelled before completion: ${id}`,
  };
}

function guardFailure(id: string, error: unknown): ToolExecutionResult {
  return {
    ok: false,
    error: `Client tool execution guard failed for ${id}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}

export type ExecutionOutcome<T> =
  | { readonly type: 'completed'; readonly value: T }
  | { readonly type: 'aborted' };

/** Observe both promise branches, including a handler that rejects after stop. */
async function untilAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<ExecutionOutcome<T>> {
  let abort: () => void = () => undefined;
  const cancelled = new Promise<ExecutionOutcome<T>>((resolve) => {
    abort = () => resolve({ type: 'aborted' });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([
      cancelled,
      promise.then(
        (value): ExecutionOutcome<T> =>
          signal.aborted ? { type: 'aborted' } : { type: 'completed', value }
      ),
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/** One call, owned by one command. Claim/record may outlive the command: a late
 * acquired claim must record cancellation, while a record already in flight
 * keeps its original result. The caller controls stale UI and run publication. */
export async function executeTool(
  definition: ReturnType<typeof captureTools>['definitions'] extends Map<
    string,
    infer D
  >
    ? D
    : never,
  call: ToolCall,
  signal: AbortSignal,
  key: ToolExecutionKey,
  store?: ToolExecutionStore,
  blocked = false
): Promise<ToolExecutionResult> {
  if (signal.aborted) return cancelledResult(call.id);
  const guard = definition.idempotent ? undefined : store;
  async function record(result: ToolExecutionResult) {
    if (!guard) return result;
    const captured = ownResult(result);
    try {
      await guard.record(key, captured);
      return captured;
    } catch (error) {
      return guardFailure(call.id, error);
    }
  }
  if (guard) {
    try {
      const claim = await guard.claim(key);
      if (signal.aborted) {
        if (claim === 'claimed') return record(cancelledResult(call.id));
        // Prior completed facts belong to the durable store, not the cancelled
        // attempt. Reuse them without invoking a handler or overwriting a row.
        if (claim.status === 'done') return ownResult(claim.result);
        if (claim.status === 'failed' && claim.result)
          return ownResult(claim.result);
        return cancelledResult(call.id);
      }
      if (claim !== 'claimed') {
        if (claim.status === 'done') return ownResult(claim.result);
        return record(
          claim.status === 'failed' && claim.result
            ? ownResult(claim.result)
            : {
                ok: false,
                error: `Client tool execution interrupted before completion: ${call.id}`,
              }
        );
      }
    } catch (error) {
      return signal.aborted
        ? cancelledResult(call.id)
        : guardFailure(call.id, error);
    }
  }
  if (signal.aborted) return record(cancelledResult(call.id));
  if (blocked)
    return record({
      ok: false,
      error: 'Client tool continuation limit reached.',
    });
  // The authored contract is the argument type authority. The protocol boundary
  // owns plain data; this mutable copy is intentionally independent of snapshots.
  const execution = Promise.resolve().then(
    async (): Promise<ToolExecutionResult> => {
      if (signal.aborted) return cancelledResult(call.id);
      try {
        const value = await definition.handler(
          structuredClone(call.args) as never,
          { signal }
        );
        return { ok: true, value: ownValue(value as PlainValue) };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
  const outcome = await untilAbort(execution, signal);
  return record(
    outcome.type === 'aborted' ? cancelledResult(call.id) : outcome.value
  );
}

function ownResult(result: ToolExecutionResult): ToolExecutionResult {
  return Object.freeze(
    result.ok
      ? { ok: true, value: ownValue(result.value) }
      : { ok: false, error: result.error }
  );
}

export function resultCall(
  call: ToolCall,
  result: ToolExecutionResult
): ToolCall {
  return ownToolCall(
    result.ok
      ? {
          id: call.id,
          name: call.name,
          args: call.args,
          status: 'complete',
          result: result.value,
        }
      : {
          id: call.id,
          name: call.name,
          args: call.args,
          status: 'error',
          error: result.error,
        }
  );
}

/** Fixed-thread buffer. Snapshots retain exact entry identity; an old successful
 * write can never acknowledge a replacement or a result staged afterward. */
export function createToolBuffer() {
  const entries = new Map<string, ToolMessage>();
  return {
    stage(id: string, result: ToolExecutionResult) {
      entries.set(
        id,
        Object.freeze({
          id: `client-tool-result-${id}`,
          role: 'tool',
          type: 'tool',
          tool_call_id: id,
          content: result.ok
            ? result.value === undefined
              ? ''
              : typeof result.value === 'string'
              ? result.value
              : JSON.stringify(result.value)
            : `Error: ${result.error}`,
        })
      );
    },
    snapshot() {
      const captured = [...entries];
      return {
        messages: captured.map(([, message]) => message),
        acknowledge() {
          for (const [id, message] of captured)
            if (entries.get(id) === message) entries.delete(id);
        },
      };
    },
  };
}
