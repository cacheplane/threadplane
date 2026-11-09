import type { Role } from '@threadplane/core';
import type { ReactNode } from 'react';
import {
  ChatMessage,
  type ChatMessageProps,
  type ChatMessageRole,
} from './index';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type RoleContract = Assert<Equal<ChatMessageRole, Role>>;
export type PropsContract = Assert<
  Equal<
    ChatMessageProps,
    {
      readonly role: Role;
      readonly prevRole?: Role;
      readonly current?: boolean;
      readonly streaming?: boolean;
      readonly speaker?: string;
      readonly label?: string;
      readonly children?: ReactNode;
      readonly beforeContent?: ReactNode;
      readonly afterContent?: ReactNode;
      readonly controls?: ReactNode;
      readonly className?: string;
    }
  >
>;
export type ParameterContract = Assert<
  Equal<Parameters<typeof ChatMessage>, [ChatMessageProps]>
>;
const props: ChatMessageProps = { role: 'assistant' };
const explicitUndefined: ChatMessageProps = {
  role: 'user',
  prevRole: undefined,
};
void explicitUndefined;
// @ts-expect-error Previous role is readonly.
props.prevRole = 'assistant';
// @ts-expect-error Previous role must use a supported provider role.
<ChatMessage role="user" prevRole="developer" />;
<ChatMessage role="user" prevRole="assistant" />;
// @ts-expect-error Props are readonly.
props.current = true;
// @ts-expect-error Props are readonly.
props.streaming = true;
// @ts-expect-error Current must be boolean.
<ChatMessage role="assistant" current="true" />;
// @ts-expect-error Streaming must be boolean.
<ChatMessage role="assistant" streaming={1} />;
// @ts-expect-error Role is required.
const missing: ChatMessageProps = {};
// @ts-expect-error Props are readonly.
props.role = 'tool';
// @ts-expect-error Props are readonly.
props.speaker = 'Other';
// @ts-expect-error Props are readonly.
props.label = 'Other';
// @ts-expect-error Props are readonly.
props.children = null;
// @ts-expect-error Props are readonly.
props.beforeContent = null;
// @ts-expect-error Props are readonly.
props.afterContent = null;
// @ts-expect-error Props are readonly.
props.controls = null;
// @ts-expect-error Props are readonly.
props.className = 'other';
<ChatMessage role="tool" controls={0}>
  Literal
</ChatMessage>;
// @ts-expect-error No owner input.
<ChatMessage role="user" session={{}} />;
// @ts-expect-error No raw element input.
<ChatMessage role="user" ref={{ current: null }} />;
// @ts-expect-error No renderer callback.
<ChatMessage role="user" controls={() => null} />;
// @ts-expect-error No implicit actions.
<ChatMessage role="user" onClick={() => undefined} />;
void missing;
<ChatMessage
  role="assistant"
  beforeContent={0}
  afterContent={['literal', 0]}
/>;
// @ts-expect-error Slots accept content, not render callbacks.
<ChatMessage role="assistant" beforeContent={() => null} />;
// @ts-expect-error Slots accept content, not render callbacks.
<ChatMessage role="assistant" afterContent={() => null} />;
