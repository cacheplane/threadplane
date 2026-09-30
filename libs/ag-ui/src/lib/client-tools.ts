import { computed, signal } from '@angular/core';
import type { AbstractAgent } from '@ag-ui/client';
import type { Tool, Message } from '@ag-ui/core';
import {
  selectPendingClientToolCalls,
  type ClientToolsCapability,
  type ClientToolResult,
  type ClientToolSpec,
} from '@threadplane/chat';
import type { ReducerStore } from './reducer';

/**
 * Minimal subset of AbstractAgent used by createClientToolsCapability.
 * Typed narrowly so the factory is easy to fake in tests.
 */
export interface ClientToolsSource {
  addMessage(message: Parameters<AbstractAgent['addMessage']>[0]): void;
}

export type ContinueClientToolRun = () => Promise<void>;

/** Convert a ClientToolSpec to the AG-UI Tool wire shape. */
function toAgUiTool(spec: ClientToolSpec): Tool {
  return { name: spec.name, description: spec.description, parameters: spec.parameters };
}

/** Serialize a tool result value to a string for the ToolMessage content. */
function safeStringify(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * Creates a ClientToolsCapability backed by an AG-UI source agent and a
 * ReducerStore. Extracted into a factory so it can be unit-tested in isolation
 * without standing up a full Angular DI environment.
 *
 * The capability:
 *  - Maintains a catalog of client tool specs (setCatalog).
 *  - Exposes a `pending` computed signal: tool calls whose name is in the catalog,
 *    have no backend result, and haven't been resolved client-side yet — but ONLY
 *    when the run is not in progress (isLoading===false). The backend ends the run
 *    without emitting TOOL_CALL_RESULT for client tools, so result stays undefined.
 *  - settle(id, result): marks the call as resolved, writes the outcome onto
 *    the local ToolCall in the store (so the transcript freezes: the mounted
 *    ask component re-renders with its emitted value as props and can branch to
 *    a frozen state), and adds a ToolMessage via source.addMessage without
 *    starting a run.
 *  - flush(): no-op. settle() already made the result durable by adding it to
 *    the source's message list, so there is nothing left to write.
 *  - resolve(id, result): settles the result, then requests a continuation
 *    through the adapter-owned run gateway. Any ToolMessages previously
 *    settled into the source are flushed by that single run.
 *
 * Call catalogAsAgUiTools() to get the current catalog as AG-UI Tool[] for
 * attaching to each adapter-owned run.
 */
export function createClientToolsCapability(
  source: ClientToolsSource,
  store: ReducerStore,
  continueRun: ContinueClientToolRun,
  beforeResolve?: () => void,
): ClientToolsCapability & { catalogAsAgUiTools(): Tool[] } {
  const catalog = signal<readonly ClientToolSpec[]>([]);
  const resolvedIds = signal<ReadonlySet<string>>(new Set());

  function catalogAsAgUiTools(): Tool[] {
    return catalog().map(toAgUiTool);
  }

  function settleResult(id: string, result: ClientToolResult): void {
    // Mark as resolved first so pending() drops it immediately.
    resolvedIds.update((s) => new Set(s).add(id));

    // Write the outcome onto the LOCAL ToolCall in the store. The client tool
    // DID produce a result client-side, so this is semantically correct — and
    // it freezes the transcript card: toToolViewSpec spreads `{...args,
    // ...result, status}` into the mounted ask component, so the component
    // re-renders with its own emitted value as props and can branch to a
    // resolved/frozen state. The backend ToolMessage never reaches this local
    // ToolCall, so without this write the card stays interactive forever.
    const ok = result.ok;
    const value = (result as { value: unknown }).value;
    const error = (result as { error: string }).error;
    store.toolCalls.update((calls) =>
      calls.map((tc) =>
        tc.id === id
          ? {
              ...tc,
              result: ok ? value : { error },
              ...(ok ? {} : { error, status: 'error' as const }),
            }
          : tc,
      ),
    );

    // Cast rather than rely on discriminant narrowing: consumer apps that
    // compile this source with `strictNullChecks: false` don't narrow the
    // ClientToolResult union in a ternary.
    const content = ok
      ? safeStringify(value)
      : `Error: ${error}`;

    source.addMessage({
      id: `tool-${id}`,
      role: 'tool',
      toolCallId: id,
      content,
    } as Message);
  }

  const clientTools: ClientToolsCapability & { catalogAsAgUiTools(): Tool[] } = {
    setCatalog(specs: readonly ClientToolSpec[]): void {
      catalog.set([...specs]);
    },

    pending: computed(() => {
      // Client tools are only actionable after the run ends (backend signals it
      // by ending the run WITHOUT emitting TOOL_CALL_RESULT for client tools).
      return selectPendingClientToolCalls({
        isLoading: store.isLoading(),
        toolCalls: store.toolCalls(),
        catalogNames: new Set(catalog().map((s) => s.name)),
        resolvedIds: resolvedIds(),
        authoritativeIds: store.pendingClientToolCallIds?.(),
      });
    }),

    settle(id: string, result: ClientToolResult): void {
      settleResult(id, result);
    },

    // AG-UI's settle() already calls source.addMessage(), which places the
    // ToolMessage in the outgoing message list. Nothing further is needed to
    // make it durable — the next run carries it.
    flush(): void {
      /* no-op: settle() is already durable */
    },

    resolve(id: string, result: ClientToolResult): void {
      beforeResolve?.();
      settleResult(id, result);
      void continueRun();
    },

    catalogAsAgUiTools,
  };

  return clientTools;
}
