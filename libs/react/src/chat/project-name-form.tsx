'use client';
import { NameForm } from './internal/name-form.js';

export interface ProjectNameFormProps {
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
}

/** Controlled project name editor; the application owns persistence. */
export function ProjectNameForm({
  label = 'Project name',
  ...props
}: ProjectNameFormProps) {
  return (
    <NameForm
      {...props}
      label={label}
      baseClass="tp-project-name-form"
      pendingLabel="Saving project name…"
    />
  );
}
