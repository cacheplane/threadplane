/** Terminal result of one response attempt; paused awaits resumable input. */
export type CompleteOutcome =
  | 'success'
  | 'error'
  | 'aborted'
  | 'interrupted'
  | 'paused';

export type MessageDelivery =
  | { readonly generation: string; readonly phase: 'streaming' }
  | {
      readonly generation: string;
      readonly phase: 'complete';
      readonly outcome: CompleteOutcome;
    };

export function streamingDelivery(generation: string) {
  return Object.freeze({
    generation,
    phase: 'streaming',
  } as const satisfies MessageDelivery);
}

export function completeDelivery<const TOutcome extends CompleteOutcome>(
  generation: string,
  outcome: TOutcome
) {
  return Object.freeze({
    generation,
    phase: 'complete',
    outcome,
  } as const satisfies MessageDelivery);
}

export function staticDelivery(messageId: string) {
  return completeDelivery(messageId, 'success');
}
