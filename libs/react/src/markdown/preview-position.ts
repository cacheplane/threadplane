/** Fixed viewport coordinates, independent of DOM measurement and rendering. */
export function previewPosition(
  anchor: { left: number; right: number; top: number; bottom: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number; left?: number; top?: number },
  rtl: boolean
): { left: number; top: number } {
  const x = viewport.left ?? 0;
  const y = viewport.top ?? 0;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, max));
  const below = anchor.bottom + 6;
  const top =
    below + panel.height <= y + viewport.height - 8
      ? below
      : anchor.top - panel.height - 6;
  return {
    left: clamp(
      rtl ? anchor.right - panel.width : anchor.left,
      x + 8,
      x + viewport.width - panel.width - 8
    ),
    top: clamp(top, y + 8, y + viewport.height - panel.height - 8),
  };
}
