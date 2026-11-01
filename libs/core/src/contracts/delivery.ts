/** Terminal result of one response attempt; paused awaits resumable input. */
export type CompleteOutcome =
  | 'success'
  | 'error'
  | 'aborted'
  | 'interrupted'
  | 'paused';

/** Identifies a message's response generation and whether it is streaming or finished with an outcome. */
export type MessageDelivery =
  | { readonly generation: string; readonly phase: 'streaming' }
  | {
      readonly generation: string;
      readonly phase: 'complete';
      readonly outcome: CompleteOutcome;
    };

/** Creates a frozen streaming delivery marker for a response generation. */
export function streamingDelivery(generation: string) {
  return Object.freeze({
    generation,
    phase: 'streaming',
  } as const satisfies MessageDelivery);
}

/** Creates a frozen terminal delivery marker with the supplied generation and outcome. */
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

/** Marks static message content as successfully complete, using the message ID as its generation. */
export function staticDelivery(messageId: string) {
  return completeDelivery(messageId, 'success');
}
