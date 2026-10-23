import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = join(HERE, '..', '..', '..');
const API_ROOT = join(WEBSITE_ROOT, 'src', 'app', 'api');

const ROUTES = ['whitepaper-signup', 'newsletter', 'leads'] as const;

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['filesystem persistence', /from ['"](?:node:)?fs['"]/u],
  ['Loops', /lib\/loops/u],
  ['legacy Resend transport', /lib\/resend/u],
  ['legacy drip scheduler', /lib\/drip/u],
  ['whitepaper drip scheduling', /scheduleWhitepaperDrip/u],
  ['Resend audience upsert', /addToAudience/u],
  ['direct request-time sending', /sendEmail\(/u],
  ['NDJSON lead storage', /\.ndjson/u],
  ['legacy handler', /legacyPost/u],
  ['request-time marketing analytics', /lib\/analytics\/server/u],
];

/**
 * The legacy delivery surface, as it appears in source. Narrower than
 * FORBIDDEN: the whole website is swept for these, and `fs` and marketing
 * analytics remain legitimate outside the acquisition routes.
 */
const LEGACY_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Loops', /lib\/loops/u],
  ['legacy Resend transport', /lib\/resend/u],
  ['legacy drip scheduler', /lib\/drip/u],
  ['legacy email templates', /\.\.\/emails\//u],
  ['whitepaper drip scheduling', /scheduleWhitepaperDrip/u],
  ['Resend audience upsert', /addToAudience/u],
  ['NDJSON lead storage', /\.ndjson/u],
  ['legacy handler', /legacyPost/u],
];

/** Legacy delivery modules the hard cutover removes for good. */
const DELETED_PATHS = [
  'lib/drip.ts',
  'lib/loops.ts',
  'lib/resend.ts',
  'src/app/api/email-preview/route.ts',
  'emails',
] as const;

function routeSource(route: string): string {
  return readFileSync(join(API_ROOT, route, 'route.ts'), 'utf8');
}

/** Every production `.ts`/`.tsx` under the website, excluding specs. */
function productionSources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      found.push(...productionSources(path));
      continue;
    }
    if (!/\.tsx?$/u.test(entry.name)) continue;
    if (/\.spec\.tsx?$/u.test(entry.name)) continue;
    found.push(path);
  }
  return found;
}

describe('hard-cutover form boundary', () => {
  it.each(ROUTES)('/api/%s accepts submissions through Neon only', (route) => {
    const source = routeSource(route);

    for (const [label, pattern] of FORBIDDEN) {
      expect(
        pattern.test(source),
        `/api/${route} must not reference ${label}`
      ).toBe(false);
    }
  });

  it.each(ROUTES)(
    '/api/%s commits through the growth form route seam',
    (route) => {
      const source = routeSource(route);

      expect(source).toContain('lib/growth/form-route');
      expect(source).toContain('dependencies.accept(');
      expect(source).toContain('dependencies.nudge(');
    }
  );
});

describe('legacy delivery surface', () => {
  it.each(DELETED_PATHS)('no longer ships %s', (relativePath) => {
    expect(existsSync(join(WEBSITE_ROOT, relativePath))).toBe(false);
  });

  it('is referenced by no remaining production source', () => {
    const offenders: string[] = [];
    for (const path of productionSources(join(WEBSITE_ROOT, 'src'))) {
      const source = readFileSync(path, 'utf8');
      for (const [, pattern] of LEGACY_PATTERNS) {
        // The boundary spec's own pattern strings are the only allowed match,
        // and it is excluded above as a spec file.
        if (pattern.test(source)) {
          offenders.push(`${path} :: ${String(pattern)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The Resend SDK stays: the verified-webhook route uses it to check Svix
   * signatures. What leaves is the legacy transport wrapper that sent mail
   * straight from a form request.
   */
  it('keeps the Resend SDK for webhook verification only', () => {
    const manifest = JSON.parse(
      readFileSync(join(WEBSITE_ROOT, 'package.json'), 'utf8')
    ) as { dependencies?: Record<string, string> };
    const importers = productionSources(join(WEBSITE_ROOT, 'src')).filter(
      (path) => /from 'resend'/u.test(readFileSync(path, 'utf8'))
    );

    expect(Object.keys(manifest.dependencies ?? {})).toContain('resend');
    expect(importers.map((path) => path.replace(WEBSITE_ROOT, ''))).toEqual([
      '/src/app/api/webhooks/resend/route.ts',
      '/src/app/api/webhooks/resend-inbound/route.ts',
    ]);
  });
});
