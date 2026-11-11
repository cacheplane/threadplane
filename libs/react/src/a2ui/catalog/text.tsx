import type { RenderViewProps } from '../../render/index.js';

const VARIANTS = ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'] as const;
type TextVariant = (typeof VARIANTS)[number];

/** A2UI Text: literal text in one typography variant; heading variants are exposed as headings of that level. */
export function A2uiText({ props }: RenderViewProps) {
  const variant: TextVariant = VARIANTS.includes(props['variant'] as TextVariant)
    ? (props['variant'] as TextVariant)
    : 'body';
  const value = props['text'];
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
  const level = /^h[1-5]$/.test(variant) ? Number(variant[1]) : undefined;
  return (
    <span
      className={`a2ui-text-${variant}`}
      role={level ? 'heading' : undefined}
      aria-level={level}
    >
      {text}
    </span>
  );
}
