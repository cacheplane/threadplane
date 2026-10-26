import { ThreadRenameForm, type ThreadRenameFormProps } from './index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
type Expected = {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly pending?: boolean;
  readonly error?: string;
  readonly label?: string;
  readonly className?: string;
};
type ExactProps = Assert<Equal<ThreadRenameFormProps, Expected>>;
type ExactComponentProps = Assert<
  Equal<Parameters<typeof ThreadRenameForm>[0], Expected>
>;
const props: ThreadRenameFormProps = {
  value: 'Title',
  onValueChange: () => undefined,
  onSubmit: () => undefined,
  onCancel: () => undefined,
};
<ThreadRenameForm {...props} />;
// @ts-expect-error Value is controlled and required.
<ThreadRenameForm
  onValueChange={() => undefined}
  onSubmit={() => undefined}
  onCancel={() => undefined}
/>;
// @ts-expect-error Persistence does not receive an inferred SDK payload.
<ThreadRenameForm {...props} onSubmit={(title: string) => title} />;
// @ts-expect-error Value is readonly.
props.value = 'Other';
// @ts-expect-error Change callback is readonly.
props.onValueChange = () => undefined;
// @ts-expect-error Submit callback is readonly.
props.onSubmit = () => undefined;
// @ts-expect-error Cancel callback is readonly.
props.onCancel = () => undefined;
// @ts-expect-error Pending is readonly.
props.pending = true;
// @ts-expect-error Error is readonly.
props.error = 'Failure';
// @ts-expect-error Label is readonly.
props.label = 'Title';
// @ts-expect-error Class name is readonly.
props.className = 'custom';
export type { ExactProps, ExactComponentProps };
