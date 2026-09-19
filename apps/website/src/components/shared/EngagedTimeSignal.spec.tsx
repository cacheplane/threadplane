import { render, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EngagedTimeSignal } from './EngagedTimeSignal';

vi.mock('../../lib/analytics/client', () => ({
  trackEngagedTime: vi.fn(),
}));

let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
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
    pathname = '/';
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

  it('reports nothing for a tab that was never visible at mount', () => {
    // THE honesty property, asserted where it is load-bearing. The production
    // implementation of "a never-seen tab reports nothing" is the single
    // `startVisible: document.visibilityState === 'visible'` argument; a
    // regression to `true` would let a background tab's throttled interval
    // fire both thresholds for a page nobody ever looked at.
    setVisibility('hidden');
    render(<EngagedTimeSignal />);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(tracked).not.toHaveBeenCalled();
  });

  it('ignores visibility changes after unmount', () => {
    // A leaked listener would let one tab-away emit engaged_time for every
    // page visited earlier in the session, each stamped with the CURRENT
    // source_page, breaking the two-events-per-pageview bound.
    const { unmount } = render(<EngagedTimeSignal />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    tracked.mockClear();
    unmount();
    act(() => {
      setVisibility('hidden');
      setVisibility('visible');
      vi.advanceTimersByTime(60_000);
    });
    expect(tracked).not.toHaveBeenCalled();
  });

  it('starts a fresh budget on each pathname, not once per document', () => {
    const { rerender } = render(<EngagedTimeSignal />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(tracked).toHaveBeenCalledTimes(2);
    tracked.mockClear();
    pathname = '/pricing';
    rerender(<EngagedTimeSignal />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(tracked).toHaveBeenCalledExactlyOnceWith(10);
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
