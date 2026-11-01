// libs/chat/src/lib/primitives/overlay/connected-position.ts
//
// Minimal port of CDK's FlexibleConnectedPositionStrategy fit logic
// (~/repos/components/src/cdk/overlay/position/flexible-connected-position-strategy.ts):
// _getOriginPoint + _getOverlayPoint + _getOverlayFit + _pushOverlayOnScreen.
// Omits flexible-dimensions, grow-after-open, RTL, and virtual-keyboard handling.

export type HorizontalConnectionPos = 'start' | 'center' | 'end';
export type VerticalConnectionPos = 'top' | 'center' | 'bottom';

/** Connects an origin point to an overlay point with optional pixel offsets. */
export interface ConnectedPosition {
  originX: HorizontalConnectionPos;
  originY: VerticalConnectionPos;
  overlayX: HorizontalConnectionPos;
  overlayY: VerticalConnectionPos;
  offsetX?: number;
  offsetY?: number;
}

export interface Size {
  width: number;
  height: number;
}
interface Point {
  x: number;
  y: number;
}
export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** The computed overlay coordinates and the connection position selected by the positioner. */
export interface OverlayPositionResult {
  top: number;
  left: number;
  position: ConnectedPosition;
}

export interface ComputeArgs {
  originRect: Rect;
  overlaySize: Size;
  /** Viewport rect, already narrowed by the desired margin. */
  viewport: Rect;
  positions: ConnectedPosition[];
}

function originPoint(origin: Rect, pos: ConnectedPosition): Point {
  const x = pos.originX === 'center' ? origin.left + origin.width / 2 : pos.originX === 'start' ? origin.left : origin.right;
  const y = pos.originY === 'center' ? origin.top + origin.height / 2 : pos.originY === 'top' ? origin.top : origin.bottom;
  return { x, y };
}

function overlayPoint(origin: Point, size: Size, pos: ConnectedPosition): Point {
  let x = origin.x;
  if (pos.overlayX === 'center') x -= size.width / 2;
  else if (pos.overlayX === 'end') x -= size.width;
  let y = origin.y;
  if (pos.overlayY === 'center') y -= size.height / 2;
  else if (pos.overlayY === 'bottom') y -= size.height;
  return { x: x + (pos.offsetX ?? 0), y: y + (pos.offsetY ?? 0) };
}

function fitArea(point: Point, size: Size, viewport: Rect): { area: number; fits: boolean } {
  const left = point.x;
  const right = point.x + size.width;
  const top = point.y;
  const bottom = point.y + size.height;
  const visibleW = Math.max(0, Math.min(right, viewport.right) - Math.max(left, viewport.left));
  const visibleH = Math.max(0, Math.min(bottom, viewport.bottom) - Math.max(top, viewport.top));
  const fits = left >= viewport.left && right <= viewport.right && top >= viewport.top && bottom <= viewport.bottom;
  return { area: visibleW * visibleH, fits };
}

function pushOnScreen(point: Point, size: Size, viewport: Rect): Point {
  const maxLeft = viewport.right - size.width;
  const maxTop = viewport.bottom - size.height;
  return {
    x: Math.max(viewport.left, Math.min(point.x, maxLeft)),
    y: Math.max(viewport.top, Math.min(point.y, maxTop)),
  };
}

/** Sensible fallback when no positions are supplied: below the origin, start-aligned. */
const DEFAULT_POSITION: ConnectedPosition = { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' };

export function computeConnectedPosition(args: ComputeArgs): OverlayPositionResult {
  const { originRect, overlaySize, viewport, positions } = args;
  // An empty positions array (the directive's input default) must still anchor to
  // the trigger rather than crash on best! / render at 0,0.
  const list = positions.length ? positions : [DEFAULT_POSITION];
  let best: { point: Point; pos: ConnectedPosition; area: number } | null = null;

  for (const pos of list) {
    const point = overlayPoint(originPoint(originRect, pos), overlaySize, pos);
    const { area, fits } = fitArea(point, overlaySize, viewport);
    if (fits) {
      return { top: point.y, left: point.x, position: pos };
    }
    if (!best || area > best.area) best = { point, pos, area };
  }

  const pushed = pushOnScreen(best!.point, overlaySize, viewport);
  return { top: pushed.y, left: pushed.x, position: best!.pos };
}

export function narrowViewport(win: { innerWidth: number; innerHeight: number }, margin: number): Rect {
  return {
    left: margin,
    top: margin,
    right: win.innerWidth - margin,
    bottom: win.innerHeight - margin,
    width: win.innerWidth - 2 * margin,
    height: win.innerHeight - 2 * margin,
  };
}
