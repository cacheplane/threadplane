# Demo Metadata and SEO Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the two deployed demos (`demo.threadplane.ai`, `ag-ui.threadplane.ai`) a brand favicon, real titles and descriptions, social cards, a `robots.txt`, and `noindex` on the iframe-only routes.

**Architecture:** Static `index.html` heads plus committed `public/` assets per demo; a shared Vercel route table in `scripts/demo-routes.ts` used by both assemblers; the website owns the copy in `apps/website/src/lib/demo-meta.ts`, renders the cards from the existing card chrome, and a vitest guard reads the demos' files from disk so the duplicated copy and icons cannot drift.

**Tech Stack:** Angular 20 `@angular/build:application` (static index + assets), Vercel Build Output API v3 routes, Next.js `ImageResponse` (Satori) card routes, vitest (website project, jsdom; scripts project, node), Node `.mjs` exporter.

Spec: `docs/superpowers/specs/2026-10-05-demo-metadata-seo-polish-design.md`.

Commit policy (AGENTS.md): no mid-task commits. Three logical commits are marked below.

---

## File map

| Path | Responsibility |
| --- | --- |
| `apps/website/src/lib/demo-meta.ts` | **Create.** Single source of truth: per-demo origin, title, description, card copy, alt. |
| `apps/website/src/lib/demo-meta.spec.ts` | **Create.** Drift guard: reads both demos' `index.html`, icons, robots, card PNG. |
| `apps/website/src/app/card/chrome.tsx` | **Modify.** `Frame` gains `url` prop; new `Itinerary` component. |
| `apps/website/src/app/card/demo-card.tsx` | **Create.** `renderDemoCard(meta)` layout. |
| `apps/website/src/app/card/demo-card.spec.ts` | **Create.** Size, readable floor, copy sourced from `demo-meta`. |
| `apps/website/src/app/demo-card/langgraph/route.tsx` | **Create.** Static PNG route. |
| `apps/website/src/app/demo-card/ag-ui/route.tsx` | **Create.** Static PNG route. |
| `scripts/export-demo-cards.mjs` | **Create.** Fetch both routes, verify 1200x630, write PNGs into the demos. |
| `scripts/demo-routes.ts` | **Create.** Shared Vercel route table with the `noindex` header route. |
| `scripts/demo-routes.spec.ts` | **Create.** Pattern + table shape assertions. |
| `scripts/assemble-demo.ts` | **Modify.** Use `demoRoutes('^/api/(.*)')`. |
| `scripts/assemble-ag-ui-demo.ts` | **Modify.** Use `demoRoutes('^/agent(/.*)?$')`. |
| `examples/chat/angular/src/index.html` | **Modify.** Full head. |
| `examples/ag-ui/angular/src/index.html` | **Modify.** Full head. |
| `examples/chat/angular/public/{favicon.ico,icon.svg,robots.txt,social-card.png}` | **Replace/Create.** |
| `examples/ag-ui/angular/public/{favicon.ico,icon.svg,robots.txt,social-card.png}` | **Replace/Create.** |
| `package.json` | **Modify.** `card:demos` script. |
| `docs/brand/README.md` | **Modify.** Demo cards section. |
| `.github/workflows/ci.yml` | **Modify.** Add `scripts/demo-routes.ts` to both demo deploy gates. |

---

### Task 1: `demo-meta.ts` — the copy module

**Files:**
- Create: `apps/website/src/lib/demo-meta.ts`
- Test: `apps/website/src/lib/demo-meta.spec.ts` (first half; the file-reading half is Task 7)

- [ ] **Step 1: Write the failing spec**

