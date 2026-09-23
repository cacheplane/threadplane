import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreAnalyticsBeacon } from './PreAnalyticsBeacon';

afterEach(() => vi.unstubAllEnvs());

describe('PreAnalyticsBeacon', () => {
  it('renders nothing without a PostHog token', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_TOKEN', '');
    expect(renderToStaticMarkup(<PreAnalyticsBeacon />)).toBe('');
  });

  it('inlines the beacon with the token and the capture-local setting', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_TOKEN', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_CAPTURE_LOCAL', 'true');
    const html = renderToStaticMarkup(<PreAnalyticsBeacon />);
    expect(html).toMatch(/^<script data-pre-analytics-beacon="">/);
    expect(html).toContain('"token":"phc_test"');
    expect(html).toContain('"captureLocal":true');
    // An inline script, not a request: it must not compete for bandwidth.
    expect(html).not.toContain('src=');
  });
});
