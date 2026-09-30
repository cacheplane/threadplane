import { MessageList, type MessageListProps } from '@threadplane/react/chat';
import type { MessageRow } from '@threadplane/content/messages';

interface Tools {
  weather: { args: { city: string }; result: { temperature: number } };
  count: { args: { limit: number }; result: number };
}
interface WeatherRow extends MessageRow<Tools> {
  readonly summary: string;
}
declare const rows: readonly WeatherRow[];
const props: MessageListProps<WeatherRow> = {
  rows,
  renderMessage: (row) => row.summary,
};
<MessageList {...props} />;
<MessageList
  rows={rows}
  renderMessage={(row) => {
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
