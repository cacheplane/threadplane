import { useId } from 'react';
import type { RenderViewProps } from '../../render/index.js';
import { useA2uiSurfaceWriter } from '../surface-context.js';

type Kind = 'date' | 'time' | 'datetime-local';

const DATE = /^(\d{4}-\d{2}-\d{2})$/;
const TIME = /^(\d{2}:\d{2})(:\d{2})?(?:\.\d+)?$/;
const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?(?:\.\d+)?$/;
const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/**
 * An ISO 8601 value as the text a native input of `kind` accepts. A value with
 * no zone keeps its wall-clock digits; one with a zone (`Z` or an offset) is
 * shown in the viewer's local time. Anything else is empty.
 */
function nativeDateTime(value: unknown, kind: Kind): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  let date = DATE.exec(text)?.[1];
  let time: string | undefined;
  const local = LOCAL.exec(text);
  const clock = TIME.exec(text);
  if (local !== null) {
    date = local[1];
    time = local[2] + (local[3] === undefined || local[3] === ':00' ? '' : local[3]);
  } else if (clock !== null) {
    time = clock[1] + (clock[2] === undefined || clock[2] === ':00' ? '' : clock[2]);
  } else if (date === undefined) {
    const instant = /^\d{4}-\d{2}-\d{2}T/.test(text) ? new Date(text) : null;
    if (instant === null || Number.isNaN(instant.getTime())) return '';
    date = `${pad(instant.getFullYear(), 4)}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
    time =
      `${pad(instant.getHours())}:${pad(instant.getMinutes())}` +
      (instant.getSeconds() === 0 ? '' : `:${pad(instant.getSeconds())}`);
  }
  if (kind === 'date') return date ?? '';
  if (kind === 'time') return time ?? '';
  return date === undefined ? '' : `${date}T${time ?? '00:00'}`;
}

const NAMES: Readonly<Record<Kind, string>> = {
  date: 'Date',
  time: 'Time',
  'datetime-local': 'Date and time',
};

/**
 * A2UI DateTimeInput: a labelled native date, time or date-and-time input,
 * chosen by `enableDate` (on unless false) and `enableTime`, bounded by `min`
 * and `max`. Each change writes the input's own value (local, no zone:
 * `YYYY-MM-DD`, `HH:mm` or `YYYY-MM-DDTHH:mm`) to the data model path its
 * `value` is bound to; an input with a literal value, or in a read-only
 * surface, cannot be edited.
 */
export function A2uiDateTimeInput({ props, bindings }: RenderViewProps) {
  const id = useId();
  const { editable, write } = useA2uiSurfaceWriter();
  const path = bindings?.['value'];
  const kind: Kind =
    props['enableTime'] !== true
      ? 'date'
      : props['enableDate'] === false
      ? 'time'
      : 'datetime-local';
  const label = typeof props['label'] === 'string' ? props['label'] : '';
  return (
    <div className="a2ui-dti">
      {label === '' ? null : (
        <label htmlFor={id} className="a2ui-dti__label">
          {label}
        </label>
      )}
      <input
        id={id}
        type={kind}
        className="a2ui-dti__input"
        value={nativeDateTime(props['value'], kind)}
        min={nativeDateTime(props['min'], kind) || undefined}
        max={nativeDateTime(props['max'], kind) || undefined}
        readOnly={!editable || path === undefined}
        aria-label={label === '' ? NAMES[kind] : undefined}
        onChange={(event) => write(path, event.currentTarget.value)}
      />
    </div>
  );
}
