import type { RenderViewProps } from '../../render/index.js';
import { useA2uiSurfaceWriter } from '../surface-context.js';
import { useA2uiCheckError } from './check-error.js';

/**
 * A2UI CheckBox: a labelled native checkbox. Each toggle is written to the
 * data model path its `value` is bound to; a box with a literal value, or in a
 * read-only surface, is disabled.
 */
export function A2uiCheckBox({
  props,
  bindings,
  elementKey,
}: RenderViewProps) {
  const error = useA2uiCheckError(elementKey);
  const { editable, write } = useA2uiSurfaceWriter();
  const path = bindings?.['value'];
  const label = typeof props['label'] === 'string' ? props['label'] : '';
  const box = (
    <label className="a2ui-cb">
      <input
        type="checkbox"
        className="a2ui-cb__input"
        checked={props['value'] === true}
        disabled={!editable || path === undefined}
        aria-label={label === '' ? 'Option' : undefined}
        {...error.control}
        onChange={(event) => write(path, event.currentTarget.checked)}
      />
      {label}
    </label>
  );
  return error.message === null ? (
    box
  ) : (
    <div className="a2ui-cb-field">
      {box}
      {error.message}
    </div>
  );
}
