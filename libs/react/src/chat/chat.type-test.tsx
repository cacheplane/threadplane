import type { AgentSession } from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { Chat, type ChatProps } from './index';
declare const session: AgentSession;
<Chat session={session} />;
<Chat
  session={session}
  content={createMessageContent()}
  renderMessage={(row) => row.id}
  label="Ask"
  placeholder="Type"
  hint="Enter sends"
  submitOnEnter={false}
  className="mine"
/>;
// @ts-expect-error session is required.
const missing: ChatProps = {};
// @ts-expect-error session must be an AgentSession.
<Chat session={{}} />;
// @ts-expect-error Chat dispatches itself; onSubmit is not a Chat prop.
<Chat session={session} onSubmit={() => undefined} />;
const ok: ChatProps = { session };
// @ts-expect-error Props are readonly.
ok.className = 'x';
void missing;
