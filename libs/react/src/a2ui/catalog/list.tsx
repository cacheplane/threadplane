import type { RenderViewProps } from '../../render/index.js';

const ALIGN: Readonly<Record<string, string>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

/** A2UI List: children in a scrolling vertical or horizontal run with cross-axis alignment. */
export function A2uiList({ props, children }: RenderViewProps) {
  const { direction, align } = props;
  return (
    <div
      className={
        direction === 'horizontal'
          ? 'a2ui-list a2ui-list--horizontal'
          : 'a2ui-list a2ui-list--vertical'
      }
      style={{
        alignItems:
          typeof align === 'string' && Object.hasOwn(ALIGN, align)
            ? ALIGN[align]
            : 'stretch',
      }}
    >
      {children}
    </div>
  );
}
