import type { CSSProperties } from 'react';
import type { RenderValue } from '../../render/index.js';

const ALIGN: Readonly<Record<string, string>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};
// 'stretch' has no justify-content equivalent: children grow instead.
const JUSTIFY: Readonly<Record<string, string>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  spaceAround: 'space-around',
  spaceBetween: 'space-between',
  spaceEvenly: 'space-evenly',
  stretch: 'normal',
};
const GAP: Readonly<Record<string, number>> = { small: 8, medium: 12, large: 16 };
const own = (map: Readonly<Record<string, unknown>>, key: unknown) =>
  typeof key === 'string' && Object.hasOwn(map, key);

/** Shared Row/Column mapping from A2UI align, justify and optional gap to a class and inline flex styles. */
export function flexLayout(
  base: 'a2ui-row' | 'a2ui-col',
  props: Readonly<Record<string, RenderValue>>
): { readonly className: string; readonly style: CSSProperties } {
  const { align, justify, gap } = props;
  const gapPx =
    typeof gap === 'number' && Number.isFinite(gap)
      ? gap * 4
      : own(GAP, gap)
      ? GAP[gap as string]
      : undefined;
  return {
    className:
      justify === 'stretch' ? `${base} ${base}--justify-stretch` : base,
    style: {
      alignItems: own(ALIGN, align) ? ALIGN[align as string] : 'stretch',
      justifyContent: own(JUSTIFY, justify)
        ? JUSTIFY[justify as string]
        : 'flex-start',
      ...(gapPx === undefined ? {} : { gap: `${gapPx}px` }),
    },
  };
}
