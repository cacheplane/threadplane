import {
  MessageList,
  type MessageListProps,
  type MessageListScrollControls,
  type MessageListRowContext,
} from './index';
import type { MessageRow } from '@threadplane/content/messages';
import type { ReactNode } from 'react';
import type { ChatMessageRole, ToolActivityInfo } from './index';
const ok: MessageListProps = { rows: [] };
declare const context: MessageListRowContext;
const current: boolean = context.current;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type RowContextContract = Assert<
  Equal<
    MessageListRowContext,
    { readonly current: boolean; readonly prevRole?: ChatMessageRole }
  >
>;
const firstContext: MessageListRowContext = { current: false };
const undefinedContext: MessageListRowContext = {
  current: true,
  prevRole: undefined,
};
const previous: ChatMessageRole | undefined = context.prevRole;
// @ts-expect-error Previous role is readonly.
context.prevRole = 'user';
const invalidContext: MessageListRowContext = {
  current: false,
  // @ts-expect-error Previous role must use a supported provider role.
  prevRole: 'developer',
};
void [firstContext, undefinedContext, previous, invalidContext];
export type DefaultRendererContract = Assert<
  Equal<
    Pick<MessageListProps, 'renderMessage'>,
    {
      readonly renderMessage?: (
        row: MessageRow,
        context: MessageListRowContext
      ) => ReactNode;
    }
  >
>;
// @ts-expect-error Positional context is readonly.
context.current = false;
// @ts-expect-error Context has no session ownership.
void context.session;
<MessageList
  rows={authoredRows}
  renderMessage={(row, context) =>
    context.current ? row.summary : context.prevRole ?? row.id
  }
/>;
void current;
// @ts-expect-error rows is required.
const missing: MessageListProps = {};
// @ts-expect-error Props are readonly.
ok.label = 'x';
<MessageList rows={[]} renderMessage={(row) => row.id} />;
// @ts-expect-error renderMessage receives a row, not a string.
<MessageList rows={[]} renderMessage={(row: string) => row} />;
void missing;
declare const controls: MessageListScrollControls;
const pinned: boolean = controls.pinned;
const jumped: void = controls.scrollToLatest();
const focused: void = controls.focus();
// @ts-expect-error Readonly state.
controls.pinned = false;
// @ts-expect-error Readonly action.
controls.scrollToLatest = () => undefined;
// @ts-expect-error Readonly focus.
controls.focus = () => undefined;
// @ts-expect-error No raw element surface.
void controls.element;
// @ts-expect-error No arguments.
controls.scrollToLatest(true);
// @ts-expect-error No arguments.
controls.focus({ preventScroll: false });
// @ts-expect-error Readonly renderer.
ok.renderScrollControl = () => null;
<MessageList
  rows={[]}
  renderScrollControl={(value) =>
    value.pinned ? null : <button onClick={value.scrollToLatest}>Latest</button>
  }
/>;
<MessageList
  rows={[]}
  // @ts-expect-error Renderer receives controls.
  renderScrollControl={(value: HTMLElement) => value.textContent}
/>;
void [pinned, jumped, focused];

interface Tools {
  lookup: { args: { query: string }; result: { found: boolean } };
  count: { args: { limit: number }; result: number };
}
interface AuthoredRow extends MessageRow<Tools> {
  readonly summary: string;
}
declare const authoredRows: readonly AuthoredRow[];
const authoredProps: MessageListProps<AuthoredRow> = {
  rows: authoredRows,
  renderMessage: (row) => row.summary,
};
<MessageList
  rows={authoredRows}
  renderMessage={(row) => {
    const summary: string = row.summary;
    // @ts-expect-error Authored fields stay readonly.
    row.summary = 'changed';
    for (const call of row.toolCalls) {
      if (call.name === 'lookup') {
        const query: string = call.args.query;
        // @ts-expect-error lookup arguments do not belong to count.
        void call.args.limit;
        if (call.status === 'complete') {
          const found: boolean = call.result.found;
          // @ts-expect-error lookup result is not a number.
          const count: number = call.result;
          void found;
          void count;
        }
        void query;
      } else if (call.status === 'complete') {
        const count: number = call.result;
        // @ts-expect-error count result has no lookup field.
        void call.result.found;
        void count;
      }
    }
    return summary;
  }}
/>;
<MessageList {...authoredProps} />;

export type RenderToolResultContract = Assert<
  Equal<
    Pick<MessageListProps, 'renderToolResult'>,
    {
      readonly renderToolResult?: (activity: ToolActivityInfo) => ReactNode;
    }
  >
>;

export type RenderToolCallContract = Assert<
  Equal<
    Pick<MessageListProps, 'renderToolCall'>,
    {
      readonly renderToolCall?: (
        call: MessageRow['toolCalls'][number],
        activity: ToolActivityInfo
      ) => ReactNode;
    }
  >
>;
<MessageList
  rows={[]}
  renderToolCall={(call, activity) => {
    const name: string = call.name;
    const id: string = activity.id;
    return call.status === 'complete' ? `${name}:${id}` : undefined;
  }}
/>;
<MessageList rows={[]} renderToolCall={() => null} />;
// @ts-expect-error A tool-call renderer is a function, not a map of names.
<MessageList rows={[]} renderToolCall={{ weather: () => null }} />;
// @ts-expect-error The activity is readonly evidence.
<MessageList rows={[]} renderToolCall={(_, activity) => (activity.id = 'x')} />;
