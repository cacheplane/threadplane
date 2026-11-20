import { DestroyRef, effect, inject, untracked } from '@angular/core';
import type { Agent } from '../agent';
import type { ToolCall } from '../agent';
import type { ClientToolRegistry, AnyFunctionToolDef } from './tool-def';
import { isPendingClientTool, toSessionResult, type ClientToolResult } from './client-tools-capability';
import { registerClientToolAbort } from './stop-agent';
import { executeFunctionTool } from './execute';
import {
  cancelledClientToolResult,
  clientToolGuardFailureResult,
  defaultInterruptedClientToolResult,
  shouldClaimBeforeExecute,
  type ClientToolExecutionGuard,
  type ClientToolExecutionKey,
  type ClientToolExecutionRecord,
} from './client-tool-execution-guard';

/** Options for wiring automatic browser function-tool execution. */
export interface ClientToolExecutorOptions {
  readonly executionGuard?: ClientToolExecutionGuard;
  readonly settleToolCall?: (toolCall: ToolCall, result: ClientToolResult) => void;
  /** Settlement for calls that must NOT continue the run (user abort, teardown). */
  readonly settleWithoutContinuing?: (toolCall: ToolCall, result: ClientToolResult) => void;
  readonly shouldExecuteToolCall?: (toolCall: ToolCall) => boolean;
}

/**
 * Watches the agent's pending client tool calls (`agent.pendingClientTools()`)
 * and auto-runs FUNCTION tools, answering each through `agent.clientTools`.
 * View/ask (component) tools are handled by the rendering layer, not here.
 * No-op if the agent lacks the clientTools capability. MUST be called in an
 * injection context (sets up an effect).
 *
 * The agent is never changed. A stop reaches the running handlers through
 * `stopAgent(agent)`, which the chat's own Stop controls call.
 */
export function startClientToolExecutor(
  agent: Agent,
  registry: ClientToolRegistry,
  options: ClientToolExecutorOptions = {},
): void {
  if (!agent.clientTools) return;
  const destroyRef = inject(DestroyRef);
  const inFlight = new Map<string, AbortController>();
  const abortAll = (): void => {
    for (const controller of inFlight.values()) {
      controller.abort();
    }
  };

  // The stop button lives in chat-input, which has no coordinator reference.
  // The injected agent cannot be wrapped, so every live executor registers its
  // abort beside the agent and `stopAgent(agent)` fans the stop out to all of
  // them. The registration is released with the executor: agents often outlive
  // the components that start executors.
  const release = registerClientToolAbort(agent, abortAll);
  destroyRef.onDestroy(() => {
    release();
    abortAll();
  });

  // The capability is read at the moment of use: a thread switch replaces the
  // session, and with it the capability object. A result for a call the agent
  // no longer lists has nowhere to go, and the session would reject it.
  const settleToolCall =
    options.settleToolCall ??
    ((toolCall, result) => {
      if (!untracked(() => isPendingClientTool(agent, toolCall.id))) return;
      agent.clientTools?.resolve(toolCall.id, toSessionResult(result));
    });

  // `resolve()` contractually means "record AND continue": the session starts
  // a new run from it. A cancelled call must therefore NEVER go through
  // it, or clicking Stop would immediately start another run and the model
  // could re-call the very tool it was stopped on. settle() + flush() is the
  // durable, run-free equivalent. If the capability has no settle(), we leave
  // the call dangling on purpose: a dangling tool call is repaired on the next
  // user turn, whereas resurrecting a stopped run is not repairable at all.
  const settleWithoutContinuing =
    options.settleWithoutContinuing ??
    ((toolCall: ToolCall, result: ClientToolResult) => {
      const cap = agent.clientTools;
      if (!cap || !untracked(() => isPendingClientTool(agent, toolCall.id))) return;
      if (!cap.settle) {
        console.warn(
          `Client tool "${toolCall.name}" was cancelled but the agent capability does not implement settle(); the result cannot be recorded without starting a run.`,
        );
        return;
      }
      cap.settle(toolCall.id, toSessionResult(result));
      void Promise.resolve(cap.flush?.()).catch(() => undefined);
    });

  effect(() => {
    for (const tc of agent.pendingClientTools() ?? []) {
      const def = registry[tc.name];
      if (!def || def.kind !== 'function') continue; // non-function handled elsewhere
      // `pendingClientTools` lists exactly the calls that wait for a result,
      // whatever their status; `inFlight` prevents a double-dispatch within a
      // render cycle.
      if (inFlight.has(tc.id)) continue;
      if (options.shouldExecuteToolCall && !options.shouldExecuteToolCall(tc)) continue;
      const controller = new AbortController();
      inFlight.set(tc.id, controller);
      void runFunctionTool({
        def,
        toolCall: tc,
        rawArgs: tc.args,
        toolCallId: tc.id,
        controller,
        executionGuard: options.executionGuard,
        settleToolCall,
        settleWithoutContinuing,
      }).finally(() => {
        inFlight.delete(tc.id);
      });
    }
  });
}

/** Outcome of racing a handler against its abort signal. */
interface FunctionToolOutcome {
  readonly aborted: boolean;
  /** Present only when `aborted` is false. */
  readonly result?: ClientToolResult;
}

