import { EventType, type BaseEvent } from '@ag-ui/client';

export type InterruptMode = 'native' | 'legacy-observation';

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
