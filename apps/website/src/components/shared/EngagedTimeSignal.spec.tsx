import { render, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EngagedTimeSignal } from './EngagedTimeSignal';

vi.mock('../../lib/analytics/client', () => ({
  trackEngagedTime: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

import { trackEngagedTime } from '../../lib/analytics/client';

const tracked = vi.mocked(trackEngagedTime);

/**
 * `engaged-time.spec.ts` covers the accounting. These cover the wiring, which
 * is where this can silently do nothing: an effect that never runs, an
 * interval that is never installed, or a listener that outlives the component.
 * The unit tests would stay green through all three.
 */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('EngagedTimeSignal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tracked.mockClear();
    setVisibility('visible');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('reports ten engaged seconds after ten visible seconds', () => {
    render(<EngagedTimeSignal />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(tracked).toHaveBeenCalledWith(10);
  });

  it('reports nothing before the first threshold', () => {
    render(<EngagedTimeSignal />);
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(tracked).not.toHaveBeenCalled();
  });

  it('reports thirty seconds as a second event, not a replacement', () => {
    render(<EngagedTimeSignal />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(tracked).toHaveBeenNthCalledWith(1, 10);
    expect(tracked).toHaveBeenNthCalledWith(2, 30);
  });

  it('does not accrue engagement while the tab is hidden', () => {
    render(<EngagedTimeSignal />);
    act(() => {
      vi.advanceTimersByTime(3_000);
      setVisibility('hidden');
      vi.advanceTimersByTime(120_000);
    });
    expect(tracked).not.toHaveBeenCalled();
  });

  it('stops reporting once unmounted', () => {
    // A leaked interval would keep attributing engagement to a page the
    // visitor has already navigated away from.
    const { unmount } = render(<EngagedTimeSignal />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(tracked).not.toHaveBeenCalled();
  });
});
