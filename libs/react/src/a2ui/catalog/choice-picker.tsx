import { useId, useState } from 'react';
import type { RenderViewProps } from '../../render/index.js';
import { useA2uiSurfaceWriter } from '../surface-context.js';

interface Option {
  readonly label: string;
  readonly value: string;
}

/** Options as the surface projection resolved them: `{ label, value }` strings. */
function options(value: unknown): readonly Option[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Option[] = [];
  for (const item of value as readonly unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { label, value: id } = item as { label?: unknown; value?: unknown };
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    result.push({
      label: typeof label === 'string' && label !== '' ? label : id,
      value: id,
    });
  }
  return result;
}

/** The selection as a string list; a scalar seeded by the agent counts as one choice. */
function selection(value: unknown): readonly string[] {
  if (Array.isArray(value))
    return (value as readonly unknown[]).filter(
      (item): item is string => typeof item === 'string'
    );
  if (typeof value === 'string') return value === '' ? [] : [value];
  return typeof value === 'number' && Number.isFinite(value)
    ? [String(value)]
    : [];
}

/**
 * A2UI ChoicePicker: one choice (`mutuallyExclusive`, the default) or several
 * (`multipleSelection`), shown as radio or checkbox rows or as `chips`, with an
 * optional local filter. Each change writes the whole selection as a string
 * list to the data model path its `value` is bound to; a picker with a literal
 * value, or in a read-only surface, is disabled.
 */
export function A2uiChoicePicker({ props, bindings }: RenderViewProps) {
  const id = useId();
  const [filter, setFilter] = useState('');
  const { editable, write } = useA2uiSurfaceWriter();
  const path = bindings?.['value'];
  const disabled = !editable || path === undefined;
  const single = props['variant'] !== 'multipleSelection';
  const chips = props['displayStyle'] === 'chips';
  const label = typeof props['label'] === 'string' ? props['label'] : '';
  const all = options(props['options']);
  const selected = selection(props['value']);
  const needle = filter.trim().toLowerCase();
  const visible =
    props['filterable'] === true && needle !== ''
      ? all.filter((option) => option.label.toLowerCase().includes(needle))
      : all;
  const choose = (value: string, on: boolean) => {
    if (single) {
      if (on) write(path, [value]);
      return;
    }
    // Written in option order, so the same choices always give the same list.
    const next = new Set(selected);
    if (on) next.add(value);
    else next.delete(value);
    write(path, [
      ...all.filter((option) => next.has(option.value)).map((o) => o.value),
      ...selected.filter(
        (item) => next.has(item) && !all.some((o) => o.value === item)
      ),
    ]);
  };
  return (
    <div
      className="a2ui-cp"
      role={single && !chips ? 'radiogroup' : 'group'}
      aria-labelledby={label === '' ? undefined : `${id}-label`}
      aria-label={label === '' ? 'Choices' : undefined}
    >
      {label === '' ? null : (
        <span id={`${id}-label`} className="a2ui-cp__label">
          {label}
        </span>
      )}
      {props['filterable'] === true ? (
        <input
          type="text"
          className="a2ui-cp__filter"
          placeholder="Filter options"
          aria-label={label === '' ? 'Filter options' : `Filter ${label}`}
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
        />
      ) : null}
      {visible.length === 0 && all.length > 0 ? (
        <span className="a2ui-cp__empty" role="status">
          No options match
        </span>
      ) : chips ? (
        <div className="a2ui-cp__chips">
          {visible.map((option) => {
            const on = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={
                  on ? 'a2ui-cp__chip a2ui-cp__chip--selected' : 'a2ui-cp__chip'
                }
                aria-pressed={on}
                disabled={disabled}
                onClick={() => choose(option.value, single || !on)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="a2ui-cp__checks">
          {visible.map((option) => (
            <label key={option.value} className="a2ui-cp__check-row">
              <input
                type={single ? 'radio' : 'checkbox'}
                className="a2ui-cp__checkbox"
                name={single ? id : undefined}
                checked={selected.includes(option.value)}
                disabled={disabled}
                onChange={(event) =>
                  choose(option.value, event.currentTarget.checked)
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
