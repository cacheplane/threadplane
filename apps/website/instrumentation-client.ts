import posthog, { type PostHogConfig } from 'posthog-js';
import { shouldCaptureAnalytics } from '@threadplane/telemetry/browser';

const token = process.env.NEXT_PUBLIC_POSTHOG_TOKEN;
const captureLocal = process.env.NEXT_PUBLIC_POSTHOG_CAPTURE_LOCAL === 'true';
const browserHost = typeof window === 'undefined' ? undefined : window.location.host;

/**
 * Every option is stated, including ones that match a posthog-js default.
 *
 * PostHog decides a bounce with
 *   NOT (page_screen_count >= 2 OR has_autocapture OR session_duration >= 10s)
 * and for a long time only the third branch worked here: `capture_pageview: true`
 * stopped the History API monitor from starting, so soft navigations emitted no
 * $pageview, and the project's `autocapture_opt_out` killed the middle branch.
 *
 * `defaults` is a version pin whose meaning changes when it is bumped. Writing
 * the values it implies down next to it turns the next bump into a decision
 * instead of a silent behaviour change. `instrumentation-client.spec.ts` asserts
 * this whole object with `toEqual`, separately asserts `posthog.init` is
 * actually called with it on both the local-opt-in and production paths
 * through `shouldCaptureAnalytics`, so a changed, removed, or added key, or a
 * guard that only works locally, fails the suite.
 *
 * Two of these are also project-level settings in the PostHog UI, with opposite
 * precedence — see docs/growth/README.md.
 */
export const POSTHOG_INIT_OPTIONS = {
  api_host: '/ingest',
  ui_host: 'https://us.posthog.com',
  defaults: '2026-01-30',
  capture_pageview: 'history_change',
  capture_pageleave: 'if_capture_pageview',
  autocapture: true,
  capture_performance: { web_vitals: true },
  person_profiles: 'always',
} satisfies Partial<PostHogConfig>;

if (shouldCaptureAnalytics({ token, captureLocal, host: browserHost })) {
  posthog.init(token!, POSTHOG_INIT_OPTIONS);
}
