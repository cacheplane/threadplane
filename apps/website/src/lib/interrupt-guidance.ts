/** Shared interrupt guidance served by both machine-readable reference routes. */
export const INTERRUPT_GUIDANCE = [
  '## Interrupts and recovery',
  '',
  'Both backends publish pending interrupts as agent.interrupts() and answer them with agent.resume(responses), where a response is { interruptId, status: "resolved", value } and interruptId comes from interrupts(). The backend defines the decision value.',
  'LangGraph has no cancelled response: a refusal is a value the graph reads, such as { approved: false }, and resume rejects a cancelled status.',
  'AG-UI interruptTransport defaults to "protocol", which answers only native interrupt batches. Answer every native ID exactly once using { interruptId, status, value }; cancelled entries must omit value. For a backend that pauses with a CUSTOM on_interrupt event, pass interruptTransport: "auto" or "legacy-command" to createSession().',
  'For the Mastra integration, configure interruptTransport: "mastra-command". The session sends forwardedProps.command.resume plus command.interruptEvent with observed toolCallId and runId when available. Reject the campsite proposal with { approved: false }.',
  'The LangGraph AG-UI bridge uses forwardedProps.command.resume; the LangGraph session uses its SDK command path. Shared UI does not imply identical persistence APIs.',
  'AG-UI persistence is opt-in in the createSession() options: supply a stable threadId, scoped namespace, and application-owned store with atomic compareAndSwap. Await agent.ready before showing restored controls.',
  'Capture the pause id from decisionState(snapshot) or interruptSession(snapshot) when rendering a decision and pass it as agent.resume(responses, { pause }) to reject stale controls.',
  'retry() sends a retained answer again only when its request provably reached no run. Uncertain delivery requires authoritative reconciliation through persistence.reconcile and agent.reconcileInterrupt(); do not blindly resend.',
  'ready, decisionState, interruptSession, reconcileInterrupt, and persistence are AG-UI extensions, not guarantees of the core session contract. Client storage cannot recreate a lost backend checkpoint or guarantee exactly-once side effects.',
  'Closing an approval card or stopping local streaming does not prove backend cancellation or completion. Verify the backend outcome and the visible reply.',
].join('\n');
