import { ChatInput, type ChatInputProps } from './index';
const ok: ChatInputProps = { onSubmit: (text: string) => text.length > 0 };
// @ts-expect-error onSubmit is required.
const missing: ChatInputProps = {};
// @ts-expect-error Props are readonly.
ok.busy = true;
<ChatInput onSubmit={() => undefined} />;
// @ts-expect-error value must be a string.
<ChatInput onSubmit={() => undefined} value={1} />;
void missing;
