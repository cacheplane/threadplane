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

import type { ReactNode } from 'react';
import type { ChatSidenavProps } from './index';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type CompactContentContract = Assert<
  Equal<
    Pick<ChatSidenavProps, 'collapsedContent'>,
    { readonly collapsedContent?: ReactNode }
  >
>;
export type ToggleShortcutContract = Assert<
  Equal<
    Pick<ChatSidenavProps, 'toggleShortcut'>,
    { readonly toggleShortcut?: boolean }
  >
>;
export type SearchRequestContract = Assert<
  Equal<Pick<ChatSidenavProps, 'onSearch'>, { readonly onSearch?: () => void }>
>;
export type SearchLabelContract = Assert<
  Equal<
    Pick<ChatSidenavProps, 'searchLabel'>,
    { readonly searchLabel?: string }
  >
>;
export type SearchShortcutContract = Assert<
  Equal<
    Pick<ChatSidenavProps, 'searchShortcut'>,
    { readonly searchShortcut?: boolean }
  >
>;
