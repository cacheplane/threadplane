import type { ReactNode } from 'react';
import {
  MessageActions,
  type MessageAction,
  type MessageActionsProps,
} from './index.js';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type ExactAction = Assert<
  Equal<
    MessageAction,
    {
      readonly id: string;
      readonly label: string;
      readonly onSelect: () => void;
      readonly disabled?: boolean;
      readonly icon?: ReactNode;
      readonly iconOnly?: boolean;
    }
  >
>;
export type ExactGroup = Assert<
  Equal<
    MessageActionsProps,
    {
      readonly actions: readonly MessageAction[];
      readonly disabled?: boolean;
      readonly label?: string;
      readonly className?: string;
    }
  >
>;
const action: MessageAction = {
  id: 'copy',
  label: 'Copy',
  onSelect: () => true,
};
const props: MessageActionsProps = {
  actions: [action],
  label: 'Answer actions',
};
<MessageActions {...props} />;
const icons: readonly ReactNode[] = [
  <svg />,
  0,
  '',
  null,
  undefined,
  false,
  true,
  [],
  [<span key="glyph">*</span>],
  <>*</>,
];
const iconActions: readonly MessageAction[] = icons.map((icon) => ({
  ...action,
  icon,
  iconOnly: true,
}));
const compact: MessageAction = { ...action, icon: <svg />, iconOnly: true };
const expanded: MessageAction = { ...action, icon: null, iconOnly: false };
const fallback: MessageAction = { ...action, iconOnly: true };
<MessageActions actions={[compact, expanded, fallback, ...iconActions]} />;
// @ts-expect-error Icons are readonly.
compact.icon = <svg />;
// @ts-expect-error Compact presentation is readonly.
compact.iconOnly = false;
// @ts-expect-error Compact presentation requires a boolean.
<MessageActions actions={[{ ...action, iconOnly: 'true' }]} />;
// @ts-expect-error Action IDs are readonly.
action.id = 'new';
// @ts-expect-error Labels are readonly.
action.label = 'New';
// @ts-expect-error Per-action disabled state is readonly.
action.disabled = true;
// @ts-expect-error The action group is readonly.
props.actions = [];
// @ts-expect-error Group labels are readonly.
props.label = 'New';
// @ts-expect-error Group classes are readonly.
props.className = 'new';
// @ts-expect-error Raw action DOM handlers are not accepted.
<MessageActions actions={[{ ...action, onClick: () => true }]} />;
// @ts-expect-error Raw action attributes are not accepted.
<MessageActions actions={[{ ...action, title: 'Override' }]} />;
// @ts-expect-error Raw action children are not accepted.
<MessageActions actions={[{ ...action, children: <span /> }]} />;
// @ts-expect-error Commands remain app-owned.
<MessageActions actions={[{ ...action, command: 'copy' }]} />;
// @ts-expect-error Sessions are not supplied to this presentation primitive.
<MessageActions {...props} session={{}} />;
// @ts-expect-error Raw group DOM handlers are not accepted.
<MessageActions {...props} onClick={() => true} />;
const eventPayload: MessageAction = {
  ...action,
  // @ts-expect-error Event payload callbacks are not accepted.
  onSelect: (event: MouseEvent) => event,
};
void eventPayload;
// @ts-expect-error Actions must be explicitly authored.
<MessageActions />;
// @ts-expect-error Action labels must be literal strings.
<MessageActions actions={[{ ...action, label: <strong>Copy</strong> }]} />;
const invalid: MessageAction = {
  id: 'x',
  label: 'X',
  // @ts-expect-error The view supplies no inferred message or SDK payload.
  onSelect: (text: string) => text,
};
// @ts-expect-error Collections are readonly.
props.actions.push(action);
// @ts-expect-error Action callbacks are readonly.
action.onSelect = () => true;
// @ts-expect-error Presentation props are readonly.
props.disabled = true;
void invalid;
