import {
  MessageList,
  ApprovalCard,
  type ApprovalCardProps,
  type ApprovalCardAction,
  Reasoning,
  type MessageListProps,
  type ReasoningProps,
} from '@threadplane/react/chat';
import type { MessageRow } from '@threadplane/content/messages';
import type { MarkdownSnapshot } from '@threadplane/content/markdown';

interface Tools {
  weather: { args: { city: string }; result: { temperature: number } };
  count: { args: { limit: number }; result: number };
}
interface WeatherRow extends MessageRow<Tools> {
  readonly summary: string;
}
declare const rows: readonly WeatherRow[];
const approvalAction: ApprovalCardAction = {
  id: 'approve',
  label: 'Approve',
  onSelect: () => {},
};
const approvalProps: ApprovalCardProps = {
  children: 'App-owned reason',
  actions: [approvalAction],
};
<ApprovalCard {...approvalProps} />;
// @ts-expect-error The app must author actions.
<ApprovalCard>Reason</ApprovalCard>;
// @ts-expect-error Installed body rejects raw SDK objects.
<ApprovalCard actions={[approvalAction]}>{{ reason: 'raw' }}</ApprovalCard>;
const invalidApprovalAction: ApprovalCardAction = {
  id: 'invalid',
  label: 'Invalid',
  // @ts-expect-error Installed callbacks receive no inferred payload.
  onSelect: (payload: string) => payload,
};
void invalidApprovalAction;
// @ts-expect-error Installed props remain readonly.
approvalProps.disabled = true;
// @ts-expect-error Installed action callbacks remain readonly.
approvalAction.onSelect = () => {};
declare const reasoningSnapshot: MarkdownSnapshot;
const reasoningProps: ReasoningProps = {
  snapshot: reasoningSnapshot,
  durationMs: 1000,
  defaultExpanded: true,
};
<Reasoning {...reasoningProps} />;
// @ts-expect-error Installed view requires an owned snapshot.
<Reasoning snapshot="reasoning" />;
// @ts-expect-error Installed props are readonly.
reasoningProps.snapshot = reasoningSnapshot;
const props: MessageListProps<WeatherRow> = {
  rows,
  renderMessage: (row) => row.summary,
};
<MessageList {...props} />;
<MessageList
  rows={rows}
  renderMessage={(row) => {
    const reasoning: MarkdownSnapshot | undefined = row.reasoning;
    // @ts-expect-error Projected reasoning is readonly.
    row.reasoning = undefined;
    if (reasoning) {
      // @ts-expect-error Reasoning document text is readonly.
      reasoning.document.content = 'changed';
    }
    const summary: string = row.summary;
    // @ts-expect-error Authored rows retain their readonly fields.
    row.summary = 'changed';
    for (const call of row.toolCalls) {
      if (call.name === 'weather') {
        const city: string = call.args.city;
        // @ts-expect-error The name discriminates argument contracts.
        void call.args.limit;
        if (call.status === 'complete') {
          const temperature: number = call.result.temperature;
          // @ts-expect-error The weather result is not count's result.
          const count: number = call.result;
          void [temperature, count];
        }
        void city;
      } else if (call.status === 'complete') {
        const count: number = call.result;
        // @ts-expect-error count has no weather result field.
        void call.result.temperature;
        void count;
      }
    }
    return summary;
  }}
/>;
<MessageList rows={[]} renderMessage={(row) => row.id} />;
// @ts-expect-error A custom renderer must receive the supplied row.
<MessageList rows={rows} renderMessage={(row: string) => row} />;
