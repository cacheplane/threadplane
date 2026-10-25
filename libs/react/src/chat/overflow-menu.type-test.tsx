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
