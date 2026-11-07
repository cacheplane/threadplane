import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WorkbenchSeparator,
  type WorkbenchSeparatorProps,
} from './WorkbenchSeparator';

afterEach(cleanup);

function setup(overrides: Partial<WorkbenchSeparatorProps> = {}) {
  const onChange = vi.fn();
  const view = render(
    <WorkbenchSeparator
      label="Resize teaching panel"
      orientation="vertical"
      value={44}
      min={25}
      max={75}
      step={2}
      defaultValue={44}
      onChange={onChange}
      valueFromPointer={(event) => event.clientX}
      {...overrides}
    />
  );
  const separator = screen.getByRole('separator', {
    name: 'Resize teaching panel',
  });
  const capture = vi.fn();
  const release = vi.fn();
  Object.defineProperties(separator, {
    setPointerCapture: { value: capture, configurable: true },
    releasePointerCapture: { value: release, configurable: true },
  });
  return { ...view, separator, onChange, capture, release };
}

// jsdom does not provide PointerEvent in every supported Node version. Real
// bubbling mouse events with pointer identity also exercise React's handlers.
function pointer(
  element: Element,
  type: string,
  id: number,
  clientX = 0,
  button = 0
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
    clientX,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  fireEvent(element, event);
}

describe('workbench separator', () => {
  it('exposes a focusable named separator and current bounds', () => {
    const { separator } = setup();
    expect(separator.tabIndex).toBe(0);
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-valuenow')).toBe('44');
    expect(separator.getAttribute('aria-valuemin')).toBe('25');
    expect(separator.getAttribute('aria-valuemax')).toBe('75');
    expect(separator.classList.contains('tp-learn-separator')).toBe(true);
    expect(separator.querySelector('span')).toBeTruthy();
  });

  it('uses axis-specific arrows, clamps bounds, and resets with Home or double click', () => {
    const { separator, onChange } = setup({ value: 74 });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(75, true);
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(72, true);
    fireEvent.keyDown(separator, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(44, true);
    fireEvent.doubleClick(separator);
    expect(onChange).toHaveBeenLastCalledWith(44, true);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('uses up/down for a horizontal separator and preserves custom classes', () => {
    const { separator, onChange } = setup({
      orientation: 'horizontal',
      value: 26,
      className: 'extra',
    });
    fireEvent.keyDown(separator, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(25, true);
    fireEvent.keyDown(separator, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(28, true);
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(separator.classList.contains('extra')).toBe(true);
  });

  it('captures only the initiating pointer and persists its last bounded position once on release', () => {
    const { separator, onChange, capture, release } = setup();
    pointer(separator, 'pointerdown', 7);
    pointer(separator, 'pointerdown', 8);
    pointer(separator, 'pointermove', 8, 70);
    pointer(separator, 'pointerup', 8);
    expect(onChange).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledExactlyOnceWith(7);
    pointer(separator, 'pointermove', 7, 100);
    expect(onChange).toHaveBeenLastCalledWith(75, false);
    pointer(separator, 'pointermove', 7, 60);
    pointer(separator, 'pointerup', 7);
    expect(onChange.mock.calls).toEqual([
      [75, false],
      [60, false],
      [60, true],
    ]);
    expect(release).toHaveBeenCalledExactlyOnceWith(7);
    pointer(separator, 'lostpointercapture', 7);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it.each(['pointercancel', 'lostpointercapture'])(
    'ends an updated drag on %s once',
    (end) => {
      const { separator, onChange } = setup();
      pointer(separator, 'pointerdown', 1);
      pointer(separator, 'pointermove', 1, 55);
      pointer(separator, end, 1);
      pointer(separator, 'pointermove', 1, 70);
      pointer(separator, 'pointerup', 1);
      expect(onChange.mock.calls).toEqual([
        [55, false],
        [55, true],
      ]);
    }
  );

  it('ignores secondary buttons and does not persist a drag without movement', () => {
    const { separator, onChange, capture } = setup();
    pointer(separator, 'pointerdown', 1, 0, 2);
    expect(capture).not.toHaveBeenCalled();
    pointer(separator, 'pointerdown', 2);
    pointer(separator, 'pointerup', 2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('releases capture on unmount without persisting or handling later pointer events', () => {
    const { separator, onChange, release, unmount } = setup();
    pointer(separator, 'pointerdown', 5);
    pointer(separator, 'pointermove', 5, 60);
    unmount();
    expect(release).toHaveBeenCalledExactlyOnceWith(5);
    pointer(separator, 'pointermove', 5, 70);
    pointer(separator, 'pointercancel', 5);
    expect(onChange.mock.calls).toEqual([[60, false]]);
  });
});
