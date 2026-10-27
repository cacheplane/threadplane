import type { Metadata } from 'next';
import { Archivo, Archivo_Black, Inter, JetBrains_Mono } from 'next/font/google';
import '@threadplane/design-tokens/tokens.css';
import './global.css';
import { Nav } from '../components/shared/Nav';
import { SiteFooter } from '../components/shared/SiteFooter';
import { AnnouncementToast } from '../components/shared/AnnouncementToast';
import { WebsiteWorkspaceRoot } from '../components/workspace/WebsiteWorkspaceRoot';
import { JsonLd } from '../components/shared/JsonLd';
import { rootJsonLd } from '../lib/structured-data';
import {
  DEFAULT_META_DESCRIPTION,
  DEFAULT_SOCIAL_IMAGE_META,
  LONG_SUBHEAD,
  PRIMARY_TAGLINE,
  SITE_NAME,
  SITE_ORIGIN,
  SITE_X_CREATOR,
  SITE_X_SITE,
} from '../lib/site-metadata';
import { getFormPolicy } from '../lib/growth/form-policy';
import { WebsiteSignals } from '../components/shared/WebsiteSignals';
import { PreAnalyticsBeacon } from '../components/shared/PreAnalyticsBeacon';
import { EngagedTimeSignal } from '../components/shared/EngagedTimeSignal';
import { websiteContentCatalog } from '../lib/growth/website-content';

/*
 * FONT PRELOADS. Exactly two faces are preloaded — Archivo Black and Archivo
 * normal — and that is deliberate.
 *
 * The homepage's LCP element is the hero poster, an image, so no font gates
 * LCP: every face here is font-display: swap. But on a throttled phone the CDN
 * splits bandwidth between concurrent requests rather than honoring priority,
 * so every preloaded font is a High-priority request racing the poster.
 * Measured on production (Lighthouse mobile, devtools throttling), blocking
 * Archivo italic moved LCP -228ms and JetBrains Mono -224ms — each more than
 * PostHog's whole library. Unpreloaded faces still load as soon as text using
 * them lays out, behind a fallback.
 *
 * Why these two stay preloaded:
 *  - Archivo Black is the H1 (9.8KB): the one face whose late arrival a visitor
 *    would plainly see.
 *  - Archivo normal is the hero subhead and CTAs. Un-preloading it was tried
 *    and measured: the subhead wraps to two lines in the Arial-based fallback
 *    and three in Archivo, so the swap pushed the CTAs and the whole demo down
 *    — CLS 0.206 on a 375x812 phone. Keep it preloaded unless that reflow is
 *    solved first.
 *
 * e2e/home-bundle.spec.ts asserts exactly these two preloads.
 */
const display = Archivo_Black({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
});

/*
 * Archivo is split into two next/font instances so the italic can skip the
 * preload: next/font preloads per instance, all styles together.
 *
 * The split costs nothing at the call sites because next/font registers both
 * under the REAL family name, `Archivo` (checked in the built CSS). The browser
 * merges them into one family, so every `font-style: italic` on text set in
 * var(--font-sans) still selects the true italic face, not a synthesized
 * oblique — no CSS needs to know the italic lives in its own instance.
 * `--font-sans-italic` exists only so the instance is referenced and its
 * @font-face ships. If a future next/font ever hashes family names again, the
 * two would become separate families and italics would silently turn faux;
 * e2e/home-bundle.spec.ts loads the italic by family name to catch that.
 */
const sans = Archivo({
  subsets: ['latin'],
  style: ['normal'],
  variable: '--font-sans',
});

const sansItalic = Archivo({
  subsets: ['latin'],
  style: ['italic'],
  variable: '--font-sans-italic',
  // 38.5KB, and no italic is set above the fold on any page.
  preload: false,
});

/**
 * Inter is retained for diagrams only, and MUST be loaded here rather than
 * left to theme.css. theme.css's `Inter, system-ui` stack only names the
 * family; this loader is what actually ships the font file. Without it no
 * `Inter` face exists and diagrams silently fall back to system-ui. (Older
 * next/font versions also registered hashed family names, which a raw stack
 * could never match; next/font 16 registers the real name, `Inter`.) Diagram
 * geometry is pinned to Inter's metrics — see the FONTS note in
 * src/styles/ui.css and e2e/home-architecture.spec.ts.
 */
const diagram = Inter({
  subsets: ['latin'],
  variable: '--font-diagram',
  // Not preloaded. A preload makes the file a High-priority request at the
  // same instant as the hero poster, and on a phone that is a straight fight
  // for bandwidth with the LCP image — 47KB of a face no hero text uses. Left
  // unpreloaded, it still loads the moment a diagram lays out, behind the
  // size-adjusted fallback next/font generates; the diagram e2e already waits
  // on document.fonts.ready. e2e/home-bundle.spec.ts budgets the preloads.
  preload: false,
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  // Not preloaded: see FONT PRELOADS above.
  preload: false,
  // next/font's generated fallback for this face is `local(Arial)` — a
  // PROPORTIONAL font scaled to stand in for a monospace one. Harmless while
  // the face was preloaded; without the preload, code blocks and the eyebrow
  // would briefly render in Arial with their columns misaligned. A real
  // monospace stack keeps the grid while JetBrains Mono loads.
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: PRIMARY_TAGLINE,
  description: DEFAULT_META_DESCRIPTION,
  openGraph: {
    title: 'Threadplane',
    description: LONG_SUBHEAD,
    type: 'website',
    siteName: SITE_NAME,
    url: '/',
    images: [DEFAULT_SOCIAL_IMAGE_META],
  },
  twitter: {
    card: 'summary_large_image',
    site: SITE_X_SITE,
    creator: SITE_X_CREATOR,
    title: 'Threadplane',
    description: LONG_SUBHEAD,
    images: [DEFAULT_SOCIAL_IMAGE_META],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const formPolicy = getFormPolicy();
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${sansItalic.variable} ${diagram.variable} ${mono.variable}`}
    >
      <body>
        {/*
          First in <body> so it is armed while the HTML is still parsing, before
          any bundle loads. It records visitors who leave before PostHog has
          initialized; instrumentation-client.ts disarms it once PostHog runs.
        */}
        <PreAnalyticsBeacon />
        {/*
          Site-wide structured data, mounted once here so it is present on every
          route. Per-route nodes (BlogPosting, TechArticle) reference the
          Organization by `@id`; those references only resolve because this
          renders alongside them. `rootJsonLd()` is a single `@graph` for that
          reason — do not mount its component builders individually.
        */}
        <JsonLd data={rootJsonLd()} />
        <WebsiteSignals catalog={websiteContentCatalog()} />
        <EngagedTimeSignal />
        <Nav />
        <div id="site-content">
          <main>
            <WebsiteWorkspaceRoot>{children}</WebsiteWorkspaceRoot>
          </main>
          <SiteFooter formPolicy={formPolicy} />
          <div data-announcement-region="">
            <AnnouncementToast formPolicy={formPolicy} />
          </div>
        </div>
      </body>
    </html>
  );
}
