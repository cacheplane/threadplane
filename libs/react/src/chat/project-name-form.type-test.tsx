import { ProjectNameForm, type ProjectNameFormProps } from './index.js';

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
  readonly submitLabel?: string;
  readonly submitDisabled?: boolean;
};
type ExactProps = Assert<Equal<ProjectNameFormProps, Expected>>;
type ExactComponentProps = Assert<
  Equal<Parameters<typeof ProjectNameForm>[0], Expected>
>;
const props: ProjectNameFormProps = {
  value: 'Title',
  onValueChange: () => undefined,
  onSubmit: () => undefined,
  onCancel: () => undefined,
};
<ProjectNameForm {...props} />;
<ProjectNameForm
  {...props}
  pending
  error="Failure"
  label="Project"
  className="owner"
  submitLabel="Create"
  submitDisabled
/>;
<ProjectNameForm
  {...props}
  onValueChange={(value) => {
    const text: string = value;
    void text;
  }}
/>;
// @ts-expect-error Change receives plain text.
<ProjectNameForm {...props} onValueChange={(value: number) => void value} />;
// @ts-expect-error Cancel does not receive a command payload.
<ProjectNameForm {...props} onCancel={(id: string) => void id} />;
// @ts-expect-error Custom submit label is plain text.
<ProjectNameForm {...props} submitLabel={<b>Create</b>} />;
// @ts-expect-error Disabled is boolean.
<ProjectNameForm {...props} submitDisabled="yes" />;
// @ts-expect-error Value is controlled and required.
<ProjectNameForm
  onValueChange={() => undefined}
  onSubmit={() => undefined}
  onCancel={() => undefined}
/>;
// @ts-expect-error Persistence does not receive an inferred SDK payload.
<ProjectNameForm {...props} onSubmit={(title: string) => title} />;
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
// @ts-expect-error Submit label is readonly.
props.submitLabel = 'Create';
// @ts-expect-error Submit disabled is readonly.
props.submitDisabled = true;
export type { ExactProps, ExactComponentProps };
