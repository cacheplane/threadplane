// Note: kept self-contained (no `../shared` import) so ng-packagr can compile
// this entry point in isolation. The trim+truncate hardening is duplicated
// from shared/properties.ts on purpose — it's a few lines, and the alternative
// is a secondary ng-packagr entry point for shared, which is heavier.
function toSafeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

/** Token and browser host inputs for the analytics capture gate, with local capture disabled by default. */
export type CaptureConfig = {
  token?: string;
  captureLocal?: boolean;
  host?: string;
};

/** Recognize localhost, IPv4 loopback, or IPv6 loopback in a browser host string, optionally including a port. */
export function isLocalAnalyticsHost(host: unknown): boolean {
  const value = toSafeString(host, 300)?.toLowerCase();
  if (!value) return false;

  // IPv6 literal `::1` or `[::1]:port` — don't naively split on `:`.
  if (value === '::1' || value.startsWith('[::1]')) return true;

  const hostname = value.split(':')[0];
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/** Require a nonblank token and exclude recognized local hosts unless `captureLocal` is true. */
export function shouldCaptureAnalytics({ token, captureLocal = false, host }: CaptureConfig): boolean {
  if (!toSafeString(token, 500)) return false;
  if (isLocalAnalyticsHost(host) && !captureLocal) return false;
  return true;
}
