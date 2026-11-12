import { useId } from 'react';
import type { RenderViewProps } from '../../render/index.js';
import { useA2uiSurfaceWriter } from '../surface-context.js';
import { useA2uiCheckError } from './check-error.js';

const TYPES: Readonly<Record<string, string>> = {
  shortText: 'text',
  number: 'number',
  obscured: 'password',
};
const text = (value: unknown) =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : '';

/**
 * A2UI TextField: a labelled single-line, numeric, obscured or multi-line
 * field. Each edit is written to the data model path its `value` is bound to;
 * a field with a literal value, or in a read-only surface, cannot be edited.
 */
export function A2uiTextField({
  props,
  bindings,
  elementKey,
}: RenderViewProps) {
  const id = useId();
  const error = useA2uiCheckError(elementKey);
  const { editable, write } = useA2uiSurfaceWriter();
  const path = bindings?.['value'];
  const variant = props['variant'];
  const label = text(props['label']);
  const shared = {
    id,
    className: 'a2ui-tf__input',
    value: text(props['value']),
    placeholder: text(props['placeholder']) || undefined,
    readOnly: !editable || path === undefined,
    'aria-label': label === '' ? 'Text' : undefined,
    ...error.control,
  };
  return (
    <div className="a2ui-tf">
      {label === '' ? null : (
        <label htmlFor={id} className="a2ui-tf__label">
          {label}
        </label>
      )}
      {variant === 'longText' ? (
        <textarea
          {...shared}
          rows={4}
          onChange={(event) => write(path, event.currentTarget.value)}
        />
      ) : (
        <input
          {...shared}
          type={
            typeof variant === 'string' && Object.hasOwn(TYPES, variant)
              ? TYPES[variant]
              : 'text'
          }
          onChange={(event) => write(path, event.currentTarget.value)}
        />
      )}
      {error.message}
    </div>
  );
}
