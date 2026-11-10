import type { ToolActivityOutcome } from './tool-outcome';

export const legacyOutcome: ToolActivityOutcome = { text: 'ok' };
export const failedOutcome: ToolActivityOutcome = { status: 'failed', text: 'x' };
// @ts-expect-error Only succeeded or failed statuses are allowed.
export const badOutcome: ToolActivityOutcome = { status: 'error', text: 'x' };
