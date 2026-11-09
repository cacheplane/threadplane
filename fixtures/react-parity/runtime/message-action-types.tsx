import { Fragment, type ReactNode } from 'react';
import { MessageActions, type MessageAction, type MessageActionsProps } from '@threadplane/react/chat';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type ActionKeys = Assert<Equal<keyof MessageAction, 'id' | 'label' | 'onSelect' | 'disabled' | 'icon' | 'iconOnly'>>;
export type GroupKeys = Assert<Equal<keyof MessageActionsProps, 'actions' | 'label' | 'disabled' | 'className'>>;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type ReadonlyKeys<T> = { [K in keyof T]-?: Equal<Pick<T, K>, Mutable<Pick<T, K>>> extends true ? never : K }[keyof T];
export type ReadonlyActionKeys = Assert<Equal<ReadonlyKeys<MessageAction>, keyof MessageAction>>;
export type ReadonlyGroupKeys = Assert<Equal<ReadonlyKeys<MessageActionsProps>, keyof MessageActionsProps>>;

const icons: readonly ReactNode[] = [<svg key="svg"><title>Decorative</title></svg>, null, undefined, false, true, 0, '', [], <Fragment key="empty" />];
const actions: readonly MessageAction[] = [
  { id: 'text', label: '<b>Literal</b>', onSelect: () => undefined },
  { id: 'labelled', label: 'With icon', icon: <svg />, iconOnly: false, onSelect: () => undefined },
  ...icons.map((icon, index) => ({ id: String(index), label: `Action ${index}`, icon, iconOnly: true, disabled: false, onSelect: () => undefined })),
];
export const views = <><MessageActions actions={actions} /><MessageActions actions={actions} label="Commands" disabled className="owned" /></>;

export function contracts(action: MessageAction, group: MessageActionsProps) {
  // @ts-expect-error installed action IDs are readonly
  action.id = 'changed';
  // @ts-expect-error installed literal labels are readonly
  action.label = 'changed';
  // @ts-expect-error installed callbacks are readonly
  action.onSelect = () => undefined;
  // @ts-expect-error installed disabled state is readonly
  action.disabled = false;
  // @ts-expect-error installed icons are readonly
  action.icon = <svg />;
  // @ts-expect-error installed compact flags are readonly
  action.iconOnly = true;
  // @ts-expect-error installed action collections are readonly
  group.actions.push(action);
  // @ts-expect-error group props remain readonly
  group.label = 'changed';
  // @ts-expect-error iconOnly requires boolean
  const flag: MessageAction = { ...action, iconOnly: 'yes' };
  // @ts-expect-error arbitrary objects are not ReactNodes
  const icon: MessageAction = { ...action, icon: { glyph: 'copy' } };
  // @ts-expect-error labels remain literal strings
  const label: MessageAction = { ...action, label: <b>Copy</b> };
  // @ts-expect-error commands cannot require payloads
  const payload: MessageAction = { ...action, onSelect: (text: string) => text };
  // @ts-expect-error native button props are not action props
  const raw: MessageAction = { ...action, onClick: () => undefined };
  // @ts-expect-error clipboard policy stays app owned
  const command: MessageAction = { ...action, command: 'copy' };
  // @ts-expect-error no event payload can be passed
  action.onSelect(new MouseEvent('click'));
  // @ts-expect-error no raw root DOM props
  const rawGroup = <MessageActions actions={actions} onClick={() => undefined} />;
  return { flag, icon, label, payload, raw, command, rawGroup };
}
