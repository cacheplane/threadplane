import {
  ToolActivity,
  ToolActivityGroup,
  type ToolActivityInfo,
  type ToolActivityProps,
} from './index';
const info: ToolActivityInfo = {
  id: 'call',
  name: 'query',
  phase: 'pending',
  argumentsText: '{',
  resultText: '',
};
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
export const contracts = [
  <ToolActivity activity={info} />,
  <ToolActivityGroup activities={[info]}>
    <button>Approve</button>
  </ToolActivityGroup>,
  command,
  session,
  structured,
];
