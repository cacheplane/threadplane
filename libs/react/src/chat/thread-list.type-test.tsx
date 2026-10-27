import type { ReactNode, MouseEvent, KeyboardEvent } from 'react';
import { ThreadList, type ThreadListItem, type ThreadListProps } from './index';

const item: ThreadListItem = { id: 'a' };
const timestamped: ThreadListItem = { id: 'time', updatedAt: 0 };
<ThreadList threads={[timestamped]} now={0} onSelect={() => undefined} />;
// @ts-expect-error Updated timestamps are readonly.
item.updatedAt = 0;
// @ts-expect-error Updated timestamps are numeric epoch milliseconds.
const invalidTime: ThreadListItem = { id: 'a', updatedAt: '2026-01-01' };
void invalidTime;
const threads: readonly ThreadListItem[] = [item, { id: 'b', title: 'Beta' }];
const props: ThreadListProps = {
  threads,
  onSelect: (id) => {
    const exact: string = id;
    void exact;
  },
  activeThreadId: null,
};
<ThreadList {...props} />;
// @ts-expect-error Reference time is readonly.
props.now = 0;
// @ts-expect-error Reference time is numeric epoch milliseconds.
<ThreadList {...props} now="today" />;
<ThreadList
  threads={threads}
  onSelect={() => undefined}
  activeThreadId="a"
  label="Threads"
  className="custom"
  onNewThread={() => undefined}
  newThreadDisabled={false}
  newThreadLabel="New"
/>;
// @ts-expect-error Creation callbacks are readonly.
props.onNewThread = () => undefined;
// @ts-expect-error Creation disabled state is readonly.
props.newThreadDisabled = true;
// @ts-expect-error Creation labels are readonly.
props.newThreadLabel = 'Changed';
// @ts-expect-error Creation disabled state is boolean.
<ThreadList {...props} newThreadDisabled="yes" />;
// @ts-expect-error Creation labels are plain text.
<ThreadList {...props} newThreadLabel={<b>Rich</b>} />;
// @ts-expect-error Creation callbacks receive no arguments.
<ThreadList {...props} onNewThread={(id: string) => void id} />;
// @ts-expect-error Item IDs are readonly.
item.id = 'changed';
// @ts-expect-error Item titles are readonly.
item.title = 'changed';
// @ts-expect-error The collection is readonly.
threads.push(item);
// @ts-expect-error Props are readonly.
props.threads = [];
// @ts-expect-error Callbacks are readonly props.
props.onSelect = () => undefined;
// @ts-expect-error Active selection is readonly.
props.activeThreadId = 'a';
// @ts-expect-error Labels are readonly.
props.label = 'Changed';
// @ts-expect-error Class names are readonly.
props.className = 'changed';
// @ts-expect-error A thread collection is required.
<ThreadList onSelect={() => undefined} />;
// @ts-expect-error A selection callback is required.
<ThreadList threads={threads} />;
// @ts-expect-error IDs are strings.
<ThreadList threads={[{ id: 1 }]} onSelect={() => undefined} />;
<ThreadList
  // @ts-expect-error Titles are plain text.
  threads={[{ id: 'a', title: <b>Rich</b> }]}
  onSelect={() => undefined}
/>;
// @ts-expect-error List labels are plain text.
<ThreadList threads={threads} label={<b>Rich</b>} onSelect={() => undefined} />;
// @ts-expect-error Selection IDs are strings or null.
<ThreadList threads={threads} activeThreadId={1} onSelect={() => undefined} />;
// @ts-expect-error The callback receives a string ID.
<ThreadList threads={threads} onSelect={(id: number) => void id} />;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type RendererContract = Assert<
  Equal<
    Pick<ThreadListProps, 'renderTitle'>,
    { readonly renderTitle?: (thread: ThreadListItem) => ReactNode }
  >
>;
export type ActionsContract = Assert<
  Equal<
    Pick<ThreadListProps, 'renderActions'>,
    { readonly renderActions?: (thread: ThreadListItem) => ReactNode }
  >
