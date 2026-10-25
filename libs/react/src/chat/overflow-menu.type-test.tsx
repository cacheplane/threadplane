import type { MouseEvent } from 'react';
import {
  OverflowMenu,
  type OverflowMenuItem,
  type OverflowMenuProps,
} from './index';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type ItemContract = Assert<
  Equal<
    OverflowMenuItem,
    {
      readonly id: string;
      readonly label: string;
      readonly disabled?: boolean;
      readonly tone?: 'normal' | 'destructive';
    }
  >
>;
export type PropsContract = Assert<
  Equal<
    OverflowMenuProps,
    {
      readonly items: readonly OverflowMenuItem[];
      readonly open: boolean;
      readonly onOpenChange: (open: boolean) => void;
      readonly onSelect: (
        itemId: string,
        event: MouseEvent<HTMLButtonElement>
      ) => void;
      readonly label: string;
      readonly disabled?: boolean;
      readonly className?: string;
      readonly anchorPoint?: { readonly x: number; readonly y: number } | null;
      readonly returnFocusTo?: HTMLElement | null;
    }
  >
>;
const props: OverflowMenuProps = {
  items: [{ id: 'copy', label: 'Copy' }],
  label: 'Actions',
  open: false,
  onOpenChange: () => undefined,
  onSelect: (id) => void id,
};
<OverflowMenu {...props} />;
// @ts-expect-error Props are readonly.
props.open = true;
// @ts-expect-error Items are readonly.
props.items.push({ id: 'x', label: 'x' });
// @ts-expect-error Item properties are readonly.
props.items[0].id = 'x';
// @ts-expect-error Required labels cannot be omitted.
<OverflowMenu
  items={[]}
  open={false}
  onOpenChange={() => undefined}
  onSelect={() => undefined}
/>;
// @ts-expect-error Selection receives an exact string ID and native button React event.
<OverflowMenu {...props} onSelect={(id: number) => void id} />;
// @ts-expect-error Open change requests are booleans.
<OverflowMenu {...props} onOpenChange={(open: string) => void open} />;
// @ts-expect-error Disabled values are booleans.
<OverflowMenu {...props} disabled="true" />;
// @ts-expect-error Tone is bounded.
<OverflowMenu {...props} items={[{ id: 'a', label: 'A', tone: 'danger' }]} />;

<OverflowMenu {...props} anchorPoint={null} returnFocusTo={null} />;
<OverflowMenu
  {...props}
  anchorPoint={{ x: 1, y: 2 }}
  returnFocusTo={document.createElement('button')}
/>;
// @ts-expect-error The point prop is readonly.
props.anchorPoint = null;
// @ts-expect-error The invoker prop is readonly.
props.returnFocusTo = null;
if (props.anchorPoint) {
  // @ts-expect-error Point coordinates are readonly.
  props.anchorPoint.x = 1;
  // @ts-expect-error Point coordinates are readonly.
  props.anchorPoint.y = 1;
}
// @ts-expect-error Point coordinates are numeric.
<OverflowMenu {...props} anchorPoint={{ x: '1', y: 2 }} />;
<OverflowMenu
  {...props}
  // @ts-expect-error Invokers are HTML elements.
  returnFocusTo={document.createElementNS('http://www.w3.org/2000/svg', 'svg')}
/>;
