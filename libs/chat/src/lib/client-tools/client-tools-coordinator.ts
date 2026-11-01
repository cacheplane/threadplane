import { effect } from '@angular/core';
import { views, type ViewRegistry } from '@threadplane/render';
import type { RenderEvent, RenderViewEntry } from '@threadplane/render';
import type { Agent, ToolCall } from '../agent';
import type {
  ClientToolRegistry,
  ClientToolDef,
  ClientToolContinuationLimitEvent,
  ClientToolContinuationPolicy,
} from './tool-def';
import type { ClientToolExecutionGuard } from './client-tool-execution-guard';
import type { ClientToolSpec } from './to-json-schema';
import { deriveJsonSchema } from './to-json-schema';
import { startClientToolExecutor } from './client-tool-executor';
import type { ClientToolsCapability, ClientToolResult } from './client-tools-capability';

/** Connects client tools to an agent and routes rendered tool events back to the runtime. */
export interface ClientToolsCoordinator {
  /** Components for `view`/`ask` tools, keyed by tool name — merge into the chat `views`. */
  readonly viewRegistry: ViewRegistry;
  /** Wire the coordinator to an agent: ship the catalog, run function tools, auto-ack view tools.
   *  MUST be called inside an injection context (sets up effects). Safe no-op if the agent lacks
   *  the clientTools capability. */
  connect(agent: Agent): void;
  /** Handle a render event bubbled up from a mounted view/ask component (resolves `ask` results). */
  handleRenderEvent(agent: Agent, event: RenderEvent): void;
}

/** Options for creating a client-tools coordinator. */
export interface ClientToolsCoordinatorOptions {
  readonly executionGuard?: ClientToolExecutionGuard;
  readonly continuationPolicy?: ClientToolContinuationPolicy;
}

interface PendingToolGroup {
  readonly ids: ReadonlySet<string>;
  readonly hasFollowUp: boolean;
  readonly settledIds: Set<string>;
  readonly allowed: boolean;
}

const DEFAULT_MAX_CONTINUATION_TURNS = 10;

/** Build the catalog spec list shipped to the model. */
export function toClientToolSpecs(registry: ClientToolRegistry): ClientToolSpec[] {
  return Object.entries(registry).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: deriveJsonSchema(name, def.schema),
  }));
}

/** Map each view/ask tool to a RenderViewEntry that carries its schema, so the
 *  render lib can gate the real component's mount on schema-readiness (showing
 *  the fallback skeleton while a streaming tool call's args are still
 *  incomplete) instead of mounting a required-input component too early. */
function viewComponents(registry: ClientToolRegistry): Record<string, RenderViewEntry> {
  const out: Record<string, RenderViewEntry> = {};
  for (const [name, def] of Object.entries(registry)) {
    if (def.kind === 'view' || def.kind === 'ask') {
      out[name] = { component: def.component, schema: def.schema };
    }
  }
  return out;
}

