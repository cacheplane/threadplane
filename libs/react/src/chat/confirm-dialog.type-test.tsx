import { ConfirmDialog, type ConfirmDialogProps } from './index.js';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
type Expected = {
  readonly open: boolean;
  readonly title: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly body?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: 'normal' | 'destructive';
  readonly pending?: boolean;
  readonly className?: string;
  readonly returnFocusTo?: HTMLElement | null;
};
type ExactProps = Assert<Equal<ConfirmDialogProps, Expected>>;
type ExactComponentProps = Assert<
  Equal<Parameters<typeof ConfirmDialog>[0], Expected>
>;
const props: ConfirmDialogProps = {
  open: true,
  title: 'Delete?',
  onConfirm: () => undefined,
  onCancel: () => undefined,
};
<ConfirmDialog {...props} />;
// @ts-expect-error Controlled open is required.
<ConfirmDialog
  title="Delete?"
  onConfirm={() => undefined}
  onCancel={() => undefined}
/>;
// @ts-expect-error Body is literal text.
<ConfirmDialog {...props} body={<b>Delete</b>} />;
// @ts-expect-error Tone is bounded.
<ConfirmDialog {...props} tone="warning" />;
// @ts-expect-error No inferred transport payload.
<ConfirmDialog {...props} onConfirm={(id: string) => id} />;
// @ts-expect-error Props are readonly.
props.open = false;
// @ts-expect-error Props are readonly.
props.title = 'Other';
// @ts-expect-error Props are readonly.
props.onConfirm = () => undefined;
// @ts-expect-error Props are readonly.
props.onCancel = () => undefined;
// @ts-expect-error Props are readonly.
props.body = 'Other';
// @ts-expect-error Props are readonly.
props.confirmLabel = 'Yes';
// @ts-expect-error Props are readonly.
props.cancelLabel = 'No';
// @ts-expect-error Props are readonly.
props.tone = 'normal';
// @ts-expect-error Props are readonly.
props.pending = true;
// @ts-expect-error Props are readonly.
props.className = 'custom';
// @ts-expect-error Props are readonly.
props.returnFocusTo = null;
export type { ExactProps, ExactComponentProps };
