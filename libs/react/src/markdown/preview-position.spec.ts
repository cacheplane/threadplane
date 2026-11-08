import { expect, it } from 'vitest';
import { previewPosition } from './preview-position.js';
it('aligns below, flips above and clamps narrow and RTL viewports', () => {
  const anchor = { left: 20, right: 60, top: 30, bottom: 50 };
  expect(
    previewPosition(
      anchor,
      { width: 100, height: 80 },
      { width: 300, height: 300 },
      false
    )
  ).toEqual({ left: 20, top: 56 });
  expect(
    previewPosition(
      { ...anchor, top: 200, bottom: 220 },
      { width: 100, height: 80 },
      { width: 300, height: 240 },
      true
    )
  ).toEqual({ left: 8, top: 114 });
  expect(
    previewPosition(
      anchor,
      { width: 400, height: 400 },
      { width: 150, height: 120 },
      false
    )
  ).toEqual({ left: 8, top: 8 });
});
