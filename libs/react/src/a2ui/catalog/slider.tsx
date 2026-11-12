import { useId } from 'react';
import type { RenderViewProps } from '../../render/index.js';
import { useA2uiSurfaceWriter } from '../surface-context.js';

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * A2UI Slider: a labelled native range input between `min` and `max`. Each
 * movement is written as a number to the data model path its `value` is bound
 * to; a slider with a literal value, or in a read-only surface, is disabled.
 */
export function A2uiSlider({ props, bindings }: RenderViewProps) {
  const id = useId();
  const { editable, write } = useA2uiSurfaceWriter();
  const path = bindings?.['value'];
  const min = finite(props['min'], 0);
  const max = Math.max(min, finite(props['max'], 100));
  const value = Math.min(max, Math.max(min, finite(props['value'], min)));
  const label = typeof props['label'] === 'string' ? props['label'] : '';
  return (
    <div className="a2ui-slider">
      {label === '' ? null : (
        <label htmlFor={id} className="a2ui-slider__label">
          {`${label}: ${value}`}
        </label>
      )}
      <input
        id={id}
        type="range"
        className="a2ui-slider__input"
        min={min}
        max={max}
        value={value}
        disabled={!editable || path === undefined}
        aria-label={label === '' ? 'Value' : undefined}
        onChange={(event) => write(path, Number(event.currentTarget.value))}
      />
    </div>
  );
}
