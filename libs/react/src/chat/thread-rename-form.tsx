'use client';
import { NameForm } from './internal/name-form.js';

export interface ThreadRenameFormProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly pending?: boolean;
  readonly error?: string;
  readonly label?: string;
  readonly className?: string;
}

/** Controlled editor; callers own persistence and operation lifetime. */
export function ThreadRenameForm(props: ThreadRenameFormProps) {
  return (
    <NameForm
      {...props}
      baseClass="tp-thread-rename-form"
      pendingLabel="Saving conversation title…"
    />
  );
}
