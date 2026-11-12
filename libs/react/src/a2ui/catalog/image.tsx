import type { RenderViewProps } from '../../render/index.js';
import { mediaUrl } from './media-url.js';

const FIT: Readonly<Record<string, string>> = {
  contain: 'contain',
  cover: 'cover',
  fill: 'fill',
  none: 'none',
  scaleDown: 'scale-down',
};
const VARIANTS = [
  'icon',
  'avatar',
  'smallFeature',
  'mediumFeature',
  'largeFeature',
  'header',
];

/** A2UI Image: one image with its description as alternative text, a sizing preset and an object fit. */
export function A2uiImage({ props }: RenderViewProps) {
  const { description, fit, variant } = props;
  const url = mediaUrl(props['url'], 'image');
  if (url === undefined) return null;
  const preset =
    typeof variant === 'string' && VARIANTS.includes(variant)
      ? variant
      : 'mediumFeature';
  return (
    <img
      className={`a2ui-img a2ui-img--${preset}`}
      src={url}
      alt={typeof description === 'string' ? description : ''}
      style={{
        objectFit: (typeof fit === 'string' && Object.hasOwn(FIT, fit)
          ? FIT[fit]
          : 'fill') as 'fill',
      }}
    />
  );
}
