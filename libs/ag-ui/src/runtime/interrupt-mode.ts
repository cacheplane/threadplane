import { EventType, type BaseEvent } from '@ag-ui/client';

export type InterruptMode = 'native' | 'legacy-observation';

/**
 * How a session answers a pause.
 *
 * - `protocol`: only the protocol's own interrupt outcome is answered, with
 *   top-level `resume` entries. A `CUSTOM on_interrupt` notice is observed and
 *   cannot be answered. This is what a session does when the option is absent.
 * - `auto`: the protocol's outcome is answered natively. A notice with no such
 *   outcome is answered through `forwardedProps.command`, in the Mastra shape
 *   when the notice names a `toolCallId` and the plain shape otherwise.
 * - `legacy-command`: every pause is answered as
 *   `forwardedProps.command.resume`.
 * - `mastra-command`: every pause is answered as `forwardedProps.command` with
 *   `resume` and the `interruptEvent` the notice named.
 */
export type InterruptTransport =
  | 'auto'
  | 'protocol'
  | 'legacy-command'
  | 'mastra-command';

/** True when the profile lets a session answer a `CUSTOM on_interrupt` notice. */
export function answersNotice(transport: InterruptTransport | undefined) {
  return transport !== undefined && transport !== 'protocol';
}

/** Terminal interpretation of an already normalized root custom notice. */
export function isLegacyInterruptTerminal(
  event: BaseEvent,
  mode: InterruptMode = 'native'
): boolean {
  return (
    mode === 'legacy-observation' &&
    event.type === EventType.CUSTOM &&
    event['name'] === 'on_interrupt' &&
    typeof event['subagentRunId'] !== 'string'
  );
}
