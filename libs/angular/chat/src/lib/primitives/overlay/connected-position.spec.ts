import { describe, it, expect } from 'vitest';
import { computeConnectedPosition, narrowViewport, type ConnectedPosition } from './connected-position';

const ABOVE_RIGHT: ConnectedPosition = { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 };
const BELOW_RIGHT: ConnectedPosition = { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 };
const POSITIONS = [ABOVE_RIGHT, BELOW_RIGHT];

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

describe('computeConnectedPosition', () => {
  const viewport = narrowViewport({ innerWidth: 1000, innerHeight: 800 }, 8);

  it('uses the first position when it fully fits (above, right-aligned)', () => {
    const origin = rect(600, 400, 120, 32); // mid-screen trigger
    const r = computeConnectedPosition({ originRect: origin, overlaySize: { width: 200, height: 150 }, viewport, positions: POSITIONS });
    // above: overlay bottom sits 8px above origin top (400) → top = 400 - 8 - 150 = 242
    expect(r.top).toBe(242);
    // end-aligned: overlay right edge = origin right (720) → left = 720 - 200 = 520
    expect(r.left).toBe(520);
    expect(r.position).toBe(ABOVE_RIGHT);
  });

  it('flips to the second position when the first overflows the top edge', () => {
    const origin = rect(600, 20, 120, 32); // near top → no room above for a 150-tall menu
    const r = computeConnectedPosition({ originRect: origin, overlaySize: { width: 200, height: 150 }, viewport, positions: POSITIONS });
    // below: overlay top = origin bottom (52) + 8 = 60
    expect(r.top).toBe(60);
    expect(r.position).toBe(BELOW_RIGHT);
  });

  it('pushes onto screen when no position fully fits (clamps within viewport)', () => {
    // origin.right = 1000; overlay width = 400 → end-aligned left = 600, right = 1000 > viewport.right (992) → overflows
    const origin = rect(960, 400, 40, 32); // far right; 400-wide menu cannot fit end-aligned
    const r = computeConnectedPosition({ originRect: origin, overlaySize: { width: 400, height: 150 }, viewport, positions: POSITIONS });
    // right edge clamped to viewport.right (992) → left = 992 - 400 = 592; never < margin
    expect(r.left).toBe(592);
    expect(r.left).toBeGreaterThanOrEqual(8);
  });

  it('does not throw on an empty positions array; anchors below-start at the origin', () => {
    const origin = rect(600, 400, 120, 32); // mid-screen trigger
    const r = computeConnectedPosition({ originRect: origin, overlaySize: { width: 200, height: 150 }, viewport, positions: [] });
    expect(Number.isFinite(r.top)).toBe(true);
    expect(Number.isFinite(r.left)).toBe(true);
    // default fallback: below the origin (top = origin.bottom = 432), start-aligned (left = origin.left = 600)
    expect(r.top).toBe(432);
    expect(r.left).toBe(600);
  });
});
