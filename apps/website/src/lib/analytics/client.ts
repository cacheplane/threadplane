'use client';

import posthog from 'posthog-js';
import { analyticsEvents, type AnalyticsEventName, type AnalyticsProperties } from './events';
import { getSourcePage, toSafeAnalyticsString } from '@threadplane/telemetry/shared';

function currentSourcePage(): string {
  if (typeof window === 'undefined') return '/';
  return getSourcePage(window.location.href);
}

export function track(event: AnalyticsEventName, properties: AnalyticsProperties = {}) {
  if (typeof window === 'undefined') return;

  try {
    posthog.capture(event, {
      source_page: currentSourcePage(),
      ...properties,
    });
  } catch (err) {
    console.error('[posthog] client capture failed:', err);
  }
}

export function trackCtaClick(properties: AnalyticsProperties) {
  track(analyticsEvents.marketingCtaClick, properties);
}

export function trackExternalLinkClick(destinationUrl: string, properties: AnalyticsProperties) {
  track(analyticsEvents.marketingExternalLinkClick, {
    destination_url: toSafeAnalyticsString(destinationUrl, 1000),
    ...properties,
  });
}

export function trackWhitepaperDownloadClick(paper: AnalyticsProperties['paper'], properties: AnalyticsProperties) {
  track(analyticsEvents.marketingWhitepaperDownloadClick, {
    paper,
    ...properties,
  });
}

export function trackStageProgress(
  stage_event: AnalyticsProperties['stage_event'],
  beat?: AnalyticsProperties['beat']
) {
  track(analyticsEvents.marketingStageProgress, {
    surface: 'home_stage',
    stage_event,
    ...(beat ? { beat } : {}),
  });
}

/**
 * Passive engagement. `engaged_seconds` is visible time only, so it can be
 * read as real attention rather than a tab left open.
 */
export function trackEngagedTime(engaged_seconds: number) {
  track(analyticsEvents.marketingEngagedTime, { engaged_seconds });
}
