import type { RenderViewProps } from '../../render/index.js';

/** A2UI Icon: a Material Symbols name drawn as a ligature, or an inline `{ svgPath }` drawn as a decorative shape. */
export function A2uiIcon({ props }: RenderViewProps) {
  const name = props['name'];
  if (typeof name === 'string' && name !== '')
    return (
      <span
        className="a2ui-icon material-symbols-outlined"
        role="img"
        aria-label={name}
      >
        {/* Catalogs send camelCase; the font's ligatures are snake_case. */}
        {name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}
      </span>
    );
  if (typeof name !== 'object' || name === null || Array.isArray(name))
    return null;
  const path = (name as { readonly [key: string]: unknown })['svgPath'];
  if (typeof path !== 'string' || path === '') return null;
  return (
    <svg
      className="a2ui-icon a2ui-icon--svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
