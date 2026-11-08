import type { AgentSnapshot } from '@threadplane/core';
import { TypingIndicator, isTyping, type TypingIndicatorProps } from './index';
declare const snapshot: Pick<AgentSnapshot, 'status' | 'messages'>;
declare const delivery: AgentSnapshot['messages'][number]['delivery'];
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type SelectorInput = Assert<
  Equal<
    Parameters<typeof isTyping>,
    [Pick<AgentSnapshot, 'status' | 'messages'>]
  >
>;
export type SelectorResult = Assert<
  Equal<ReturnType<typeof isTyping>, boolean>
>;
export type ControlledProps = Assert<
  Equal<
    TypingIndicatorProps,
    {
      readonly active: boolean;
      readonly label?: string;
      readonly announce?: boolean;
      readonly className?: string;
    }
  >
>;
const waiting: boolean = isTyping(snapshot);
<TypingIndicator
  active={waiting}
  label="Waiting"
  announce={false}
  className="mine"
/>;
// @ts-expect-error active is required.
<TypingIndicator />;
// @ts-expect-error active is boolean.
<TypingIndicator active="yes" />;
// @ts-expect-error No session ownership.
<TypingIndicator active session={{}} />;
// @ts-expect-error No owner.
<TypingIndicator active owner={{}} />;
// @ts-expect-error No commands.
<TypingIndicator active commands={{}} />;
const props: TypingIndicatorProps = { active: true };
// @ts-expect-error Props are readonly.
props.active = false;
// @ts-expect-error Props are readonly.
props.label = 'Changed';
// @ts-expect-error Props are readonly.
props.announce = false;
// @ts-expect-error Props are readonly.
props.className = 'changed';
// @ts-expect-error status is required.
isTyping({ messages: [] });
// @ts-expect-error messages are required.
isTyping({ status: 'running' });
// @ts-expect-error No legacy isLoading contract.
isTyping({ isLoading: true, messages: [] });
isTyping({
  status: 'running',
  // @ts-expect-error No content-array coercion.
  messages: [{ id: 'a', role: 'assistant', content: [], delivery }],
});