/**
 * Settle the moment the signal fires instead of waiting for the handler.
 *
 * Honoring `context.signal` is opt-in, and most handlers ignore it, so awaiting
 * the handler would leave a stopped call unsettled — dangling on the server
 * thread and pinned in `inFlight` — until it happens to finish, or forever. The
 * handler's late real result is then discarded: the id is already settled and
 * has left `pendingClientTools`, so it can neither double-settle nor
 * re-dispatch. `executeFunctionTool` normalizes throws, so the losing promise
 * never rejects.
 */
async function raceAbort(
  execution: Promise<ClientToolResult>,
  signal: AbortSignal,
): Promise<FunctionToolOutcome> {
  if (signal.aborted) return { aborted: true };
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<FunctionToolOutcome>((resolve) => {
    onAbort = () => resolve({ aborted: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([
      execution.then((result) => ({ aborted: signal.aborted, result })),
      aborted,
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function runFunctionTool(input: {
  readonly def: AnyFunctionToolDef;
  readonly toolCall: ToolCall;
  readonly rawArgs: unknown;
  readonly toolCallId: string;
  readonly controller: AbortController;
  readonly executionGuard?: ClientToolExecutionGuard;
  readonly settleToolCall: (toolCall: ToolCall, result: ClientToolResult) => void;
  readonly settleWithoutContinuing: (toolCall: ToolCall, result: ClientToolResult) => void;
}): Promise<void> {
  const {
    def,
    toolCall,
    rawArgs,
    toolCallId,
    controller,
    executionGuard,
    settleToolCall,
    settleWithoutContinuing,
  } = input;
  const signal = controller.signal;

  // An aborted call MUST still settle: leaving it unsettled keeps it in
  // `pendingClientTools`, so it is re-dispatched after the next run
  // (re-running a side-effecting handler the user explicitly stopped) and
  // leaves the server thread holding a tool call with no tool result. It must
  // settle through the NON-continuing channel — see `settleWithoutContinuing`.
  let settled = false;
  /** Settle and continue the run. Only for outcomes the user did not cancel. */
  const settleAndContinue = (result: ClientToolResult): void => {
    if (settled) return;
    settled = true;
    settleToolCall(toolCall, result);
  };
  /** Settle without continuing the run. Abort and teardown paths only. */
  const settleCancelled = (result: ClientToolResult = cancelledClientToolResult(toolCallId)): void => {
    if (settled) return;
    settled = true;
    settleWithoutContinuing(toolCall, result);
  };

  if (!executionGuard || !shouldClaimBeforeExecute(def)) {
    const outcome = await raceAbort(executeFunctionTool(def, rawArgs, { signal }), signal);
    if (outcome.aborted) settleCancelled();
    else settleAndContinue(outcome.result as ClientToolResult);
    return;
  }

  const key = { threadId: executionGuard.threadId, toolCallId };
  let claim: 'claimed' | ClientToolExecutionRecord;
  try {
    claim = await executionGuard.store.claim(key);
  } catch (err) {
    // A claim that rejects after the user stopped must still settle, but must
    // never continue the run.
    if (signal.aborted) settleCancelled();
    else settleAndContinue(clientToolGuardFailureResult(toolCallId, err));
    return;
  }

  if (signal.aborted) {
    // Aborted while the claim RPC was in flight. If the claim succeeded, the
    // durable row is now `executing`; record the cancelled result or it stays
    // that way forever and a later reload fails closed as "interrupted".
    if (claim === 'claimed') {
      await recordThenSettle(executionGuard, key, cancelledClientToolResult(toolCallId), toolCallId, settleCancelled);
    } else {
      settleCancelled();
    }
    return;
  }

  if (claim === 'claimed') {
    const outcome = await raceAbort(executeFunctionTool(def, rawArgs, { signal }), signal);
    const result = outcome.aborted
      ? cancelledClientToolResult(toolCallId)
      : (outcome.result as ClientToolResult);
    await recordThenSettle(
      executionGuard,
      key,
      result,
      toolCallId,
      outcome.aborted ? settleCancelled : settleAndContinue,
    );
    return;
  }

  if (claim.status === 'done') {
    settleAndContinue(claim.result);
    return;
  }

  const result = claim.status === 'failed' && claim.result
    ? claim.result
    : defaultInterruptedClientToolResult(toolCallId);
  await recordThenSettle(executionGuard, key, result, toolCallId, settleAndContinue);
}

/**
 * Record the final result then settle through `settle`. Deliberately
 * abort-agnostic: an aborted execution must still write its (cancelled) result,
 * otherwise the guard store stays at `executing` forever and a later reload
 * fails closed with a misleading "interrupted" message. The caller picks the
 * settlement channel, so a cancelled result never continues the run.
 */
async function recordThenSettle(
  executionGuard: ClientToolExecutionGuard,
  key: ClientToolExecutionKey,
  result: ClientToolResult,
  toolCallId: string,
  settle: (result: ClientToolResult) => void,
): Promise<void> {
  try {
    await executionGuard.store.record(key, result);
  } catch (err) {
    settle(clientToolGuardFailureResult(toolCallId, err));
    return;
  }
  settle(result);
}
