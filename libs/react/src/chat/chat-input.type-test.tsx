import { ChatInput, type ChatInputProps } from './index';
const ok: ChatInputProps = { onSubmit: (text: string) => text.length > 0 };
// @ts-expect-error onSubmit is required.
const missing: ChatInputProps = {};
// @ts-expect-error Props are readonly.
ok.busy = true;
<ChatInput onSubmit={() => undefined} />;
// @ts-expect-error value must be a string.
<ChatInput onSubmit={() => undefined} value={1} />;
<ChatInput
  onSubmit={() => undefined}
  banner="Paused"
  attachments={<ul />}
  leading={<span />}
  trailing={null}
  footer="Saved"
/>;
// @ts-expect-error Slots are content, not render functions.
<ChatInput onSubmit={() => undefined} leading={() => null} />;
// @ts-expect-error Slots are readonly.
ok.footer = null;
// @ts-expect-error Attachments are content, not a file list.
<ChatInput onSubmit={() => undefined} attachments={() => []} />;
// @ts-expect-error A model picker is trailing content, not a separate slot.
<ChatInput onSubmit={() => undefined} modelSelect={<span />} />;
void missing;
