import { toolOutcomes, type ToolActivityOutcome } from './tool-outcome';

export const legacyOutcome: ToolActivityOutcome = { text: 'ok' };
export const failedOutcome: ToolActivityOutcome = { status: 'failed', text: 'x' };
export const retryOutcome: ToolActivityOutcome = { status: 'failed', text: 'x', retry: { label: 'Retry toSorted read' } };
export const receiptOutcome: ToolActivityOutcome = { status: 'receipt', text: 'Note #4821 in Comparisons.', lead: 'Saved.' };
// @ts-expect-error Only a failed call can declare a retry.
export const succeededRetry: ToolActivityOutcome = { text: 'ok', retry: { label: 'Again' } };
// @ts-expect-error A retry names its call; it carries no handler or executor.
export const executingRetry: ToolActivityOutcome = { status: 'failed', text: 'x', retry: { label: 'Again', run: () => undefined } };
// @ts-expect-error A receipt is a record, not a source list.
export const receiptSources: ToolActivityOutcome = { status: 'receipt', text: 'x', sources: [] };
export const decoded = toolOutcomes({
  read_reference: ({ args, result, activity }) => {
    // @ts-expect-error Parsed values are unknown until the application decodes them.
    const unchecked: string = result;
    void [args, unchecked, activity.id];
    return undefined;
  },
});
// @ts-expect-error Only succeeded, failed or receipt statuses are allowed.
export const badOutcome: ToolActivityOutcome = { status: 'error', text: 'x' };
