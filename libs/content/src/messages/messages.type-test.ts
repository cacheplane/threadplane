import { createMessageContent, type MessageRow } from './index.js';
const content = createMessageContent();
declare const row: MessageRow;
// @ts-expect-error Rows are readonly.
row.id = 'changed';
// @ts-expect-error project requires a snapshot.
content.project();
content.dispose();