```ts
// apps/website/src/lib/demo-meta.spec.ts
import { describe, expect, it } from 'vitest';
import { DEMOS } from './demos';
import { DEMO_META, SOCIAL_CARD_PATH, SOCIAL_CARD_SIZE, canonicalUrl, demoMeta, socialCardUrl } from './demo-meta';
import { clampMetaDescription } from './site-metadata';

describe('demo meta', () => {
  it('covers exactly the demos the website links to', () => {
    // Mutation guard: an emptied list would pass every per-entry assertion.
    expect(DEMO_META.length).toBe(2);
    expect(DEMO_META.map((m) => m.key).sort()).toEqual(DEMOS.map((d) => d.key).sort());
  });

  it.each(DEMO_META)('$key origin is the link registry href', (meta) => {
    expect(meta.origin).toBe(DEMOS.find((d) => d.key === meta.key)?.href);
    expect(meta.origin).toMatch(/^https:\/\/[a-z0-9.-]+$/u);
  });

  it.each(DEMO_META)('$key title follows the "Page — Threadplane" convention', (meta) => {
    expect(meta.title).toMatch(/ — Threadplane$/u);
    expect(meta.title.length).toBeLessThanOrEqual(60);
  });

  it.each(DEMO_META)('$key description fits a search snippet untruncated', (meta) => {
    expect(clampMetaDescription(meta.description)).toBe(meta.description);
  });

  it.each(DEMO_META)('$key card copy is populated', (meta) => {
    expect(meta.cardEyebrow).toBe('LIVE DEMO');
    expect(meta.cardHeadlineLines.length).toBeGreaterThanOrEqual(2);
    expect(meta.cardSubhead.length).toBeGreaterThan(20);
    expect(meta.runtimeLabel).toMatch(/^(LangGraph|AG-UI)$/u);
    expect(meta.cardAlt).toContain(new URL(meta.origin).host);
  });

  it('derives the canonical and card URLs from the origin', () => {
    const lg = demoMeta('langgraph');
    expect(canonicalUrl(lg)).toBe('https://demo.threadplane.ai/');
    expect(socialCardUrl(lg)).toBe(`https://demo.threadplane.ai${SOCIAL_CARD_PATH}`);
    expect(SOCIAL_CARD_SIZE).toEqual({ width: 1200, height: 630 });
  });

  it('throws for an unknown key rather than returning undefined', () => {
    expect(() => demoMeta('nope' as never)).toThrow(/nope/u);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx nx test website -- --run src/lib/demo-meta.spec.ts`
Expected: FAIL — `Cannot find module './demo-meta'`.

- [ ] **Step 3: Write the module**

```ts
// apps/website/src/lib/demo-meta.ts
/**
 * Metadata for the two deployed demos, in one place.
 *
 * The demos are static Angular apps whose `index.html` cannot import this
 * module, so each one carries a copy of its title and description. The copy
 * here is the source of truth: `demo-meta.spec.ts` reads both `index.html`
 * files off disk and fails when they disagree, and the `/demo-card/*` routes
 * render the social cards from it.
 */
import { DEMOS, type DemoTarget } from './demos';

export const SOCIAL_CARD_PATH = '/social-card.png';
export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;

export interface DemoMeta {
  key: DemoTarget['key'];
  /** `https://host`, no trailing slash. From the link registry so hrefs cannot drift. */
  origin: string;
  /** `<title>`, `og:title`, `twitter:title`. */
  title: string;
  /** `meta[name=description]`, `og:description`, `twitter:description`. */
  description: string;
  cardEyebrow: string;
  cardHeadlineLines: readonly string[];
  cardSubhead: string;
  /** Runtime pill on the card. */
  runtimeLabel: string;
  /** `og:image:alt` / `twitter:image:alt` — describes what the card shows. */
  cardAlt: string;
}

function originOf(key: DemoTarget['key']): string {
  const target = DEMOS.find((d) => d.key === key);
  if (!target) throw new Error(`No demo link registered for "${key}"`);
  return target.href.replace(/\/$/u, '');
}

export const DEMO_META: readonly DemoMeta[] = [
  {
    key: 'langgraph',
    origin: originOf('langgraph'),
    title: 'LangGraph chat demo — Threadplane',
    description:
      'Live Angular chat on LangGraph: streaming, durable threads, human approvals, tool progress, and generative UI. Embed, popup, and sidebar layouts.',
    cardEyebrow: 'LIVE DEMO',
    cardHeadlineLines: ['Angular chat', 'on LangGraph.'],
    cardSubhead:
      'Streaming, durable threads, human approvals, tool progress, and generative UI — running live.',
    runtimeLabel: 'LangGraph',
    cardAlt:
      'LangGraph chat demo — Threadplane. Beside the title, a browser frame at demo.threadplane.ai shows an agent proposing to delete three backups and pausing for Approve or Decline.',
  },
  {
    key: 'ag-ui',
    origin: originOf('ag-ui'),
    title: 'AG-UI itinerary demo — Threadplane',
    description:
      'Live Angular demo on an AG-UI backend: an agent plans a trip and edits a live itinerary and map while you watch. Streaming, client tools, and approvals.',
    cardEyebrow: 'LIVE DEMO',
    cardHeadlineLines: ['An agent that', 'edits the UI.'],
    cardSubhead:
      'Ask for a trip and the agent fills a live itinerary and map over AG-UI — streaming, client tools, approvals.',
    runtimeLabel: 'AG-UI',
    cardAlt:
      'AG-UI itinerary demo — Threadplane. Beside the title, a browser frame at ag-ui.threadplane.ai shows a trip request and three itinerary days the agent filled in.',
  },
];

export function demoMeta(key: DemoTarget['key']): DemoMeta {
  const meta = DEMO_META.find((m) => m.key === key);
  if (!meta) throw new Error(`No demo metadata for "${key}"`);
  return meta;
}

export const canonicalUrl = (meta: DemoMeta): string => `${meta.origin}/`;
export const socialCardUrl = (meta: DemoMeta): string => `${meta.origin}${SOCIAL_CARD_PATH}`;
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npx nx test website -- --run src/lib/demo-meta.spec.ts`
Expected: PASS (7 tests).

---

### Task 2: Shared Vercel route table

**Files:**
- Create: `scripts/demo-routes.ts`
- Test: `scripts/demo-routes.spec.ts`
- Modify: `scripts/assemble-demo.ts:91-98`, `scripts/assemble-ag-ui-demo.ts:91-98`

- [ ] **Step 1: Write the failing spec**

```ts
// scripts/demo-routes.spec.ts
import { describe, expect, it } from 'vitest';
import { NOINDEX_ROUTE_PATTERN, demoRoutes } from './demo-routes';

const noindex = new RegExp(NOINDEX_ROUTE_PATTERN, 'u');

describe('demo routes', () => {
  it.each(['/hero', '/stage', '/hero/anything', '/stage/x/y'])('noindex matches %s', (path) => {
    expect(noindex.test(path)).toBe(true);
  });

  it.each(['/', '/embed', '/embed/thread-1', '/popup', '/sidebar', '/heroic', '/stages', '/api/x'])(
    'noindex does not match %s',
    (path) => {
      expect(noindex.test(path)).toBe(false);
    },
  );

  it('puts the noindex header route first, with continue so routing proceeds', () => {
    const [first] = demoRoutes('^/api/(.*)');
    expect(first).toEqual({
      src: NOINDEX_ROUTE_PATTERN,
      headers: { 'X-Robots-Tag': 'noindex' },
      continue: true,
    });
  });

  it('keeps the API route, filesystem handle and SPA fallback in order', () => {
    const routes = demoRoutes('^/agent(/.*)?$');
    expect(routes.slice(1)).toEqual([
      { src: '^/agent(/.*)?$', dest: '/api/[[...path]]', check: true },
      { handle: 'filesystem' },
      { src: '.*', dest: '/index.html' },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx nx test scripts -- --run demo-routes.spec.ts`
Expected: FAIL — cannot find `./demo-routes`.

- [ ] **Step 3: Write the module**

```ts
// scripts/demo-routes.ts
/**
 * Vercel Build Output API v3 route table shared by scripts/assemble-demo.ts
 * and scripts/assemble-ag-ui-demo.ts.
 *
 * `/hero` and `/stage` exist only to be iframed by the threadplane.ai
 * homepage; indexed on their own they would be chrome-less search results.
 * `continue: true` applies the header and keeps routing, so the SPA fallback
 * below still serves them — the same shape scripts/assemble-examples.ts uses
 * for its CSP headers. The AG-UI demo has no such routes; the shared table
 * keeps both assemblers identical rather than special-casing one.
 *
 * robots.txt stays allow-all on purpose: `noindex` only takes effect on a
 * page the crawler is allowed to fetch.
 */
export const NOINDEX_ROUTE_PATTERN = '^/(hero|stage)(/.*)?$';

export interface VercelRoute {
  src?: string;
  dest?: string;
  headers?: Record<string, string>;
  continue?: boolean;
  check?: boolean;
  handle?: 'filesystem';
}

export function demoRoutes(apiSrc: string): VercelRoute[] {
  return [
    { src: NOINDEX_ROUTE_PATTERN, headers: { 'X-Robots-Tag': 'noindex' }, continue: true },
    { src: apiSrc, dest: '/api/[[...path]]', check: true },
    { handle: 'filesystem' },
    { src: '.*', dest: '/index.html' },
  ];
}
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npx nx test scripts -- --run demo-routes.spec.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Use it in both assemblers**

In `scripts/assemble-demo.ts`, add after the `path` import:

```ts
import { demoRoutes } from './demo-routes';
```

and replace

```ts
writeFileSync(resolve(outputDir, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/api/(.*)', dest: '/api/[[...path]]', check: true },
    { handle: 'filesystem' },
    { src: '.*', dest: '/index.html' },
  ],
}, null, 2));
```

with

```ts
writeFileSync(resolve(outputDir, 'config.json'), JSON.stringify({
  version: 3,
  routes: demoRoutes('^/api/(.*)'),
}, null, 2));
```

In `scripts/assemble-ag-ui-demo.ts`, same import, and replace the block whose first route is `{ src: '^/agent(/.*)?$', ... }` with:

```ts
writeFileSync(resolve(outputDir, 'config.json'), JSON.stringify({
  version: 3,
  routes: demoRoutes('^/agent(/.*)?$'),
}, null, 2));
```

- [ ] **Step 6: Verify the assembler emits the header route**

Run: `npx tsx scripts/assemble-demo.ts --skip-build && node -e "const c=require('./deploy/demo/.vercel/output/config.json');console.log(JSON.stringify(c.routes[0]))"`
Expected: `{"src":"^/(hero|stage)(/.*)?$","headers":{"X-Robots-Tag":"noindex"},"continue":true}`. (Requires a prior `npx nx build examples-chat-angular --configuration=production`; if `dist/examples/chat/angular` is missing, run that first.)

---

### Task 3: Demo `public/` assets

**Files:**
- Replace: `examples/chat/angular/public/favicon.ico`, `examples/ag-ui/angular/public/favicon.ico`
- Create: `examples/chat/angular/public/icon.svg`, `examples/ag-ui/angular/public/icon.svg`
- Create: `examples/chat/angular/public/robots.txt`, `examples/ag-ui/angular/public/robots.txt`

- [ ] **Step 1: Copy the brand icons**

```bash
cp apps/website/public/favicon.ico examples/chat/angular/public/favicon.ico
cp apps/website/public/favicon.ico examples/ag-ui/angular/public/favicon.ico
cp apps/website/src/app/icon.svg examples/chat/angular/public/icon.svg
cp apps/website/src/app/icon.svg examples/ag-ui/angular/public/icon.svg
```

- [ ] **Step 2: Verify the Nx icon is gone**

Run: `md5 apps/website/public/favicon.ico examples/chat/angular/public/favicon.ico examples/ag-ui/angular/public/favicon.ico`
Expected: three identical hashes, none equal to `d4d62b2ac4cfa63ade7f1766fb098bc5` (the Nx default).

- [ ] **Step 3: Write robots.txt (identical in both)**

```
User-agent: *
Allow: /
```

Write it to `examples/chat/angular/public/robots.txt` and `examples/ag-ui/angular/public/robots.txt` with a trailing newline.

---

### Task 4: Demo `index.html` heads

**Files:**
- Modify: `examples/chat/angular/src/index.html`
- Modify: `examples/ag-ui/angular/src/index.html`

- [ ] **Step 1: LangGraph demo head**

Replace the `<title>` line and the `<link rel="icon" …>` line in `examples/chat/angular/src/index.html`. Keep the pre-bootstrap script and Material Symbols links exactly as they are. The result:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>LangGraph chat demo — Threadplane</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!-- Copy below is mirrored from apps/website/src/lib/demo-meta.ts; its spec reads this file. -->
    <meta
      name="description"
      content="Live Angular chat on LangGraph: streaming, durable threads, human approvals, tool progress, and generative UI. Embed, popup, and sidebar layouts."
    />
    <link rel="canonical" href="https://demo.threadplane.ai/" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0f1116" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Threadplane" />
    <meta property="og:url" content="https://demo.threadplane.ai/" />
    <meta property="og:title" content="LangGraph chat demo — Threadplane" />
    <meta
      property="og:description"
      content="Live Angular chat on LangGraph: streaming, durable threads, human approvals, tool progress, and generative UI. Embed, popup, and sidebar layouts."
    />
    <meta property="og:image" content="https://demo.threadplane.ai/social-card.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta
      property="og:image:alt"
      content="LangGraph chat demo — Threadplane. Beside the title, a browser frame at demo.threadplane.ai shows an agent proposing to delete three backups and pausing for Approve or Decline."
    />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@threadplane" />
    <meta name="twitter:creator" content="@blovedev" />
    <meta name="twitter:title" content="LangGraph chat demo — Threadplane" />
    <meta
      name="twitter:description"
      content="Live Angular chat on LangGraph: streaming, durable threads, human approvals, tool progress, and generative UI. Embed, popup, and sidebar layouts."
    />
    <meta name="twitter:image" content="https://demo.threadplane.ai/social-card.png" />
    <meta
      name="twitter:image:alt"
      content="LangGraph chat demo — Threadplane. Beside the title, a browser frame at demo.threadplane.ai shows an agent proposing to delete three backups and pausing for Approve or Decline."
    />
    <!-- A2UI Icon component renders Material Symbols by ligature name. -->
    …(existing preconnect + stylesheet links, unchanged)…
    <script>
      …(existing pre-bootstrap script, unchanged)…
    </script>
    <link rel="icon" href="favicon.ico" sizes="32x32" />
    <link rel="icon" type="image/svg+xml" href="icon.svg" />
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>
```

- [ ] **Step 2: AG-UI demo head**

Same structure in `examples/ag-ui/angular/src/index.html`, with these values:

- `<title>AG-UI itinerary demo — Threadplane</title>`
- description / og:description / twitter:description: `Live Angular demo on an AG-UI backend: an agent plans a trip and edits a live itinerary and map while you watch. Streaming, client tools, and approvals.`
- canonical / og:url: `https://ag-ui.threadplane.ai/`
- og:title / twitter:title: `AG-UI itinerary demo — Threadplane`
- og:image / twitter:image: `https://ag-ui.threadplane.ai/social-card.png`
- og:image:alt / twitter:image:alt: `AG-UI itinerary demo — Threadplane. Beside the title, a browser frame at ag-ui.threadplane.ai shows a trip request and three itinerary days the agent filled in.`
- theme-color pair identical (`#0f1116` dark, `#ffffff` light — the AG-UI stylesheet uses the same two values).
- Same two icon links.

- [ ] **Step 3: Build both demos to prove the HTML still parses and assets copy**

Run: `npx nx run-many -t build --projects=examples-chat-angular,examples-ag-ui-angular --configuration=production --skip-nx-cache`
Expected: both succeed. Then `ls dist/examples/chat/angular/ dist/examples/ag-ui/angular/ | grep -E 'favicon|icon.svg|robots'` lists `favicon.ico`, `icon.svg`, `robots.txt` in each. (Budgets: these edits add no JS; the initial budget stays untouched.)

- [ ] **Step 4: Commit 1 of 3**

```bash
git add examples/chat/angular/src/index.html examples/ag-ui/angular/src/index.html \
  examples/chat/angular/public examples/ag-ui/angular/public \
  scripts/demo-routes.ts scripts/demo-routes.spec.ts scripts/assemble-demo.ts scripts/assemble-ag-ui-demo.ts
git commit -m "feat(demos): brand favicon, head metadata, robots, noindex iframe routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(`social-card.png` is not yet present; it lands in commit 2 together with the renderer that produces it.)

---

### Task 5: Card chrome — `Frame.url` and `Itinerary`

**Files:**
- Modify: `apps/website/src/app/card/chrome.tsx:101-157` (Frame) and append `Itinerary`.

- [ ] **Step 1: Give `Frame` a `url` prop**

Change the signature and the URL pill:

```tsx
export function Frame({
  width,
  url = 'demo.threadplane.ai',
  children,
}: {
  width: number;
  /** Text in the mono address pill. Defaults to the canonical demo host. */
  url?: string;
  children: React.ReactNode;
}) {
```

and replace the literal `demo.threadplane.ai` inside the pill `<div>` with `{url}`.

- [ ] **Step 2: Add `Itinerary` after `Conversation`**

```tsx
/**
 * What the AG-UI card's frame holds: one ask, three days the agent filled in.
 *
 * Drawn for the same reason as `Conversation`: the real App-mode screenshot
 * is a map with a side panel, which at feed scale is a grey rectangle. Three
 * short rows read at 0.42x; nothing here is below MIN_READABLE_PX.
 */
export function Itinerary() {
  const days: ReadonlyArray<readonly [string, string]> = [
    ['Day 1', 'Santa Monica Pier at sunset'],
    ['Day 2', 'Griffith Observatory, then tacos'],
    ['Day 3', 'Getty Center, red-eye to JFK'],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '26px 26px 28px', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', padding: '12px 18px', borderRadius: 14, background: CARD.dim, fontSize: 22, color: CARD.ink }}>
          Plan three days in LA.
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {days.map(([day, plan]) => (
          <div
            key={day}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '10px 14px',
              borderRadius: 10,
              border: `1px solid ${CARD.border}`,
              background: CARD.canvas,
            }}
          >
            <div style={{ display: 'flex', fontFamily: 'JetBrains Mono', fontSize: 18, fontWeight: 700, color: CARD.accent }}>
              {day}
            </div>
            <div style={{ display: 'flex', fontSize: 20, lineHeight: 1.3, color: CARD.ink }}>{plan}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### Task 6: Card renderer, routes, export script, PNGs

**Files:**
- Create: `apps/website/src/app/card/demo-card.tsx`
- Create: `apps/website/src/app/demo-card/langgraph/route.tsx`
- Create: `apps/website/src/app/demo-card/ag-ui/route.tsx`
- Test: `apps/website/src/app/card/demo-card.spec.ts`
- Create: `scripts/export-demo-cards.mjs`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Write the failing spec**

```ts
// apps/website/src/app/card/demo-card.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIN_READABLE_PX } from './tokens';
import { DEMO_META, SOCIAL_CARD_SIZE } from '../../lib/demo-meta';

const CARD_FILE = join(__dirname, 'demo-card.tsx');
const CHROME_FILE = join(__dirname, 'chrome.tsx');
const ROUTES = ['langgraph', 'ag-ui'].map((key) => join(__dirname, '..', 'demo-card', key, 'route.tsx'));

function fontSizes(source: string): number[] {
  return [...source.matchAll(/fontSize:\s*(\d+)/gu)].map((m) => Number(m[1]));
}

describe('demo cards', () => {
  it('render at the Open Graph feed size the demos advertise', () => {
    expect(SOCIAL_CARD_SIZE).toEqual({ width: 1200, height: 630 });
    expect(readFileSync(CARD_FILE, 'utf8')).toContain('SOCIAL_CARD_SIZE');
  });

  it('set no type below the readable floor', () => {
    for (const file of [CARD_FILE, CHROME_FILE]) {
      const sizes = fontSizes(readFileSync(file, 'utf8'));
      expect(sizes.length).toBeGreaterThan(0);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(MIN_READABLE_PX);
    }
  });

  it.each(ROUTES)('%s takes its copy from demo-meta, not literals', (route) => {
    const source = readFileSync(route, 'utf8');
    expect(source).toContain("from '../../../lib/demo-meta'");
    expect(source).toContain("export const dynamic = 'force-static'");
    for (const meta of DEMO_META) {
      expect(source).not.toContain(meta.title);
      expect(source).not.toContain(meta.description);
    }
  });

  it('frames each demo under its own host', () => {
    const source = readFileSync(CARD_FILE, 'utf8');
    expect(source).toContain('new URL(meta.origin).host');
    expect(source).toContain('<Itinerary />');
    expect(source).toContain('<Conversation />');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx nx test website -- --run src/app/card/demo-card.spec.ts`
Expected: FAIL — `ENOENT … demo-card.tsx`.

- [ ] **Step 3: Write the renderer**

```tsx
// apps/website/src/app/card/demo-card.tsx
/**
 * Social card for a deployed demo, 1200x630.
 *
 * Same ground, rail, pills, wordmark and browser frame as the site's default
 * card in `../opengraph-image.tsx`, so a demo link and a site link unfurl as
 * one product. The frame shows what that demo does: the approval loop for
 * LangGraph, the agent-filled itinerary for AG-UI.
 */
import { ImageResponse } from 'next/og';
import type { DemoMeta } from '../../lib/demo-meta';
import { SOCIAL_CARD_SIZE } from '../../lib/demo-meta';
import { loadCardFonts } from '../og-font';
import { CARD } from './tokens';
import { Conversation, Frame, Itinerary, Pills, Rail, Wordmark } from './chrome';

export async function renderDemoCard(meta: DemoMeta): Promise<ImageResponse> {
  const fonts = await loadCardFonts({ mono: true });
  const host = new URL(meta.origin).host;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: CARD.ground,
          fontFamily: 'Archivo, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', width: 600, padding: '58px 0 58px 64px', justifyContent: 'center' }}>
          <Rail text={meta.cardEyebrow} />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: 22,
              fontFamily: 'Archivo Black, sans-serif',
              fontSize: 60,
              lineHeight: 1.04,
              letterSpacing: '-0.02em',
              color: CARD.ink,
            }}
          >
            {meta.cardHeadlineLines.map((line) => (
              <div key={line} style={{ display: 'flex' }}>
                {line}
              </div>
            ))}
          </div>
          {/* 530 is the widest the 600px column's 64px padding allows; the
              column is centred in a fixed-height card, so a subhead that runs
              long collides with the pills rather than pushing them down. */}
          <div style={{ display: 'flex', marginTop: 20, fontSize: 20, lineHeight: 1.45, color: CARD.inkSecondary, maxWidth: 530 }}>
            {meta.cardSubhead}
          </div>
          <div style={{ display: 'flex', marginTop: 26 }}>
            <Pills runtimes={meta.runtimeLabel} />
          </div>
          <div style={{ display: 'flex', marginTop: 30 }}>
            <Wordmark />
          </div>
        </div>

        {/* Absolutely positioned so the frame keeps its size whatever the copy does. */}
        <div style={{ display: 'flex', position: 'absolute', top: 150, left: 656 }}>
          <Frame width={480} url={host}>
            {meta.key === 'ag-ui' ? <Itinerary /> : <Conversation />}
          </Frame>
        </div>
      </div>
    ),
    { ...SOCIAL_CARD_SIZE, fonts },
  );
}
```

- [ ] **Step 4: Write the two routes**

```tsx
// apps/website/src/app/demo-card/langgraph/route.tsx
/**
 * Social card for demo.threadplane.ai. Exported into
 * examples/chat/angular/public/social-card.png by scripts/export-demo-cards.mjs;
 * the demo's index.html points og:image at that committed file, not here.
 *
 * Static, so a Satori markup error fails `nx build website` instead of
 * 500ing in public.
 */
import { demoMeta } from '../../../lib/demo-meta';
import { renderDemoCard } from '../../card/demo-card';

export const dynamic = 'force-static';
export const runtime = 'nodejs';

export async function GET() {
  return renderDemoCard(demoMeta('langgraph'));
}
```

```tsx
// apps/website/src/app/demo-card/ag-ui/route.tsx
/**
 * Social card for ag-ui.threadplane.ai. Exported into
 * examples/ag-ui/angular/public/social-card.png by scripts/export-demo-cards.mjs;
 * the demo's index.html points og:image at that committed file, not here.
 *
 * Static, so a Satori markup error fails `nx build website` instead of
 * 500ing in public.
 */
import { demoMeta } from '../../../lib/demo-meta';
import { renderDemoCard } from '../../card/demo-card';

export const dynamic = 'force-static';
export const runtime = 'nodejs';

export async function GET() {
  return renderDemoCard(demoMeta('ag-ui'));
}
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `npx nx test website -- --run src/app/card/demo-card.spec.ts src/app/card/github-card.spec.ts src/app/card/card.spec.ts`
Expected: PASS. (The existing `github-card.spec.ts` readable-floor test scans only its route; the new `Itinerary` sizes are 18, 20, 22, all at or above the floor.)

- [ ] **Step 6: Write the export script**

```js
// scripts/export-demo-cards.mjs
/**
 * Writes each deployed demo's social card PNG into that demo's public/.
 *
 * The demos are static Angular apps on their own Vercel projects, so their
 * og:image cannot be a route on threadplane.ai that renders at request time
 * — it has to be a file the demo itself serves. The PNGs are committed so the
 * bytes a share preview will show are reviewable in a diff, and so a brand
 * change produces a visible diff rather than a silent one.
 *
 * Usage:
 *   node scripts/export-demo-cards.mjs
 *   node scripts/export-demo-cards.mjs --origin http://localhost:3000
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ORIGIN = 'https://threadplane.ai';

/**
 * Kept in sync BY HAND with SOCIAL_CARD_SIZE in
 * apps/website/src/lib/demo-meta.ts — this is a .mjs script and cannot import
 * from the Next app's TypeScript module graph. Change one, change the other.
 */
const EXPECTED = { width: 1200, height: 630 };

const CARDS = [
  { route: '/demo-card/langgraph', output: join('examples', 'chat', 'angular', 'public', 'social-card.png') },
  { route: '/demo-card/ag-ui', output: join('examples', 'ag-ui', 'angular', 'public', 'social-card.png') },
];

function parseOrigin(argv) {
  const at = argv.indexOf('--origin');
  if (at === -1) return DEFAULT_ORIGIN;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error('--origin needs a value, e.g. --origin http://localhost:3000');
    process.exit(1);
  }
  return value;
}

/** PNG IHDR is always the first chunk: 8-byte signature, 4 length, 4 type, then two BE32 dimensions. */
function readPngSize(buffer) {
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function exportCard(origin, { route, output }) {
  const url = new URL(route, origin).toString();
  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    console.error(`Could not reach ${url}: ${cause.message}`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    process.exit(1);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const size = readPngSize(buffer);
  if (!size) {
    console.error(`${url} did not return a PNG. Got content-type: ${response.headers.get('content-type')}`);
    process.exit(1);
  }
  if (size.width !== EXPECTED.width || size.height !== EXPECTED.height) {
    console.error(`${url} returned ${size.width}x${size.height}, expected ${EXPECTED.width}x${EXPECTED.height}.`);
    process.exit(1);
  }
  const target = join(REPO_ROOT, output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  console.log(`Wrote ${output} (${size.width}x${size.height}, ${buffer.length} bytes) from ${url}`);
}

const origin = parseOrigin(process.argv.slice(2));
for (const card of CARDS) {
  await exportCard(origin, card);
}
console.log('');
console.log('Look at both PNGs before committing: a missing bundled font still renders a valid PNG in the fallback face.');
```

- [ ] **Step 7: Wire the npm script**

In `package.json`, after `"card:github": "node scripts/export-github-card.mjs",` add:

```json
    "card:demos": "node scripts/export-demo-cards.mjs",
```

- [ ] **Step 8: Render the PNGs from a local website serve**

Production does not have the routes yet, so serve locally. Use the preview tool (`preview_start` with the website's launch config) or, in a terminal, `npx nx serve website` on port 3000. Then:

Run: `npm run card:demos -- --origin http://localhost:3000`
Expected: two `Wrote …` lines, each `1200x630`.

Then view both PNGs (Read tool on `examples/chat/angular/public/social-card.png` and `examples/ag-ui/angular/public/social-card.png`) and confirm: brand fonts rendered (Archivo Black headline, mono eyebrow), the AG-UI frame reads `ag-ui.threadplane.ai` and shows three day rows, the LangGraph frame reads `demo.threadplane.ai` and shows Approve/Decline, no text clipping against the pills or the right edge.

If the subhead collides with the pills, shorten `cardSubhead` in `demo-meta.ts` (not the layout) and re-export.

---

### Task 7: Drift guard — the file-reading half of `demo-meta.spec.ts`

**Files:**
- Modify: `apps/website/src/lib/demo-meta.spec.ts` (append)

- [ ] **Step 1: Append the on-disk assertions**

```ts
// append to apps/website/src/lib/demo-meta.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_X_CREATOR, SITE_X_SITE } from './site-metadata';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const DEMO_DIRS: Record<string, string> = {
  langgraph: join(REPO_ROOT, 'examples', 'chat', 'angular'),
  'ag-ui': join(REPO_ROOT, 'examples', 'ag-ui', 'angular'),
};

function parseHead(key: string): Document {
  const html = readFileSync(join(DEMO_DIRS[key], 'src', 'index.html'), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}
const content = (doc: Document, selector: string): string | null =>
  doc.querySelector(selector)?.getAttribute('content') ?? null;

function pngSize(path: string): { width: number; height: number } | null {
  const buffer = readFileSync(path);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('deployed demo index.html mirrors demo-meta', () => {
  /**
   * The demos' heads are static HTML and cannot import demo-meta.ts, so the
   * copy is duplicated there. This is the test that makes that duplication
   * safe: change the title here and forget the HTML, and this fails.
   */
  it.each(DEMO_META)('$key head carries the title, description and canonical', (meta) => {
    const doc = parseHead(meta.key);
    expect(doc.querySelector('title')?.textContent).toBe(meta.title);
    expect(content(doc, 'meta[name="description"]')).toBe(meta.description);
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(canonicalUrl(meta));
  });

  it.each(DEMO_META)('$key head carries complete Open Graph tags', (meta) => {
    const doc = parseHead(meta.key);
    expect(content(doc, 'meta[property="og:type"]')).toBe('website');
    expect(content(doc, 'meta[property="og:site_name"]')).toBe('Threadplane');
    expect(content(doc, 'meta[property="og:url"]')).toBe(canonicalUrl(meta));
    expect(content(doc, 'meta[property="og:title"]')).toBe(meta.title);
    expect(content(doc, 'meta[property="og:description"]')).toBe(meta.description);
    expect(content(doc, 'meta[property="og:image"]')).toBe(socialCardUrl(meta));
    expect(content(doc, 'meta[property="og:image:width"]')).toBe(String(SOCIAL_CARD_SIZE.width));
    expect(content(doc, 'meta[property="og:image:height"]')).toBe(String(SOCIAL_CARD_SIZE.height));
    expect(content(doc, 'meta[property="og:image:alt"]')).toBe(meta.cardAlt);
  });

  it.each(DEMO_META)('$key head carries complete Twitter card tags', (meta) => {
    const doc = parseHead(meta.key);
    expect(content(doc, 'meta[name="twitter:card"]')).toBe('summary_large_image');
    expect(content(doc, 'meta[name="twitter:site"]')).toBe(SITE_X_SITE);
    expect(content(doc, 'meta[name="twitter:creator"]')).toBe(SITE_X_CREATOR);
    expect(content(doc, 'meta[name="twitter:title"]')).toBe(meta.title);
    expect(content(doc, 'meta[name="twitter:description"]')).toBe(meta.description);
    expect(content(doc, 'meta[name="twitter:image"]')).toBe(socialCardUrl(meta));
    expect(content(doc, 'meta[name="twitter:image:alt"]')).toBe(meta.cardAlt);
  });

  it.each(DEMO_META)('$key head links both icon formats', (meta) => {
    const doc = parseHead(meta.key);
    expect(doc.querySelector('link[rel="icon"][href="favicon.ico"]')).not.toBeNull();
    expect(doc.querySelector('link[rel="icon"][type="image/svg+xml"][href="icon.svg"]')).not.toBeNull();
  });

  it.each(DEMO_META)('$key theme-color matches the page background tokens', (meta) => {
    const doc = parseHead(meta.key);
    expect(content(doc, 'meta[name="theme-color"][media="(prefers-color-scheme: dark)"]')).toBe('#0f1116');
    expect(content(doc, 'meta[name="theme-color"][media="(prefers-color-scheme: light)"]')).toBe('#ffffff');
  });
});

describe('deployed demo public assets', () => {
  /**
   * Both demos shipped the Nx starter favicon for months. The brand icon is
   * copied in by hand, so this is what stops a regenerated example from
   * quietly bringing the Nx one back.
   */
  it.each(DEMO_META)('$key favicon.ico and icon.svg are the website brand files', (meta) => {
    const dir = join(DEMO_DIRS[meta.key], 'public');
    expect(readFileSync(join(dir, 'favicon.ico'))).toEqual(readFileSync(join(REPO_ROOT, 'apps', 'website', 'public', 'favicon.ico')));
    expect(readFileSync(join(dir, 'icon.svg'), 'utf8')).toBe(readFileSync(join(REPO_ROOT, 'apps', 'website', 'src', 'app', 'icon.svg'), 'utf8'));
  });

  it.each(DEMO_META)('$key robots.txt allows crawling (noindex rides on the route header)', (meta) => {
    const robots = readFileSync(join(DEMO_DIRS[meta.key], 'public', 'robots.txt'), 'utf8');
    expect(robots).toMatch(/^User-agent: \*\nAllow: \/\n$/u);
  });

  it.each(DEMO_META)('$key ships the social card at the advertised size', (meta) => {
    expect(pngSize(join(DEMO_DIRS[meta.key], 'public', 'social-card.png'))).toEqual(SOCIAL_CARD_SIZE);
  });
});
```

Move the `import` lines to the top of the file with the existing imports (ES modules hoist, but keep the file tidy).

- [ ] **Step 2: Run the full spec**

Run: `npx nx test website -- --run src/lib/demo-meta.spec.ts`
Expected: PASS (7 + 16 tests). If a tag assertion fails, fix the HTML, not the test — the module is the source of truth.

- [ ] **Step 3: Mutation check**

Temporarily change the AG-UI `<title>` in `examples/ag-ui/angular/src/index.html` to `AG-UI demo — Threadplane`, rerun the spec, confirm exactly the `ag-ui head carries the title…` test fails, then revert.

- [ ] **Step 4: Run the whole website unit suite and lint**

Run: `npx nx run-many -t test lint --projects=website,scripts`
Expected: all green. If `public-copy.spec.ts` flags a phrase in `demo-meta.ts`, reword that phrase — do not add an exemption.

- [ ] **Step 5: Build the website to prove the static routes render**

Run: `npx nx build website`
Expected: succeeds; the output lists `/demo-card/langgraph` and `/demo-card/ag-ui` as static (○) routes.

- [ ] **Step 6: Commit 2 of 3**

```bash
git add apps/website/src/lib/demo-meta.ts apps/website/src/lib/demo-meta.spec.ts \
  apps/website/src/app/card/chrome.tsx apps/website/src/app/card/demo-card.tsx apps/website/src/app/card/demo-card.spec.ts \
  apps/website/src/app/demo-card scripts/export-demo-cards.mjs package.json \
  examples/chat/angular/public/social-card.png examples/ag-ui/angular/public/social-card.png
git commit -m "feat(website): demo social cards and a drift guard for the demos' metadata

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Docs and deploy-gate hardening

**Files:**
- Modify: `docs/brand/README.md` (append section)
- Modify: `.github/workflows/ci.yml:1166` and `:1519`

- [ ] **Step 1: Brand runbook**

Append to `docs/brand/README.md`:

```markdown
## Demo social cards

`examples/chat/angular/public/social-card.png` and
`examples/ag-ui/angular/public/social-card.png` are the `og:image` for
demo.threadplane.ai and ag-ui.threadplane.ai. They are rendered by
`/demo-card/langgraph` and `/demo-card/ag-ui` on the website from the copy in
`apps/website/src/lib/demo-meta.ts`, and committed because the demos are
static sites on their own Vercel projects and must serve the file themselves.

### When to redo them

Any change to `apps/website/src/app/card/`, to `demo-meta.ts`, or to the brand
palette. The demos redeploy on their own change gates, so a regenerated PNG
ships with the next merge.

### Regenerating

```bash
npm run card:demos                                    # from production
npm run card:demos -- --origin http://localhost:3000  # from a local serve
```

The script refuses to write anything that is not a 1200x630 PNG. **Look at
both PNGs before committing**: a missing bundled font still renders a valid
PNG in the fallback face, and only your eye catches that.

Titles and descriptions live in two places by necessity — `demo-meta.ts` and
each demo's `src/index.html` — and `demo-meta.spec.ts` fails when they
disagree. Edit the module first, then the HTML.
```

- [ ] **Step 2: Add the shared routes file to both deploy gates**

In `.github/workflows/ci.yml` line 1166, change
`scripts/assemble-demo\.ts)$'` to `scripts/assemble-demo\.ts|scripts/demo-routes\.ts)$'`.

Line 1519, change
`scripts/(ag-ui-demo-middleware|assemble-ag-ui-demo)\.ts)$'` to
`scripts/(ag-ui-demo-middleware|assemble-ag-ui-demo|demo-routes)\.ts)$'`.

- [ ] **Step 3: Run the workflow spec**

Run: `node --test scripts/ci-workflow.spec.mjs scripts/ci-scope.spec.mjs`
Expected: PASS.

- [ ] **Step 4: Commit 3 of 3**

```bash
git add docs/brand/README.md .github/workflows/ci.yml
git commit -m "docs(brand): demo card runbook; gate demo deploys on scripts/demo-routes.ts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: PR, merge on green, verify production

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin blove/demo-metadata-seo-polish-047371
gh pr create --title "feat: deployed demo metadata and SEO polish" --body-file <(cat <<'EOF'
## Summary
- Both deployed demos shipped the Nx starter favicon, no description or social tags, internal-vocabulary titles, and a robots.txt that returned the SPA. Fixed on `demo.threadplane.ai` and `ag-ui.threadplane.ai`.
- Brand favicon + SVG icon, full head (description, canonical, theme-color, Open Graph, Twitter), allow-all robots.txt, committed 1200x630 social cards rendered from the website card chrome.
- `/hero` and `/stage` (homepage iframe targets) get `X-Robots-Tag: noindex` via a shared Vercel route table.
- `apps/website/src/lib/demo-meta.ts` is the copy's source of truth; its spec reads both demos' `index.html` and icons from disk so they cannot drift.

Spec: docs/superpowers/specs/2026-10-05-demo-metadata-seo-polish-design.md

## Verification
- `nx test website`, `nx test scripts`, `nx lint website`, `nx build website`
- `nx build examples-chat-angular` / `examples-ag-ui-angular` (production)
- Assembler emits the noindex route first in `config.json`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

- [ ] **Step 2: Bind the PR and arm auto-merge**

Use `mcp__ccd_pr__get_status`; if the PR is not bound, `mcp__ccd_pr__bind_pr`. The user asked to merge on green: `gh pr merge --auto --squash`. Watch the `CI — required` aggregator (memory: key on that check; rebase if the PR falls BEHIND main).

- [ ] **Step 3: Verify production after both demo-deploy jobs complete**

```bash
for h in demo.threadplane.ai ag-ui.threadplane.ai; do
  echo "== $h"
  curl -sL "https://$h/" | grep -oE '<title>[^<]+</title>|property="og:image" content="[^"]+"|name="description"'
  curl -s -o /dev/null -w "robots: %{http_code} %{content_type}\n" "https://$h/robots.txt"
  curl -sL "https://$h/favicon.ico" | md5
  curl -sI "https://$h/social-card.png" | grep -iE '^(HTTP|content-type)'
done
curl -sI https://demo.threadplane.ai/hero | grep -i x-robots-tag     # expect: noindex
curl -sI https://demo.threadplane.ai/ | grep -ic x-robots-tag        # expect: 0
curl -sL https://threadplane.ai/favicon.ico | md5                     # must equal the demo hashes
```

Expected: new titles; `robots: 200 text/plain`; favicon hashes equal the website's; `social-card.png` is `200 image/png`; `/hero` carries `x-robots-tag: noindex`; `/` carries none.

If a demo still serves the old head after the main run is green, check for a culled run in the CI-main concurrency queue before suspecting the code (deploy-gate hazard note in `scripts/assemble-examples.ts`).
