'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { createEngagedTimeTracker } from '../../lib/analytics/engaged-time';
import { trackEngagedTime } from '../../lib/analytics/client';

/**
 * How often to re-evaluate. The tracker derives elapsed time from a clock
 * rather than counting ticks, so a browser throttling this interval in a
 * background tab delays the event but never miscounts it.
 */
const TICK_MS = 1_000;

/**
 * Emits `marketing:engaged_time` once the visitor has genuinely been looking
 * at the page for 10s, and again at 30s.
 *
 * Without this the site has no passive engagement signal on most viewports:
 * `marketing:stage_progress` is gated to at least 1024x720 and fired on 0.0%
 * of mobile sessions in the 30 days to 2026-09-18. A visitor who reads and
 * clicks nothing emitted one `$pageview` and nothing else, which PostHog
 * scores as a zero-second session and therefore a bounce.
 *
 * Re-created per pathname so engaged time is measured per page rather than
 * per document, matching `capture_pageview: 'history_change'`.
 */
export function EngagedTimeSignal() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const tracker = createEngagedTimeTracker({
      now: () => Date.now(),
      startVisible: document.visibilityState === 'visible',
      onThreshold: (thresholdMs) => trackEngagedTime(Math.round(thresholdMs / 1000)),
    });

    const onVisibilityChange = () => {
      tracker.setVisible(document.visibilityState === 'visible');
      // Re-evaluate immediately: returning to a tab that already passed a
      // threshold should not wait out another interval.
      tracker.tick();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    // Stop waking up once both thresholds have fired. Without this the
    // interval runs at 1Hz for the life of every page on the site, doing
    // nothing.
    const intervalId = window.setInterval(() => {
      tracker.tick();
      if (tracker.isComplete()) window.clearInterval(intervalId);
    }, TICK_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [pathname]);

  return null;
}