export function createClientToolsCoordinator(
  registry: ClientToolRegistry,
  options: ClientToolsCoordinatorOptions = {},
): ClientToolsCoordinator {
  const viewRegistry = views(viewComponents(registry));
  const ackedViews = new Set<string>();
  let currentGroup: PendingToolGroup | undefined;
  let currentUserTurnKey = '';
  let continuationTurns = 0;

  function toolWantsFollowUp(tc: ToolCall): boolean {
    return registry[tc.name]?.followUp !== false;
  }

  function latestUserTurnKey(agent: Agent): string {
    const messages = agent.messages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { id?: string; role?: string };
      if (msg.role === 'user' || msg.role === 'human') return msg.id ?? `index:${i}`;
    }
    return 'no-user-turn';
  }

  function continuationLimit(calls: readonly ToolCall[]): ClientToolContinuationLimitEvent | undefined {
    const maxTurns = options.continuationPolicy?.maxTurns ?? DEFAULT_MAX_CONTINUATION_TURNS;
    if (maxTurns === 0) return undefined;
    const attemptedTurn = continuationTurns + 1;
    if (attemptedTurn <= maxTurns) {
      continuationTurns = attemptedTurn;
      return undefined;
    }
    return {
      maxTurns,
      attemptedTurn,
      toolCallIds: calls.map((tc) => tc.id),
      toolNames: calls.map((tc) => tc.name),
    };
  }

  function emitContinuationLimit(event: ClientToolContinuationLimitEvent): void {
    console.error(
      `Client tool continuation stopped after ${event.maxTurns} turn(s); pending tool calls: ${event.toolCallIds.join(', ')}`,
    );
    options.continuationPolicy?.onLimit?.(event);
  }

  function createGroup(agent: Agent, calls: readonly ToolCall[]): PendingToolGroup {
    const userTurnKey = latestUserTurnKey(agent);
    if (userTurnKey !== currentUserTurnKey) {
      currentUserTurnKey = userTurnKey;
      continuationTurns = 0;
    }
    const limit = continuationLimit(calls);
    if (limit) emitContinuationLimit(limit);
    return {
      ids: new Set(calls.map((tc) => tc.id)),
      hasFollowUp: calls.some(toolWantsFollowUp),
      settledIds: new Set<string>(),
      allowed: !limit,
    };
  }

  function groupFor(agent: Agent, cap: ClientToolsCapability, tc: ToolCall): PendingToolGroup {
    if (currentGroup?.ids.has(tc.id)) return currentGroup;
    const pending = cap.pending();
    const calls = pending.some((pendingCall) => pendingCall.id === tc.id)
      ? pending
      : [tc];
    currentGroup = createGroup(agent, calls);
    return currentGroup;
  }

  function shouldHandleClientToolCall(agent: Agent, cap: ClientToolsCapability, tc: ToolCall): boolean {
    return groupFor(agent, cap, tc).allowed;
  }

  function warnMissingSettle(tc: ToolCall): void {
    console.warn(
      `Client tool "${tc.name}" requested batched or terminal settlement, but the agent capability does not implement settle(); falling back to resolve().`,
    );
  }

  /** No settle() and the run must not continue — the result cannot be recorded. */
  function warnUnrecordableWithoutSettle(tc: ToolCall): void {
    console.warn(
      `Client tool "${tc.name}" must not continue the run, but the agent capability does not implement settle(); the result cannot be recorded without starting a run.`,
    );
  }

  function flushSettledResults(cap: ClientToolsCapability): void {
    if (!cap.flush) {
      console.warn(
        'Client tool results were settled with no follow-up run, but the agent capability does not implement flush(); results may not reach the server.',
      );
      return;
    }
    void Promise.resolve(cap.flush()).catch((err: unknown) => {
      console.error('Client tool flush failed', err);
    });
  }

  function settleClientToolCall(
    cap: ClientToolsCapability,
    agent: Agent,
    tc: ToolCall,
    result: ClientToolResult,
    mayContinue = true,
  ): void {
    const group = groupFor(agent, cap, tc);
    if (group.settledIds.has(tc.id)) return;
    group.settledIds.add(tc.id);

    const groupComplete = Array.from(group.ids).every((id) => group.settledIds.has(id));

    // Over the continuation limit, or cancelled by the user (stop / teardown):
    // still record the result so the server never keeps an unanswered tool
    // call, but never continue the run — `resolve()` submits a new run, which
    // for a cancelled call would undo the very stop the user asked for.
    if (!group.allowed || !mayContinue) {
      if (!cap.settle) {
        warnUnrecordableWithoutSettle(tc);
        return;
      }
      cap.settle(tc.id, result);
      // Flush ONCE, when the last call in the group settles. Adapters coalesce
      // concurrent flushes (returning the in-flight promise), so flushing per
      // call would strand every batch after the first.
      if (groupComplete) {
        flushSettledResults(cap);
        // A limit-blocked group must stay `currentGroup` so repeated effect
        // passes over the same never-executed calls keep short-circuiting on
        // `settledIds`. Cancelled calls leave `pending()` once settled, so
        // their group can be retired normally.
        if (group.allowed) currentGroup = undefined;
      }
      return;
    }
    if (!cap.settle) {
      if (group.ids.size > 1 || registry[tc.name]?.followUp === false) warnMissingSettle(tc);
      cap.resolve(tc.id, result);
      if (groupComplete) currentGroup = undefined;
      return;
    }

    if (groupComplete && group.hasFollowUp) {
      cap.resolve(tc.id, result);
      currentGroup = undefined;
      return;
    }

    cap.settle(tc.id, result);
    if (groupComplete) {
      // Terminal group: nothing will continue the run, so make the settled
      // results durable ourselves or the server keeps an unanswered tool call.
      flushSettledResults(cap);
      currentGroup = undefined;
    }
  }

  return {
    viewRegistry,
    connect(agent: Agent): void {
      const cap = agent.clientTools;
      if (!cap) return;
      cap.setCatalog(toClientToolSpecs(registry));
      startClientToolExecutor(agent, registry, {
        executionGuard: options.executionGuard,
        shouldExecuteToolCall: (tc) => {
          if (shouldHandleClientToolCall(agent, cap, tc)) return true;
          // Blocked before executing: record why, so the model sees a reason
          // instead of an unanswered tool call.
          settleClientToolCall(cap, agent, tc, {
            ok: false,
            error: `client tool continuation limit reached; ${tc.name} was not executed`,
          });
          return false;
        },
        settleToolCall: (tc, result) => settleClientToolCall(cap, agent, tc, result),
        // Cancelled calls reuse the same group bookkeeping (so the flush-once-
        // per-group property holds) but are forced down the settle+flush path.
        settleWithoutContinuing: (tc, result) =>
          settleClientToolCall(cap, agent, tc, result, false),
      }); // function tools
      // Auto-ack `view` tools: they render but produce no user value.
      effect(() => {
        for (const tc of cap.pending()) {
          const def: ClientToolDef | undefined = registry[tc.name];
          if (!def || def.kind !== 'view') continue;
          if (ackedViews.has(tc.id)) continue;
          ackedViews.add(tc.id);
          settleClientToolCall(cap, agent, tc, { ok: true, value: { shown: true } });
        }
      });
    },
    handleRenderEvent(agent: Agent, event: RenderEvent): void {
      if (event.type !== 'result') return;
      const cap = agent.clientTools;
      if (!cap) return;
      // elementKey is the tool NAME in the tool-view spec; resolve the pending `ask`
      // call for that name with the component's emitted value.
      const name = event.elementKey;
      const pending = cap.pending().find(
        (tc: ToolCall) => tc.name === name && registry[tc.name]?.kind === 'ask',
      );
      if (pending) settleClientToolCall(cap, agent, pending, { ok: true, value: event.value });
    },
  };
}
