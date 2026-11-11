import type { AgentSession } from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { Chat, type ChatProps } from './index';
import type { MessageListProps } from './index';
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
<Chat session={session} onRetry={() => undefined} />;
// @ts-expect-error App retry receives no session or payload.
<Chat session={session} onRetry={(owner: AgentSession) => undefined} />;
// @ts-expect-error Retry intent is readonly.
ok.onRetry = () => undefined;
// @ts-expect-error Props are readonly.
ok.className = 'x';
<Chat
  session={session}
  inputBanner="Paused"
  inputAttachments={<ul />}
  inputLeading={<span />}
  inputTrailing={null}
  inputFooter="Saved"
/>;
// @ts-expect-error Chat names composer slots with an input prefix.
<Chat session={session} leading={<span />} />;
// @ts-expect-error Slots are content, not render functions.
<Chat session={session} inputFooter={() => null} />;
void missing;

import type { ReactNode } from 'react';
import type { ChatSidenavProps } from './index';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type RenderMessageContract = Assert<
  Equal<ChatProps['renderMessage'], MessageListProps['renderMessage']>
>;
<Chat
  session={session}
  renderMessage={(row, context) =>
    context.current ? row.id : context.prevRole ?? null
  }
/>;
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
const renderToolCall: NonNullable<ChatProps['renderToolCall']> = (
  call,
  activity
) =>
  call.name === 'get_weather' && call.status === 'complete' ? (
    <section aria-label={activity.label ?? 'Weather'}>
      <pre>{JSON.stringify(call.result, null, 2)}</pre>
    </section>
  ) : undefined;
<Chat session={session} renderToolCall={renderToolCall} />;
// @ts-expect-error A tool-call renderer is a function.
<Chat session={session} renderToolCall="weather" />;
