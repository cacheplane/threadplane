import { MessageList, type MessageListProps } from './index';
const ok: MessageListProps = { rows: [] };
// @ts-expect-error rows is required.
const missing: MessageListProps = {};
// @ts-expect-error Props are readonly.
ok.label = 'x';
<MessageList rows={[]} renderMessage={(row) => row.id} />;
// @ts-expect-error renderMessage receives a row, not a string.
<MessageList rows={[]} renderMessage={(row: string) => row} />;
void missing;
