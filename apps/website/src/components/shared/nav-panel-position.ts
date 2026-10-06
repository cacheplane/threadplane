/**
 * Where an open nav panel's left edge goes, in px from the left edge of the
 * row's padding box (`.nav-bar > div`), which is the containing block of
 * `.nav-panel-shell` and the offsetParent of every trigger.
 *
 * A panel opens with its left edge under its trigger. When that would carry
 * its right edge past the row's content box it slides left exactly as far as
 * it has to; a panel wider than the content box pins to the left padding and
 * lets `.nav-panel`'s own max-width deal with the rest. Pure so jsdom can
 * test the arithmetic — the geometry it is fed only exists in a real browser.
 */
export function clampPanelLeft(input: {
  readonly triggerLeft: number;
  readonly panelWidth: number;
  readonly rowWidth: number;
  readonly rowPaddingLeft: number;
  readonly rowPaddingRight: number;
}): number {
  const maxLeft = input.rowWidth - input.rowPaddingRight - input.panelWidth;
  return Math.max(
    input.rowPaddingLeft,
    Math.min(input.triggerLeft, maxLeft)
  );
}
