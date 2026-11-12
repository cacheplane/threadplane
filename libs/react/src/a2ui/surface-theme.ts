import type { CSSProperties } from 'react';
import type { A2uiSurfaceSnapshot } from '@threadplane/content/a2ui';
import { mediaUrl } from './catalog/media-url.js';

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Relative luminance (WCAG) of an opaque hex colour's red, green and blue. */
function luminance(hex: string): number {
  const digits = hex.slice(1);
  const wide = digits.length <= 4;
  const channel = (index: number) => {
    const value =
      parseInt(wide ? digits[index].repeat(2) : digits.slice(index * 2, index * 2 + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** What an agent's `createSurface.theme` asks of the surface, checked. */
export interface A2uiSurfaceTheme {
  /** Custom properties for the surface root, or undefined when there is no usable colour. */
  readonly style: CSSProperties | undefined;
  readonly name: string;
  readonly iconUrl: string | undefined;
}

/**
 * Reads a surface's theme. `primaryColor` is used only when it is a hex
 * colour, as the basic catalog defines it, so nothing else reaches a style
 * attribute; text on it is white or near-black, whichever contrasts more.
 * `iconUrl` follows the catalog's image URL policy.
 */
export function a2uiSurfaceTheme(surface: A2uiSurfaceSnapshot): A2uiSurfaceTheme {
  const theme = surface.theme as
    | { readonly [key: string]: unknown }
    | null
    | undefined;
  const color = theme?.['primaryColor'];
  const name = theme?.['agentDisplayName'];
  const primary = typeof color === 'string' && HEX.test(color.trim()) ? color.trim() : undefined;
  let style: CSSProperties | undefined;
  if (primary !== undefined) {
    const light = luminance(primary);
    // Contrast against white is (1.05) / (L + 0.05); against #111 it is (L + 0.05) / (0.0056 + 0.05).
    const onPrimary = 1.05 / (light + 0.05) >= (light + 0.05) / 0.0556 ? '#ffffff' : '#111111';
    style = {
      '--a2ui-primary': primary,
      '--a2ui-on-primary': onPrimary,
      '--a2ui-primary-hover': `color-mix(in srgb, ${primary} 85%, ${onPrimary})`,
    } as CSSProperties;
  }
  return {
    style,
    name: typeof name === 'string' ? name.trim() : '',
    iconUrl: mediaUrl(theme?.['iconUrl'], 'image'),
  };
}
