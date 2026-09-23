import { afterEach, describe, expect, it, vi } from 'vitest';

// posthog-js is mocked to keep it out of jsdom on plain import, and to give
// the "init was called with..." tests something to spy on.
vi.mock('posthog-js', () => ({ default: { init: vi.fn() } }));

import { POSTHOG_INIT_OPTIONS } from './instrumentation-client';

describe('website posthog init options', () => {
  /**
   * See the $is_bounce formula and rationale in the JSDoc above
   * POSTHOG_INIT_OPTIONS in instrumentation-client.ts. This asserts the whole
   * options object, not per-property, so a changed, removed, OR added key
   * fails the suite. See
   * docs/superpowers/specs/2026-09-18-posthog-instrumentation-fix-design.md
   */
  it('states the exact PostHog init options', () => {
    expect(POSTHOG_INIT_OPTIONS).toEqual({
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      defaults: '2026-01-30',
      capture_pageview: 'history_change',
      capture_pageleave: 'if_capture_pageview',
      autocapture: true,
      capture_performance: { web_vitals: true },
      person_profiles: 'always',
      disable_surveys: true,
    });
  });

  // Named for the same reason as the capture_pageview case below: the project's
  // remote `surveys: false` does not stop posthog-js downloading surveys.js,
  // so dropping this flag silently restores a 33.5KB fetch on every page.
  it('keeps the surveys bundle from loading at all', () => {
    expect(POSTHOG_INIT_OPTIONS.disable_surveys).toBe(true);
  });

  // Redundant with the toEqual above, deliberately: this IS the bug this fix
  // exists for, and a named failure here is far more legible than an object
  // diff. Do not "simplify" this away.
  it('captures a pageview on every history change, not just on document load', () => {
    // posthog-js gates its History API monitor on an exact string compare:
    //   get isEnabled(){return "history_change" === config.capture_pageview}
    // `true` is truthy but does NOT start the monitor. Assert the literal.
    expect(POSTHOG_INIT_OPTIONS.capture_pageview).toBe('history_change');
  });
});

describe('website posthog init call', () => {
  const originalLocation = window.location;

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('calls posthog.init with the exported options', async () => {
    // shouldCaptureAnalytics needs both a token AND a capture-local opt-in:
    // jsdom's host is localhost, which the guard otherwise rejects.
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_TOKEN', 'dummy-token');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_CAPTURE_LOCAL', 'true');
    vi.resetModules();

    const posthogModule = await import('posthog-js');
    const initMock = vi.mocked(posthogModule.default.init);
    initMock.mockClear();

    const { POSTHOG_INIT_OPTIONS: reloadedOptions } = await import('./instrumentation-client');

    expect(initMock).toHaveBeenCalledWith('dummy-token', reloadedOptions);
  });

  it('disarms the pre-analytics beacon once PostHog has initialized', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_TOKEN', 'dummy-token');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_CAPTURE_LOCAL', 'true');
    vi.resetModules();
    const disarm = vi.fn();
    window.__tplanePreAnalytics = { disarm };
    const posthogModule = await import('posthog-js');
    const initMock = vi.mocked(posthogModule.default.init);
    initMock.mockClear();

    await import('./instrumentation-client');

    expect(initMock).toHaveBeenCalled();
    expect(disarm).toHaveBeenCalledTimes(1);
    // After init, not before: until then only the beacon can see a leave.
    expect(disarm.mock.invocationCallOrder[0]).toBeGreaterThan(initMock.mock.invocationCallOrder[0]);
    delete window.__tplanePreAnalytics;
  });

  it('disarms the pre-analytics beacon when PostHog is not going to run at all', async () => {
    // No token: the gate declines, PostHog never initializes here, so the
    // beacon must not report for it either.
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_TOKEN', '');
    vi.resetModules();
    const disarm = vi.fn();
    window.__tplanePreAnalytics = { disarm };
    const posthogModule = await import('posthog-js');
    const initMock = vi.mocked(posthogModule.default.init);
    initMock.mockClear();

    await import('./instrumentation-client');

    expect(initMock).not.toHaveBeenCalled();
    expect(disarm).toHaveBeenCalledTimes(1);
    delete window.__tplanePreAnalytics;
  });

  it('calls posthog.init on a production host, with no capture-local opt-in', async () => {
    // This exercises the OTHER branch of shouldCaptureAnalytics: a real
    // deployed host, no NEXT_PUBLIC_POSTHOG_CAPTURE_LOCAL at all. A guard
    // rewritten to require captureLocal unconditionally (killing production
    // capture while still passing the localhost-opt-in test above) fails here.
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_TOKEN', 'dummy-token');
    Object.defineProperty(window, 'location', {
      value: { ...window.location, host: 'threadplane.ai', hostname: 'threadplane.ai' },
      writable: true,
      configurable: true,
    });
    vi.resetModules();

    const posthogModule = await import('posthog-js');
    const initMock = vi.mocked(posthogModule.default.init);
    initMock.mockClear();

    const { POSTHOG_INIT_OPTIONS: reloadedOptions } = await import('./instrumentation-client');

    expect(initMock).toHaveBeenCalledWith('dummy-token', reloadedOptions);
  });
});
