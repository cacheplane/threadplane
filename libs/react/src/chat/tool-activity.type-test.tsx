import {
  StatusPanel,
  toolOutcomes,
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
const retryOutcome: ToolActivityOutcome = {
  status: 'failed',
  text: 'x',
  retry: { label: 'Retry toSorted read' },
};
const receiptOutcome: ToolActivityOutcome = {
  status: 'receipt',
  text: 'Note #4821 in Comparisons.',
  lead: 'Saved.',
};
// @ts-expect-error Only succeeded, failed or receipt statuses are allowed.
const badOutcome: ToolActivityOutcome = { status: 'error', text: 'x' };
// @ts-expect-error Only a failed call can declare a retry.
const succeededRetry: ToolActivityOutcome = {
  text: 'ok',
  retry: { label: 'Again' },
};
const executingRetry: ToolActivityOutcome = {
  status: 'failed',
  text: 'x',
  // @ts-expect-error A retry names its call; it carries no handler or executor.
  retry: { label: 'Again', run: () => undefined },
};
const receiptSources: ToolActivityOutcome = {
  status: 'receipt',
  text: 'x',
  // @ts-expect-error A receipt is a record, not a source list.
  sources: [],
};
const decoded = toolOutcomes({
  read_reference: ({ args, result, activity }) => {
    // @ts-expect-error Parsed values are unknown until the application decodes them.
    const unchecked: string = result;
    void [args, unchecked, activity.id];
    return undefined;
  },
});
const decodedOutcome: ToolActivityOutcome | undefined = decoded(info);

export const outcomeContracts = [
  retryOutcome,
  receiptOutcome,
  succeededRetry,
  executingRetry,
  receiptSources,
  decodedOutcome,
];
export const contracts = [
  <ToolActivity activity={info} onRetry={(activity) => void activity.id} />,
  <ToolActivityGroup
    activities={[info]}
    onRetry={(activity) => void activity.id}
  />,
  <StatusPanel
    tone="success"
    lead="Saved."
    actions={<button type="button">Open note</button>}
  >
    Note #4821
  </StatusPanel>,
  // @ts-expect-error A panel tone is one of the four meanings.
  <StatusPanel tone="info" />,
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
