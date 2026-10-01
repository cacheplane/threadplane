import {
  MessageActions,
  type MessageAction,
  type MessageActionsProps,
} from './index.js';
const action: MessageAction = { id: 'copy', label: 'Copy', onSelect: () => true };
const props: MessageActionsProps = {
  actions: [action],
  label: 'Answer actions',
};
<MessageActions {...props} />;
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
