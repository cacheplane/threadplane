import React from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NavigationResizeHandle,
  useNavigationWidth,
} from './navigation-resize';

const key = 'threadplane.docs-navigation.width.v1';

function Navigation({ enabled = true }: { enabled?: boolean }) {
  const { width, update } = useNavigationWidth(enabled);
  return (
    <aside data-testid="navigation" style={{ width }}>
      {enabled && <NavigationResizeHandle width={width} onChange={update} />}
    </aside>
  );
}

function setup() {
  const view = render(<Navigation />);
  const separator = screen.getByRole('separator', {
    name: 'Resize navigation',
  });
  const capture = vi.fn();
  const release = vi.fn();
  Object.defineProperties(separator, {
    setPointerCapture: { value: capture },
    releasePointerCapture: { value: release },
  });
  vi.spyOn(
    screen.getByTestId('navigation'),
    'getBoundingClientRect'
  ).mockReturnValue({ left: 80 } as DOMRect);
  return { ...view, separator, capture, release };
}

function pointer(element: Element, type: string, id: number, clientX = 0) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  fireEvent(element, event);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('navigation width preferences', () => {
  it('starts with hydration-safe defaults and restores a saved width without rewriting storage', () => {
    localStorage.setItem(key, '400');
    expect(renderToString(<Navigation />)).toContain('width:328px');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    setup();
    expect(screen.getByTestId('navigation').style.width).toBe('400px');
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ['-1', 250],
    ['999', 440],
    ['{bad', 328],
    ['null', 328],
    ['"400"', 328],
    ['{}', 328],
    ['1e999', 328],
  ])('validates stored width %s', (stored, expected) => {
    localStorage.setItem(key, stored);
    setup();
    expect(screen.getByTestId('navigation').style.width).toBe(`${expected}px`);
  });

  it('does not read saved docs preferences when resizing is disabled', () => {
    localStorage.setItem(key, '400');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    render(<Navigation enabled={false} />);
    expect(screen.getByTestId('navigation').style.width).toBe('328px');
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('keeps resizing and reset available when storage access is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { separator } = setup();
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(screen.getByTestId('navigation').style.width).toBe('338px');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(screen.getByTestId('navigation').style.width).toBe('328px');
  });
});

describe('navigation separator', () => {
  it('provides keyboard bounds and resets with Home or double click, persisting across remount', () => {
    const { separator, unmount } = setup();
    expect(separator.tabIndex).toBe(0);
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-valuemin')).toBe('250');
    expect(separator.getAttribute('aria-valuemax')).toBe('440');
    for (let i = 0; i < 20; i++)
      fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('440');
    fireEvent.keyDown(separator, { key: 'ArrowDown' });
    expect(separator.getAttribute('aria-valuenow')).toBe('440');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator.getAttribute('aria-valuenow')).toBe('328');
    for (let i = 0; i < 20; i++)
      fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator.getAttribute('aria-valuenow')).toBe('250');
    fireEvent.doubleClick(separator);
    expect(separator.getAttribute('aria-valuenow')).toBe('328');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    unmount();
    setup();
    expect(screen.getByTestId('navigation').style.width).toBe('338px');
  });

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])(
    'persists once after %s for the initiating pointer',
    (end) => {
      const { separator, capture, release } = setup();
      const write = vi.spyOn(Storage.prototype, 'setItem');
      pointer(separator, 'pointerdown', 3);
      pointer(separator, 'pointerdown', 4);
      pointer(separator, 'pointermove', 4, 500);
      pointer(separator, 'pointerup', 4);
      expect(separator.getAttribute('aria-valuenow')).toBe('328');
      pointer(separator, 'pointermove', 3, 500);
      expect(separator.getAttribute('aria-valuenow')).toBe('420');
      pointer(separator, 'pointermove', 3, 600);
      expect(separator.getAttribute('aria-valuenow')).toBe('440');
      expect(write).not.toHaveBeenCalled();
      pointer(separator, end, 3);
      pointer(separator, 'lostpointercapture', 3);
      expect(write).toHaveBeenCalledExactlyOnceWith(key, '440');
      expect(capture).toHaveBeenCalledExactlyOnceWith(3);
      expect(release).toHaveBeenCalledExactlyOnceWith(3);
    }
  );

  it('releases capture and stops writing after unmount', () => {
    const { separator, release, unmount } = setup();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    pointer(separator, 'pointerdown', 3);
    pointer(separator, 'pointermove', 3, 500);
    unmount();
    expect(release).toHaveBeenCalledExactlyOnceWith(3);
    pointer(separator, 'pointerup', 3);
    expect(write).not.toHaveBeenCalled();
  });
});
