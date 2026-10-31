import {
  HistorySearchPalette,
  type HistorySearchPaletteProps,
  type HistorySearchResult,
} from './index.js';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
type Expected = {
  readonly open: boolean;
  readonly query: string;
  readonly results: readonly HistorySearchResult[];
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
  readonly loading?: boolean;
  readonly label?: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly closeLabel?: string;
  readonly className?: string;
  readonly returnFocusTo?: HTMLElement | null;
};
type Props = Assert<Equal<HistorySearchPaletteProps, Expected>>;
type Component = Assert<
  Equal<Parameters<typeof HistorySearchPalette>[0], Expected>
>;
type Result = Assert<
  Equal<
    HistorySearchResult,
    { readonly id: string; readonly title: string; readonly subtitle?: string }
  >
>;
const row: HistorySearchResult = {
  id: 'exact',
  title: '<literal>',
  subtitle: 'Project',
};
const props: HistorySearchPaletteProps = {
  open: true,
  query: '',
  results: [row],
  onQueryChange: () => undefined,
  onSelect: () => undefined,
  onClose: () => undefined,
};
<HistorySearchPalette {...props} />;
// @ts-expect-error Open is controlled, not inferred.
<HistorySearchPalette
  query=""
  results={[]}
  onQueryChange={() => undefined}
  onSelect={() => undefined}
  onClose={() => undefined}
/>;
// @ts-expect-error Titles are literal strings, not arbitrary content.
const invalidTitle: HistorySearchResult['title'] = <b>Title</b>;
void invalidTitle;
// @ts-expect-error Selection requests have exact IDs, not row/transport objects.
const invalidSelection: HistorySearchPaletteProps['onSelect'] = (value: {
  id: string;
}) => value.id;
void invalidSelection;
// @ts-expect-error Input stays caller-controlled.
props.query = 'changed';
// @ts-expect-error Supplied order is readonly.
props.results.sort();
// @ts-expect-error Result data is readonly.
row.id = 'changed';
// @ts-expect-error Result presentation is readonly.
row.title = 'changed';
export type { Props, Component, Result };
