import type { RuntimeEvent } from './types';

// `@threadplane/chat` and `@threadplane/render` moved into `@threadplane/angular`;
// an announcement may still name them for installs of earlier releases.
const ANNOUNCED_PACKAGES = [
  '@threadplane/angular',
  '@threadplane/chat',
  '@threadplane/langgraph',
  '@threadplane/ag-ui',
  '@threadplane/render',
];

const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
function version(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || value.length > 64 || !VERSION.test(value))
    return undefined;
  const result = value.split('.').map(Number);
  return result.every(Number.isSafeInteger) ? result : undefined;
}
function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function publicText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 500 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10) || code === 127;
    })
  );
}

/** Console data only; remote text never becomes a format string, HTML, or executable code. */
export class DevelopmentAnnouncements {
  private identity?: string;
  private seen = new Set<string>();

  display(input: unknown, events: RuntimeEvent[]): void {
    try {
      this.displaySafely(input, events);
    } catch {
      /* A committed acknowledgment is independent of display. */
    }
  }
  private displaySafely(input: unknown, events: RuntimeEvent[]): void {
    if (!Array.isArray(input) || input.length > 5 || !events.length) return;
    const identity = events[0].subject.id;
    const key = `threadplane.growth.announcements.v1:${identity}`;
    if (this.identity !== identity) {
      this.identity = identity;
      this.seen = new Set();
    }
    try {
      const raw = window.localStorage.getItem(key);
      const saved: unknown = raw && raw.length <= 8500 ? JSON.parse(raw) : [];
      if (
        Array.isArray(saved) &&
        saved.length <= 100 &&
        saved.every((id) => typeof id === 'string' && ID.test(id))
      ) {
        this.seen = new Set([...this.seen, ...saved].slice(-100));
      }
    } catch {
      /* Page memory still deduplicates when persistence is blocked. */
    }
    for (const item of input) {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.id !== 'string' ||
        !ID.test(item.id) ||
        this.seen.has(item.id)
      )
        continue;
      if (
        !publicText(item.text) ||
        typeof item.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(item.expiresAt)) ||
        Date.parse(item.expiresAt) <= Date.now()
      )
        continue;
      if (
        !Array.isArray(item.packageNames) ||
        item.packageNames.length > ANNOUNCED_PACKAGES.length ||
        !item.packageNames.every((p: unknown) =>
          ANNOUNCED_PACKAGES.includes(p as string)
        )
      )
        continue;
      const min = version(item.minVersion);
      const max =
        item.maxVersion === undefined ? undefined : version(item.maxVersion);
      if (!min || (item.maxVersion !== undefined && !max)) continue;
      if (
        !events.some((event) => {
          const actual = version(event.properties['packageVersion']);
          return (
            item.packageNames.includes(event.properties['packageName']) &&
            actual &&
            compare(actual, min) >= 0 &&
            (!max || compare(actual, max) < 0)
          );
        })
      )
        continue;
      if (
        item.documentationUrl !== undefined &&
        (typeof item.documentationUrl !== 'string' ||
          item.documentationUrl.length > 300 ||
          !/^https:\/\/threadplane\.ai\/docs(?:\/[a-zA-Z0-9._~-]+)*\/?$/u.test(
            item.documentationUrl
          ))
      )
        continue;
      // Remember before printing: repeated blocked console calls must not become a retry loop.
      this.seen.add(item.id);
      if (this.seen.size > 100) {
        const oldest = this.seen.values().next().value;
        if (oldest) this.seen.delete(oldest);
      }
      try {
        window.localStorage.setItem(key, JSON.stringify([...this.seen]));
      } catch {
        /* Memory fallback. */
      }
      try {
        console.info(
          '[Threadplane] %s',
          item.text +
            (item.documentationUrl ? `\n${item.documentationUrl}` : '')
        );
      } catch {
        /* Console availability cannot change ingestion. */
      }
    }
  }
}
