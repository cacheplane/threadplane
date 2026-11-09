import {
  ToolActivity,
  ToolActivityGroup,
  type ToolActivityInfo,
  type ToolActivityProps,
} from './index';
import type { ToolActivityOutcome } from './tool-outcome';
const info: ToolActivityInfo = {
  id: 'call',
  name: 'query',
  phase: 'pending',
  argumentsText: '{',
  resultText: '',
  outcome: {
    text: 'Reference checked',
    sources: [{ title: 'Signals', url: 'https://angular.dev/guide/signals' }],
  },
};
// @ts-expect-error Source evidence is readonly.
info.outcome!.sources![0].url = 'https://example.org';
// @ts-expect-error Display evidence is readonly.
info.name = 'other';
// @ts-expect-error Approval/execution belongs to the owner.
const command: ToolActivityProps = { activity: info, execute: () => undefined };
// @ts-expect-error Session ownership is not a display input.
const session: ToolActivityProps = { activity: info, session: {} };
const structured: ToolActivityInfo = {
  id: 'call',
  name: 'query',
  // @ts-expect-error Technical payloads are literal strings.
  argumentsText: {},
};
const legacyOutcome: ToolActivityOutcome = { text: 'ok' };
const failedOutcome: ToolActivityOutcome = { status: 'failed', text: 'x' };
// @ts-expect-error Only succeeded or failed statuses are allowed.
const badOutcome: ToolActivityOutcome = { status: 'error', text: 'x' };

export const contracts = [
  <ToolActivity activity={info} />,
  <ToolActivityGroup activities={[info]}>
    <button>Approve</button>
  </ToolActivityGroup>,
  command,
  session,
  structured,
  legacyOutcome,
  failedOutcome,
  badOutcome,
];
