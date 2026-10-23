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
