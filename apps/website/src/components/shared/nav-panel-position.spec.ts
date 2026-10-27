import { describe, expect, it } from 'vitest';
import { clampPanelLeft } from './nav-panel-position';

// A 1264px row (the 1200px container plus its 32px padding on each side) at
// the 1440px design viewport. Offsets are relative to the row's padding box,
// which is what HTMLElement.offsetLeft reports for the triggers and the shell.
const row = { rowWidth: 1264, rowPaddingLeft: 32, rowPaddingRight: 32 };

describe('clampPanelLeft', () => {
  it('keeps a panel under its trigger when there is room to the right', () => {
    // Solutions: trigger at 508, panel 596 wide → right edge 1104 < 1232.
    expect(
      clampPanelLeft({ ...row, triggerLeft: 508, panelWidth: 596 })
    ).toBe(508);
  });

  it('pulls a panel left just far enough to stay inside the content box', () => {
    // Libraries: trigger at 296, panel 1122 wide → would end at 1418.
    // The content box ends at 1264 - 32 = 1232, so left = 1232 - 1122.
    expect(
      clampPanelLeft({ ...row, triggerLeft: 296, panelWidth: 1122 })
    ).toBe(110);
  });

  it('pins a panel wider than the content box to the left padding', () => {
    expect(
      clampPanelLeft({ ...row, triggerLeft: 296, panelWidth: 1400 })
    ).toBe(32);
  });

  it('never moves a panel left of the row padding even when the trigger is there', () => {
    expect(
      clampPanelLeft({ ...row, triggerLeft: 10, panelWidth: 300 })
    ).toBe(32);
  });
});
