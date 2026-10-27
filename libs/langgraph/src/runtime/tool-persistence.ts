import type { createToolBuffer, ToolMessage } from './function-tools.js';

type ToolBuffer = ReturnType<typeof createToolBuffer>;
type ToolBatch = ReturnType<ToolBuffer['snapshot']>;

/** Fixed-thread persistence effects. Capture a batch only when its write starts;
 * an earlier write must acknowledge its exact entries before the next capture.
 * Rejected acknowledgement blocks automatic retries, including later arrivals. */
export function createToolPersistence<Context = undefined>(
  buffer: ToolBuffer,
  write: (
    messages: readonly ToolMessage[],
    signal: AbortSignal,
    context: Context | undefined
  ) => Promise<void>
) {
  let pending = 0;
  let failed = false;
  let tail = Promise.resolve();

  return {
    get pending() {
      return pending;
    },
    /** Only the owning command's successful explicit delivery may release a
     * failed-write latch. An older batch cannot clear replacement entries. */
    acknowledge(batch: ToolBatch) {
      batch.acknowledge();
      if (!buffer.snapshot().messages.length) failed = false;
    },
    flush(signal: AbortSignal, context?: Context): Promise<void> {
      // Admission must see queued work before any promise continuation runs.
      pending += 1;
      const operation = tail.then(async () => {
        if (failed)
          throw new Error(
            'A previous tool result write did not acknowledge persistence.'
          );
        signal.throwIfAborted();
        const batch = buffer.snapshot();
        if (!batch.messages.length) return;
        try {
          await write(batch.messages, signal, context);
        } catch (error) {
          // A rejected response may follow a committed remote write. Do not
          // retry it merely because another durable result arrives afterward.
          failed = true;
          throw error;
        }
        batch.acknowledge();
      });
      // Observe rejection without retaining its payload or poisoning the queue.
      // Each queued operation still checks the failure latch before any I/O.
      tail = operation.catch(() => undefined);
      return operation.finally(() => {
        pending -= 1;
      });
    },
  };
}
