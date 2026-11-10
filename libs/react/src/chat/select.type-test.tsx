import type { MouseEvent } from 'react';
import { Select, type SelectOption, type SelectProps } from './index';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type OptionContract = Assert<
  Equal<
    SelectOption,
    {
      readonly value: string;
      readonly label: string;
      readonly description?: string;
      readonly disabled?: boolean;
    }
  >
>;
export type PropsContract = Assert<
  Equal<
    SelectProps,
    {
      readonly options: readonly SelectOption[];
      readonly value: string;
      readonly onValueChange: (
        value: string,
        event: MouseEvent<HTMLButtonElement>
      ) => void;
      readonly open: boolean;
      readonly onOpenChange: (open: boolean) => void;
      readonly label: string;
      readonly placeholder?: string;
      readonly disabled?: boolean;
      readonly className?: string;
      readonly menuClassName?: string;
    }
  >
>;
const props: SelectProps = {
  options: [{ value: 'a', label: 'Alpha' }],
  value: 'a',
  onValueChange: (value) => void value,
  open: false,
  onOpenChange: () => undefined,
  label: 'Model',
};
<Select {...props} />;
<Select
  {...props}
  placeholder="Pick"
  disabled
  className="a"
  menuClassName="b"
/>;
// @ts-expect-error Props are readonly.
props.value = 'b';
// @ts-expect-error Options are readonly.
props.options.push({ value: 'x', label: 'x' });
// @ts-expect-error Option properties are readonly.
props.options[0].value = 'x';
// @ts-expect-error The listbox label cannot be omitted.
<Select
  options={[]}
  value=""
  onValueChange={() => undefined}
  open={false}
  onOpenChange={() => undefined}
/>;
// @ts-expect-error Selection is controlled; the value cannot be omitted.
<Select
  options={[]}
  label="Model"
  onValueChange={() => undefined}
  open={false}
  onOpenChange={() => undefined}
/>;
// @ts-expect-error Values are strings.
<Select {...props} value={1} />;
// @ts-expect-error Change intent receives the literal string value.
<Select {...props} onValueChange={(value: number) => void value} />;
// @ts-expect-error Open change requests are booleans.
<Select {...props} onOpenChange={(open: string) => void open} />;
// @ts-expect-error Disabled values are booleans.
<Select {...props} disabled="true" />;
// @ts-expect-error Option values are strings.
<Select {...props} options={[{ value: 1, label: 'One' }]} />;
const node = <b />;
// @ts-expect-error Option descriptions are text, not nodes.
<Select {...props} options={[{ value: 'a', label: 'A', description: node }]} />;
