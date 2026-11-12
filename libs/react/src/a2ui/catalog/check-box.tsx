import type { RenderViewProps } from '../../render/index.js';
import { useA2uiSurfaceWriter } from '../surface-context.js';

/**
 * A2UI CheckBox: a labelled native checkbox. Each toggle is written to the
 * data model path its `value` is bound to; a box with a literal value, or in a
 * read-only surface, is disabled.
 */
export function A2uiCheckBox({ props, bindings }: RenderViewProps) {
  const { editable, write } = useA2uiSurfaceWriter();
  const path = bindings?.['value'];
  const label = typeof props['label'] === 'string' ? props['label'] : '';
  return (
    <label className="a2ui-cb">
      <input
        type="checkbox"
        className="a2ui-cb__input"
        checked={props['value'] === true}
        disabled={!editable || path === undefined}
        aria-label={label === '' ? 'Option' : undefined}
        onChange={(event) => write(path, event.currentTarget.checked)}
      />
      {label}
    </label>
  );
}
