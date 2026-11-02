import {
  Suggestions,
  type SuggestionItem,
  type SuggestionsProps,
} from './index';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type ExactItem = Assert<
  Equal<
    SuggestionItem,
    {
      readonly id: string;
      readonly label: string;
      readonly value: string;
      readonly disabled?: boolean;
    }
  >
>;
export type ExactProps = Assert<
  Equal<
    SuggestionsProps,
    {
      readonly suggestions: readonly SuggestionItem[];
      readonly onSelect: (value: string) => void;
      readonly disabled?: boolean;
      readonly label?: string;
      readonly className?: string;
    }
  >
>;
const item: SuggestionItem = { id: 'a', label: 'Label', value: ' raw ' };
const props: SuggestionsProps = {
  suggestions: Object.freeze([item]),
  onSelect: (value: string) => void value,
};
<Suggestions {...props} />;
// @ts-expect-error Item identity is readonly.
item.id = 'b';
// @ts-expect-error Labels are readonly.
item.label = 'b';
// @ts-expect-error Values are readonly.
item.value = 'b';
// @ts-expect-error Disabled is readonly.
item.disabled = true;
// @ts-expect-error Items are readonly.
props.suggestions.push(item);
// @ts-expect-error Props are readonly.
props.suggestions = [];
// @ts-expect-error Callback is readonly.
props.onSelect = () => undefined;
// @ts-expect-error Disabled is readonly.
props.disabled = true;
// @ts-expect-error Label is readonly.
props.label = 'b';
// @ts-expect-error Class is readonly.
props.className = 'b';
// @ts-expect-error Suggestions required.
<Suggestions onSelect={() => undefined} />;
// @ts-expect-error Callback required.
<Suggestions suggestions={[]} />;
// @ts-expect-error Literal label required.
<Suggestions {...props} suggestions={[{ ...item, label: <b>Rich</b> }]} />;
// @ts-expect-error String ID required.
<Suggestions {...props} suggestions={[{ ...item, id: 1 }]} />;
// @ts-expect-error String values required.
<Suggestions {...props} suggestions={[{ ...item, value: 1 }]} />;
// @ts-expect-error Boolean disabled required.
<Suggestions {...props} disabled="true" />;
// @ts-expect-error Callback receives strings.
<Suggestions {...props} onSelect={(value: number) => void value} />;