>;
<ThreadList
  {...props}
  renderActions={(thread) => <button>{thread.id}</button>}
/>;
<ThreadList {...props} renderActions={() => null} />;
// @ts-expect-error Action renderers are readonly.
props.renderActions = () => null;
// @ts-expect-error Action renderers receive the original thread item.
<ThreadList {...props} renderActions={(thread: string) => thread} />;
// @ts-expect-error Arbitrary objects are not ReactNodes.
<ThreadList {...props} renderActions={() => ({ arbitrary: true })} />;
<ThreadList
  {...props}
  renderTitle={(thread) => <mark>{thread.title || thread.id}</mark>}
/>;
<ThreadList {...props} renderTitle={() => null} />;
<ThreadList {...props} renderTitle={() => false} />;
// @ts-expect-error Renderers are readonly.
props.renderTitle = () => null;
// @ts-expect-error Renderers receive a thread item.
<ThreadList {...props} renderTitle={(thread: string) => thread} />;
// @ts-expect-error Arbitrary objects are not ReactNode.
<ThreadList {...props} renderTitle={() => ({ arbitrary: true })} />;

const pinnedItem: ThreadListItem = { id: 'pin', pinned: true };
const unpinnedItem: ThreadListItem = { id: 'plain', pinned: false };
// @ts-expect-error Pinned metadata is readonly.
pinnedItem.pinned = false;
// @ts-expect-error Pinned metadata is boolean.
const invalidPin: ThreadListItem = { id: 'invalid', pinned: 'true' };
void unpinnedItem;
void invalidPin;
export type PinnedContract = Assert<
  Equal<Pick<ThreadListItem, 'pinned'>, { readonly pinned?: boolean }>
>;

export type CompletePropsContract = Assert<
  Equal<
    ThreadListProps,
    {
      readonly threads: readonly ThreadListItem[];
      readonly onSelect: (threadId: string) => void;
      readonly activeThreadId?: string | null;
      readonly label?: string;
      readonly className?: string;
      readonly onNewThread?: () => void;
      readonly newThreadDisabled?: boolean;
      readonly newThreadLabel?: string;
      readonly now?: number;
      readonly renderItem?: (
        thread: ThreadListItem,
        isActive: boolean
      ) => ReactNode;
      readonly renderTitle?: (thread: ThreadListItem) => ReactNode;
      readonly renderActions?: (thread: ThreadListItem) => ReactNode;
      readonly onContextMenu?: (
        threadId: string,
        event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>
      ) => void;
    }
  >
>;
<ThreadList
  {...props}
  onContextMenu={(id, event) => {
    const exact: string = id;
    const button: HTMLButtonElement = event.currentTarget;
    void exact;
    void button;
  }}
/>;
// @ts-expect-error Context callbacks are readonly.
props.onContextMenu = () => undefined;
<ThreadList
  {...props}
  // @ts-expect-error Context callbacks must accept keyboard as well as mouse events.
  onContextMenu={(_id, event: MouseEvent<HTMLButtonElement>) => void event}
/>;
// @ts-expect-error Context callback IDs are exact strings.
<ThreadList {...props} onContextMenu={(id: number) => void id} />;

export type ItemRendererContract = Assert<
  Equal<
    Pick<ThreadListProps, 'renderItem'>,
    {
      readonly renderItem?: (
        thread: ThreadListItem,
        isActive: boolean
      ) => ReactNode;
    }
  >
>;
<ThreadList
  {...props}
  renderItem={(thread, isActive) => (
    <button aria-current={isActive ? 'true' : undefined}>{thread.id}</button>
  )}
/>;
<ThreadList {...props} renderItem={() => null} />;
<ThreadList {...props} renderItem={() => false} />;
// @ts-expect-error Full row renderers are readonly.
props.renderItem = () => null;
<ThreadList
  {...props}
  // @ts-expect-error Full row renderers receive the original item and boolean active state.
  renderItem={(thread: string, active: number) => thread + active}
/>;
// @ts-expect-error Arbitrary objects are not row content.
<ThreadList {...props} renderItem={() => ({ arbitrary: true })} />;
