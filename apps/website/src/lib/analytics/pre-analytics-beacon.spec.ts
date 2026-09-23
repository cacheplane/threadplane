import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldCaptureAnalytics } from '@threadplane/telemetry/browser';
import {
  PRE_ANALYTICS_EVENT,
  PRE_ANALYTICS_GLOBAL,
  installPreAnalyticsBeacon,
  preAnalyticsBeaconScript,
  type PreAnalyticsBeaconConfig,
} from './pre-analytics-beacon';

const CONFIG: PreAnalyticsBeaconConfig = { token: 'phc_test', captureLocal: false };

const originalLocation = window.location;
let sendBeacon: ReturnType<typeof vi.fn>;

function setLocation(host: string, pathname = '/', search = '') {
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  Object.defineProperty(window, 'location', {
    value: { ...originalLocation, host, hostname, pathname, search },
    writable: true,
    configurable: true,
  });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function handle() {
  return (window as unknown as Record<string, { disarm(): void } | undefined>)[PRE_ANALYTICS_GLOBAL];
}

async function sentPayload(call = 0) {
  const [url, blob] = sendBeacon.mock.calls[call] as [string, Blob];
  return { url, type: blob.type, body: JSON.parse(await blob.text()) };
}

beforeEach(() => {
  sendBeacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  setLocation('threadplane.ai', '/', '?utm_source=x');
});

afterEach(() => {
  handle()?.disarm();
  delete (window as unknown as Record<string, unknown>)[PRE_ANALYTICS_GLOBAL];
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
});

describe('installPreAnalyticsBeacon', () => {
  it('sends one event, in the shape posthog-js itself sends, when the page is left', async () => {
    installPreAnalyticsBeacon(CONFIG);
    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const { url, type, body } = await sentPayload();
    // Same proxy, same IP-less capture and beacon marker posthog-js uses.
    expect(url).toBe('/ingest/i/v0/e/?ip=0&beacon=1');
    expect(type).toBe('application/json');
    expect(body).toMatchObject({
      api_key: 'phc_test',
      event: PRE_ANALYTICS_EVENT,
      properties: {
        $process_person_profile: false,
        $lib: 'tplane-pre-analytics-beacon',
        trigger: 'pagehide',
        viewport_width: window.innerWidth,
      },
    });
    expect(typeof body.distinct_id).toBe('string');
    expect(body.distinct_id.length).toBeGreaterThan(8);
    expect(typeof body.properties.elapsed_ms).toBe('number');
    expect(typeof body.timestamp).toBe('string');
  });

  it('records the pathname only — never the query string', async () => {
    setLocation('threadplane.ai', '/pricing', '?email=someone%40example.com');
    installPreAnalyticsBeacon(CONFIG);
    window.dispatchEvent(new Event('pagehide'));
    const { body } = await sentPayload();
    expect(body.properties.source_page).toBe('/pricing');
    expect(JSON.stringify(body)).not.toContain('example.com');
  });

  it('treats a page going hidden as a leave — mobile browsers often never fire pagehide', async () => {
    installPreAnalyticsBeacon(CONFIG);
    setVisibility('visible');
    expect(sendBeacon).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect((await sentPayload()).body.properties.trigger).toBe('hidden');
  });

  it('sends at most once per document', () => {
    installPreAnalyticsBeacon(CONFIG);
    setVisibility('hidden');
    window.dispatchEvent(new Event('pagehide'));
    setVisibility('hidden');
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('never sends once PostHog has taken over and disarmed it', () => {
    installPreAnalyticsBeacon(CONFIG);
    const installed = handle();
    expect(installed).toBeDefined();
    installed?.disarm();
    window.dispatchEvent(new Event('pagehide'));
    setVisibility('hidden');
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('is idempotent: a second install does not add a second sender', () => {
    installPreAnalyticsBeacon(CONFIG);
    installPreAnalyticsBeacon(CONFIG);
    window.dispatchEvent(new Event('pagehide'));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('does nothing, and throws nothing, in a browser without sendBeacon', () => {
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true });
    installPreAnalyticsBeacon(CONFIG);
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
  });

  it('installs nothing without a token', () => {
    installPreAnalyticsBeacon({ ...CONFIG, token: '' });
    expect(handle()).toBeUndefined();
    window.dispatchEvent(new Event('pagehide'));
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});

describe('the gate matches shouldCaptureAnalytics exactly', () => {
  /**
   * The beacon must fire exactly where PostHog would capture and nowhere else,
   * but it runs before any bundle loads, so it cannot import the real gate. It
   * carries its own copy. This table is what keeps the copy honest: if either
   * side changes, a row disagrees.
   */
  const hosts = [
    'threadplane.ai',
    'threadplane-git-branch-cacheplane.vercel.app',
    'localhost',
    'localhost:3000',
    '127.0.0.1',
    '127.0.0.1:4308',
    '[::1]:3000',
    'LOCALHOST:3000',
    'localhost.example.com',
  ];
  for (const host of hosts) {
    for (const captureLocal of [false, true]) {
      it(`${host}, captureLocal=${captureLocal}`, () => {
        setLocation(host);
        installPreAnalyticsBeacon({ token: 'phc_test', captureLocal });
        const expected = shouldCaptureAnalytics({ token: 'phc_test', captureLocal, host });
        expect(handle() !== undefined).toBe(expected);
      });
    }
  }
});

describe('preAnalyticsBeaconScript', () => {
  /**
   * The function above is inlined into the HTML through its own source text,
   * so it must not reference anything outside its body. Evaluating the exact
   * string that ships — rather than calling the imported function — is what
   * proves that. A helper or module constant used inside the function would
   * pass every test above and throw here.
   */
  it('is self-contained: the shipped string works on its own', async () => {
    new Function(preAnalyticsBeaconScript(CONFIG))();
    window.dispatchEvent(new Event('pagehide'));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect((await sentPayload()).body.event).toBe(PRE_ANALYTICS_EVENT);
  });

  it('cannot be broken out of by the config it embeds', () => {
    const script = preAnalyticsBeaconScript({ token: '</script><script>alert(1)</script>', captureLocal: false });
    expect(script).not.toContain('</script>');
  });
});
