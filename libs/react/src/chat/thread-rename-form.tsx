'use client';
import { useId, useRef } from 'react';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';

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

/** Controlled editor; callers own persistence, operation lifetime and return focus. */
export function ThreadRenameForm({
  value,
  onValueChange,
  onSubmit,
  onCancel,
  pending = false,
  error,
  label = 'Conversation title',
  className,
}: ThreadRenameFormProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  useIsomorphicLayoutEffect(() => {
    if (input.current?.disabled) cancel.current?.focus();
    else {
      input.current?.focus();
      input.current?.select();
    }
  }, []);
  const canSubmit = !pending && value.trim().length > 0;
  const submit = () => {
    if (canSubmit && !composing.current) onSubmit();
  };
  return (
    <form
      className={['tp-thread-rename-form', className].filter(Boolean).join(' ')}
      aria-busy={pending || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <label htmlFor={`${id}-title`}>{label}</label>
      <input
        ref={input}
        id={`${id}-title`}
        type="text"
        value={value}
        disabled={pending}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onValueChange(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return;
          submit();
        }}
      />
      <div className="tp-thread-rename-form__actions">
        <button type="submit" disabled={!canSubmit}>
          Save
        </button>
        <button ref={cancel} type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {pending && <p role="status">Saving conversation title…</p>}
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
