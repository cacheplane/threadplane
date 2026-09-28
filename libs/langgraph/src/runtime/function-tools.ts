import type { PlainValue, ToolCall } from '@threadplane/core';
import type {
  FunctionToolDefinition,
  ToolExecutionKey,
  ToolExecutionResult,
  ToolExecutionStore,
} from '@threadplane/core/tools';
import { ownToolCall, ownValue } from './ownership.js';
import {
  canonicalInvocation,
  captureAcquisition,
  captureSettlement,
  encodeResult,
  ownResult,
} from './tool-provenance.js';

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

export type ToolExecutionOutcome =
  | { readonly type: 'settled'; readonly result: ToolExecutionResult }
  | {
      readonly type: 'unavailable';
      readonly reason: 'acquire' | 'settle' | 'outstanding';
    }
  | { readonly type: 'not-started' }
  | { readonly type: 'conflict' };

function settled(result: ToolExecutionResult): ToolExecutionOutcome {
  return { type: 'settled', result: ownResult(result) };
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

/** One call, owned by one command. Acquisition/settlement may outlive it: a late
 * acquired owner must settle cancellation, while a settlement already in flight
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
): Promise<ToolExecutionOutcome> {
  const guard = definition.idempotent ? undefined : store;
  if (signal.aborted)
    return guard ? { type: 'not-started' } : settled(cancelledResult(call.id));
  const invocation = canonicalInvocation(call.name, call.args);
  let token: string | undefined;
  async function settle(
    result: ToolExecutionResult
  ): Promise<ToolExecutionOutcome> {
    if (!guard) return settled(result);
    const captured = ownResult(result);
    try {
      if (token === undefined) return { type: 'unavailable', reason: 'settle' };
      const acknowledgment = await guard.settle(key, {
        invocation,
        token,
        result: encodeResult(captured),
      });
      return captureSettlement(acknowledgment)
        ? settled(captured)
        : { type: 'unavailable', reason: 'settle' };
    } catch {
      // A rejected acknowledgement says nothing about durable acceptance or
      // the handler's external effect. It is not a tool failure to serialize.
      return { type: 'unavailable', reason: 'settle' };
    }
  }
  if (guard) {
    try {
      const observation = captureAcquisition(
        await guard.acquire(key, invocation)
      );
      // Conclusive facts survive stop. Observers never own cancellation cleanup.
      if (observation.status === 'complete') return settled(observation.result);
      if (observation.status === 'conflict') return { type: 'conflict' };
      if (observation.status !== 'acquired')
        return { type: 'unavailable', reason: 'outstanding' };
      token = observation.token;
    } catch {
      return { type: 'unavailable', reason: 'acquire' };
    }
  }
  if (signal.aborted) return settle(cancelledResult(call.id));
  if (blocked)
    return settle({
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
  return settle(
    outcome.type === 'aborted' ? cancelledResult(call.id) : outcome.value
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
