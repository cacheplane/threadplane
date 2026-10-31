import type { ReactNode } from 'react';
import { Timeline, type TimelineItem, type TimelineProps } from './index';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;

export type ExactItemContract = Assert<
  Equal<
    TimelineItem,
    {
      readonly id: string;
      readonly label: string;
      readonly description?: string;
      readonly disabled?: boolean;
    }
  >
>;
export type ExactPropsContract = Assert<
  Equal<
    TimelineProps,
    {
      readonly items: readonly TimelineItem[];
      readonly onSelect: (id: string) => void;
      readonly selectedId?: string | null;
      readonly label?: string;
      readonly className?: string;
      readonly renderItem?: (
        item: TimelineItem,
        isSelected: boolean,
        index: number
      ) => ReactNode;
    }
  >
>;

const item: TimelineItem = {
  id: 'raw',
  label: 'Checkpoint',
  description: 'Details',
  disabled: false,
};
const items: readonly TimelineItem[] = [item];
const props: TimelineProps = {
  items,
  onSelect: (id) => {
    const exact: string = id;
    void exact;
  },
  selectedId: null,
};
<Timeline {...props} />;
<Timeline
  {...props}
  selectedId="raw"
  label="Loaded"
  className="custom"
  renderItem={(row, selected, index) => {
    const exactItem: TimelineItem = row;
    const exactSelected: boolean = selected;
    const exactIndex: number = index;
    return (
      <span>
        {exactItem.label}
        {String(exactSelected)}
        {exactIndex}
      </span>
    );
  }}
/>;
<Timeline {...props} renderItem={() => null} />;
<Timeline {...props} renderItem={() => false} />;
<Timeline {...props} renderItem={() => undefined} />;
// @ts-expect-error IDs are readonly.
item.id = 'changed';
// @ts-expect-error Labels are readonly.
item.label = 'changed';
// @ts-expect-error Descriptions are readonly.
item.description = 'changed';
// @ts-expect-error Disabled metadata is readonly.
item.disabled = true;
// @ts-expect-error Collections are readonly.
items.push(item);
// @ts-expect-error Item props are readonly.
props.items = [];
// @ts-expect-error Callback props are readonly.
props.onSelect = () => undefined;
// @ts-expect-error Selected IDs are readonly.
props.selectedId = 'raw';
// @ts-expect-error List labels are readonly.
props.label = 'Changed';
// @ts-expect-error Class names are readonly.
props.className = 'changed';
// @ts-expect-error Row renderers are readonly.
props.renderItem = () => null;
// @ts-expect-error Items are required.
<Timeline onSelect={() => undefined} />;
// @ts-expect-error The selection callback is required.
<Timeline items={items} />;
// @ts-expect-error Item labels are required.
<Timeline items={[{ id: 'a' }]} onSelect={() => undefined} />;
// @ts-expect-error IDs are strings.
<Timeline items={[{ id: 1, label: 'A' }]} onSelect={() => undefined} />;
<Timeline
  // @ts-expect-error Item labels are literal text.
  items={[{ id: 'a', label: <b>Rich</b> }]}
  onSelect={() => undefined}
/>;
<Timeline
  // @ts-expect-error Item descriptions are literal text.
  items={[{ id: 'a', label: 'A', description: <b>Rich</b> }]}
  onSelect={() => undefined}
/>;
<Timeline
  // @ts-expect-error Disabled metadata is boolean.
  items={[{ id: 'a', label: 'A', disabled: 'true' }]}
  onSelect={() => undefined}
/>;
// @ts-expect-error Selection callbacks receive string IDs.
<Timeline {...props} onSelect={(id: number) => void id} />;
// @ts-expect-error Selected IDs are strings or null.
<Timeline {...props} selectedId={1} />;
// @ts-expect-error List labels are literal text.
<Timeline {...props} label={<b>Rich</b>} />;
// @ts-expect-error Class names are strings.
<Timeline {...props} className={1} />;
// @ts-expect-error Row renderers receive the original item.
<Timeline {...props} renderItem={(row: string) => row} />;
// @ts-expect-error Row selection is boolean.
<Timeline {...props} renderItem={(_row, selected: string) => selected} />;
// @ts-expect-error Row indexes are numbers.
<Timeline {...props} renderItem={(_row, _selected, index: string) => index} />;
// @ts-expect-error Arbitrary objects are not React content.
<Timeline {...props} renderItem={() => ({ arbitrary: true })} />;
