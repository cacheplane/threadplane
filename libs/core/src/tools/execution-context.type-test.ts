import type {
  ToolExecutionAcquisition,
  ToolExecutionSettlement,
  ToolExecutionStore,
} from './index.js';

const alternatives: ToolExecutionAcquisition[] = [
  { status: 'acquired', token: 'owner' },
  { status: 'complete', result: '{"ok":true,"value":1}' },
  { status: 'unavailable' },
  { status: 'conflict' },
];
const reusable: ToolExecutionSettlement = {
  invocation: 'call',
  token: 'owner',
  result: 'encoded',
};
const nonReusable: ToolExecutionSettlement = {
  invocation: 'call',
  token: 'owner',
  result: null,
};
// @ts-expect-error invocation is required
const missingInvocation: ToolExecutionSettlement = {
  token: 'owner',
  result: null,
};
// @ts-expect-error token is required
const missingToken: ToolExecutionSettlement = {
  invocation: 'call',
  result: null,
};
// @ts-expect-error result marker is required
const missingResult: ToolExecutionSettlement = {
  invocation: 'call',
  token: 'owner',
};
// @ts-expect-error acquired requires authority
const missingAuthority: ToolExecutionAcquisition = { status: 'acquired' };
const oldProvider = {
  claim: async () => 'claimed' as const,
  record: async () => undefined,
};
// @ts-expect-error the old provider cannot authorize execution
const oldStore: ToolExecutionStore = oldProvider;
// @ts-expect-error settlement is immutable
reusable.token = 'different';
void [
  alternatives,
  reusable,
  nonReusable,
  missingInvocation,
  missingToken,
  missingResult,
  missingAuthority,
  oldStore,
];
