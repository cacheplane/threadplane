import type { AgentInterruptResponse, PlainValue } from '@threadplane/core';

/** The response a test sends to the first pending interrupt, resolved with
 * `value`. With nothing pending it names an interrupt that does not exist, so
 * the session's own admission decides the outcome. */
export function answerPending(
  session: {
    getSnapshot(): { readonly interrupts: readonly { readonly id: string }[] };
  },
  value?: PlainValue
): readonly AgentInterruptResponse[] {
  const [interrupt] = session.getSnapshot().interrupts;
  return [
    {
      interruptId: interrupt?.id ?? 'none-pending',
      status: 'resolved',
      ...(value !== undefined && { value }),
    },
  ];
}
