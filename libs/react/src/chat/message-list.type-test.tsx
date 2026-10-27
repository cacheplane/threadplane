import { MessageList, type MessageListProps } from './index';
import type { MessageRow } from '@threadplane/content/messages';
const ok: MessageListProps = { rows: [] };
// @ts-expect-error rows is required.
const missing: MessageListProps = {};
// @ts-expect-error Props are readonly.
ok.label = 'x';
<MessageList rows={[]} renderMessage={(row) => row.id} />;
// @ts-expect-error renderMessage receives a row, not a string.
<MessageList rows={[]} renderMessage={(row: string) => row} />;
void missing;

interface Tools {
  lookup: { args: { query: string }; result: { found: boolean } };
  count: { args: { limit: number }; result: number };
}
interface AuthoredRow extends MessageRow<Tools> {
  readonly summary: string;
}
declare const authoredRows: readonly AuthoredRow[];
const authoredProps: MessageListProps<AuthoredRow> = {
  rows: authoredRows,
  renderMessage: (row) => row.summary,
};
<MessageList
  rows={authoredRows}
  renderMessage={(row) => {
    const summary: string = row.summary;
    // @ts-expect-error Authored fields stay readonly.
    row.summary = 'changed';
    for (const call of row.toolCalls) {
      if (call.name === 'lookup') {
        const query: string = call.args.query;
        // @ts-expect-error lookup arguments do not belong to count.
        void call.args.limit;
        if (call.status === 'complete') {
          const found: boolean = call.result.found;
          // @ts-expect-error lookup result is not a number.
          const count: number = call.result;
          void found;
          void count;
        }
        void query;
      } else if (call.status === 'complete') {
        const count: number = call.result;
        // @ts-expect-error count result has no lookup field.
        void call.result.found;
        void count;
      }
    }
    return summary;
  }}
/>;
<MessageList {...authoredProps} />;
